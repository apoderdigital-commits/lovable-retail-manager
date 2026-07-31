-- ═══════════════════════════════════════════════════════════════════════
-- Ciclo de entrega: encaixa pedido, rota, entregador e reserva de estoque
-- no schema original do Lovable, sem renomear nada.
--
--   · products.price continua sendo o preço de VAREJO
--   · sales ganha o ciclo de vida e continua se chamando sales
--   · papéis vêm de user_roles (padrão seguro do Supabase)
--
-- Regras que passam a viver no banco:
--   · "not_delivered" NÃO paga taxa ao entregador
--   · pedido "scheduled" MANTÉM o estoque reservado
--   · status só muda por função — UPDATE direto é bloqueado por trigger
--   · reserva de estoque é atômica (dois atendentes não vendem o mesmo frasco)
--
-- Idempotente: pode rodar de novo sem quebrar.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1. Tipos ──────────────────────────────────────────────────────────

do $$ begin
  create type customer_type as enum ('retail','wholesale');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum
    ('new','picked','on_route','delivered','scheduled','not_delivered','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stock_move as enum ('inbound','adjustment','reserve','release','writeoff');
exception when duplicate_object then null; end $$;


-- ─── 2. Quem é quem (lê de user_roles) ─────────────────────────────────

create or replace function current_has_role(_role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = _role
  )
$$;

-- 'vendedor' é o papel que o Lovable já criava; conta como staff.
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
     where user_id = auth.uid()
       and role in ('admin','vendedor','attendant','stockist')
  )
$$;

create or replace function is_courier()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'courier'
  )
$$;


-- ─── 3. Clientes: varejo x atacado + endereço ──────────────────────────

alter table customers
  add column if not exists customer_type customer_type not null default 'retail',
  add column if not exists address       text,
  add column if not exists neighborhood  text;

create index if not exists customers_type_idx on customers (customer_type);


-- ─── 4. Produtos: preço de atacado + os três saldos ────────────────────

alter table products
  add column if not exists wholesale_price numeric(12,2),
  add column if not exists reserved_stock  integer not null default 0;

update products set wholesale_price = price where wholesale_price is null;
alter table products alter column wholesale_price set not null;

do $$ begin
  alter table products add constraint products_wholesale_nonneg check (wholesale_price >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table products add constraint products_reserved_nonneg check (reserved_stock >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table products add constraint products_reserved_within_stock check (reserved_stock <= stock);
exception when duplicate_object then null; end $$;

alter table products
  add column if not exists available_stock integer
    generated always as (stock - reserved_stock) stored;

comment on column products.price           is 'Preço de varejo';
comment on column products.wholesale_price is 'Preço de atacado';
comment on column products.stock           is 'Saldo físico na prateleira';
comment on column products.reserved_stock  is 'Preso em pedidos ainda não entregues';
comment on column products.available_stock is 'stock - reserved_stock — é este que a tela de venda mostra';


-- ─── 5. Rotas e taxas ──────────────────────────────────────────────────

create table if not exists routes (
  id            uuid primary key default gen_random_uuid(),
  courier_id    uuid not null references auth.users(id),
  date          date not null default current_date,
  dispatched_at timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (courier_id, date)
);

create table if not exists delivery_fees (
  id           uuid primary key default gen_random_uuid(),
  neighborhood text not null unique,
  amount       numeric(12,2) not null check (amount >= 0)
);


-- ─── 6. sales ganha o ciclo de vida ────────────────────────────────────

alter table sales
  add column if not exists status           order_status not null default 'new',
  add column if not exists route_id         uuid references routes(id),
  add column if not exists courier_id       uuid references auth.users(id),
  add column if not exists delivery_address text,
  add column if not exists neighborhood     text,
  add column if not exists delivery_fee     numeric(12,2) not null default 0,
  add column if not exists fee_due          boolean not null default false,
  add column if not exists scheduled_for    date,
  add column if not exists proof_url        text,
  add column if not exists reason           text,
  add column if not exists updated_at       timestamptz not null default now();

-- o que já estava na tabela é venda de balcão: nasceu concluída
update sales set status = 'delivered' where status = 'new';

create index if not exists sales_status_idx    on sales (status);
create index if not exists sales_route_idx     on sales (route_id);
create index if not exists sales_scheduled_idx on sales (scheduled_for) where status = 'scheduled';


-- ─── 7. Os dois logs ───────────────────────────────────────────────────

-- hoje: auditoria e relatório de rota. depois: a base do CRM.
create table if not exists sale_status_history (
  id             bigint generated always as identity primary key,
  sale_id        uuid not null references sales(id) on delete cascade,
  from_status    order_status,
  to_status      order_status not null,
  user_id        uuid references auth.users(id),
  reason         text,
  attachment_url text,
  created_at     timestamptz not null default now()
);
create index if not exists sale_status_history_idx on sale_status_history (sale_id, created_at);

create table if not exists stock_movements (
  id         bigint generated always as identity primary key,
  product_id uuid not null references products(id),
  kind       stock_move not null,
  quantity   integer not null,
  sale_id    uuid references sales(id),
  user_id    uuid references auth.users(id),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_idx on stock_movements (product_id, created_at);


-- ─── 8. Trava: status não muda por UPDATE ──────────────────────────────
-- sem isso o app do entregador consegue pular etapa ou ressuscitar
-- pedido cancelado — e a taxa dele vira dinheiro errado.

create or replace function block_direct_status_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.transition_ok', true), '') <> 'on' then
    raise exception 'Status só pode mudar via transition_sale()';
  end if;
  return new;
end $$;

drop trigger if exists sales_status_guard on sales;
create trigger sales_status_guard
  before update on sales
  for each row execute function block_direct_status_change();


-- ─── 9. Transição de status (o coração) ────────────────────────────────

create or replace function transition_sale(
  p_sale     uuid,
  p_to       order_status,
  p_reason   text default null,
  p_proof    text default null,
  p_schedule date default null
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale sales;
  v_from order_status;
  v_uid  uuid := auth.uid();
  v_item record;
begin
  select * into v_sale from sales where id = p_sale for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  v_from := v_sale.status;

  -- 9.1 a transição existe no ciclo?
  if not (
       (v_from = 'new'      and p_to in ('picked','cancelled','delivered'))  -- delivered = balcão
    or (v_from = 'picked'   and p_to in ('on_route','cancelled'))
    or (v_from = 'on_route' and p_to in ('delivered','scheduled','not_delivered','cancelled'))
    or (v_from in ('scheduled','not_delivered') and p_to in ('picked','cancelled'))
  ) then
    raise exception 'Transição inválida: % -> %', v_from, p_to;
  end if;

  -- 9.2 quem pode
  if p_to = 'delivered' then
    if v_sale.courier_id is not null then
      if is_courier() then
        if v_sale.courier_id is distinct from v_uid then
          raise exception 'Este pedido não é da sua rota';
        end if;
      elsif not current_has_role('admin') then
        raise exception 'Só o entregador da rota conclui a entrega';
      end if;
      if coalesce(p_proof, '') = '' then
        raise exception 'Comprovante é obrigatório para concluir a entrega';
      end if;
    else
      if not is_staff() then raise exception 'Sem permissão'; end if;   -- venda de balcão
    end if;

  elsif p_to in ('scheduled','not_delivered') then
    if is_courier() then
      if v_sale.courier_id is distinct from v_uid then
        raise exception 'Este pedido não é da sua rota';
      end if;
    elsif not current_has_role('admin') then
      raise exception 'Só o entregador da rota pode reagendar ou marcar não entregue';
    end if;

  elsif p_to = 'cancelled' then
    if v_from = 'on_route' and not current_has_role('admin') then
      raise exception 'Pedido em rota só pode ser cancelado por admin';
    end if;
    if not is_staff() then raise exception 'Sem permissão para cancelar'; end if;

  else
    if not is_staff() then raise exception 'Sem permissão para essa transição'; end if;
  end if;

  -- 9.3 exigências
  if p_to in ('not_delivered','cancelled') and coalesce(p_reason, '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;
  if p_to = 'scheduled' and p_schedule is null then
    raise exception 'Informe a data do reagendamento';
  end if;

  -- 9.4 estoque
  if p_to = 'delivered' then
    for v_item in select product_id, quantity from sale_items where sale_id = p_sale loop
      update products
         set stock          = stock          - v_item.quantity,
             reserved_stock = reserved_stock - v_item.quantity
       where id = v_item.product_id;
      insert into stock_movements (product_id, kind, quantity, sale_id, user_id)
      values (v_item.product_id, 'writeoff', v_item.quantity, p_sale, v_uid);
    end loop;

  elsif p_to = 'cancelled' then
    for v_item in select product_id, quantity from sale_items where sale_id = p_sale loop
      update products set reserved_stock = reserved_stock - v_item.quantity
       where id = v_item.product_id;
      insert into stock_movements (product_id, kind, quantity, sale_id, user_id)
      values (v_item.product_id, 'release', v_item.quantity, p_sale, v_uid);
    end loop;
  end if;
  -- 'scheduled' e 'not_delivered' não tocam no estoque: a reserva fica de pé

  -- 9.5 grava
  perform set_config('app.transition_ok', 'on', true);

  update sales set
    status        = p_to,
    -- taxa só é devida em entrega concluída por entregador.
    -- "not_delivered" fica em zero, e balcão não gera taxa.
    fee_due       = (p_to = 'delivered' and courier_id is not null),
    proof_url     = coalesce(p_proof,  proof_url),
    reason        = coalesce(p_reason, reason),
    scheduled_for = case when p_to = 'scheduled' then p_schedule else scheduled_for end,
    -- ao voltar pra fila, desliga da rota antiga
    route_id      = case when p_to = 'picked' then null else route_id end,
    updated_at    = now()
  where id = p_sale
  returning * into v_sale;

  perform set_config('app.transition_ok', 'off', true);

  insert into sale_status_history (sale_id, from_status, to_status, user_id, reason, attachment_url)
  values (p_sale, v_from, p_to, v_uid, p_reason, p_proof);

  return v_sale;
end $$;


-- ─── 10. Criar venda (reserva atômica) ─────────────────────────────────

create or replace function create_order(
  p_customer       uuid,
  p_payment_method text,
  p_items          jsonb,                        -- [{"product_id":"...","quantity":2}]
  p_address        text    default null,
  p_neighborhood   text    default null,
  p_discount       numeric(12,2) default 0,
  p_counter_sale   boolean default false         -- true = balcão, sai entregue na hora
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale     sales;
  v_type     customer_type;
  v_item     jsonb;
  v_product  products;
  v_qty      integer;
  v_price    numeric(12,2);
  v_subtotal numeric(12,2) := 0;
begin
  if not is_staff() then raise exception 'Sem permissão para criar venda'; end if;

  select customer_type into v_type from customers where id = p_customer;
  if not found then raise exception 'Cliente não encontrado'; end if;

  insert into sales (customer_id, seller_id, payment_method,
                     delivery_address, neighborhood, subtotal, discount, total)
  values (p_customer, auth.uid(), p_payment_method,
          p_address, p_neighborhood, 0, coalesce(p_discount, 0), 0)
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade inválida'; end if;

    -- FOR UPDATE trava a linha: o segundo atendente espera e vê o saldo real
    select * into v_product from products
     where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Produto não encontrado'; end if;

    if v_product.available_stock < v_qty then
      raise exception 'Estoque insuficiente de %: disponível %, pedido %',
        v_product.name, v_product.available_stock, v_qty;
    end if;

    -- o preço sai do tipo do cliente, não da tela
    v_price := case v_type when 'wholesale' then v_product.wholesale_price
                           else v_product.price end;

    insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, total)
    values (v_sale.id, v_product.id, v_product.name, v_qty, v_price, v_qty * v_price);

    update products set reserved_stock = reserved_stock + v_qty where id = v_product.id;

    insert into stock_movements (product_id, kind, quantity, sale_id, user_id)
    values (v_product.id, 'reserve', v_qty, v_sale.id, auth.uid());

    v_subtotal := v_subtotal + (v_qty * v_price);
  end loop;

  update sales
     set subtotal   = v_subtotal,
         total      = v_subtotal - coalesce(p_discount, 0),
         updated_at = now()
   where id = v_sale.id
  returning * into v_sale;

  insert into sale_status_history (sale_id, from_status, to_status, user_id)
  values (v_sale.id, null, 'new', auth.uid());

  -- balcão: o cliente leva na hora, então já baixa o estoque
  if p_counter_sale then
    v_sale := transition_sale(v_sale.id, 'delivered');
  end if;

  return v_sale;
end $$;


-- ─── 11. Despachar e encerrar rota ─────────────────────────────────────

create or replace function dispatch_route(p_route uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_route routes;
  v_id    uuid;
  v_n     integer := 0;
begin
  if not is_staff() then raise exception 'Sem permissão para despachar rota'; end if;

  select * into v_route from routes where id = p_route for update;
  if not found then raise exception 'Rota não encontrada'; end if;
  if v_route.dispatched_at is not null then raise exception 'Rota já despachada'; end if;

  -- só neste ponto os pedidos aparecem no celular do entregador
  for v_id in select id from sales where route_id = p_route and status = 'picked' loop
    update sales set
      courier_id   = v_route.courier_id,
      delivery_fee = coalesce((select amount from delivery_fees f
                                where f.neighborhood = sales.neighborhood), 0)
     where id = v_id;
    perform transition_sale(v_id, 'on_route');
    v_n := v_n + 1;
  end loop;

  update routes set dispatched_at = now() where id = p_route;
  return v_n;
end $$;

create or replace function close_route(p_route uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r jsonb;
begin
  if not (is_staff() or is_courier()) then raise exception 'Sem permissão'; end if;

  update routes set closed_at = now() where id = p_route and closed_at is null;

  select jsonb_build_object(
    'delivered',     count(*) filter (where status = 'delivered'),
    'not_delivered', count(*) filter (where status = 'not_delivered'),
    'scheduled',     count(*) filter (where status = 'scheduled'),
    'fee_payable',   coalesce(sum(delivery_fee) filter (where fee_due), 0),
    'fee_lost',      coalesce(sum(delivery_fee) filter (where status = 'not_delivered'), 0),
    'cash_in_hand',  coalesce(sum(total) filter (where status = 'delivered'
                                                   and payment_method = 'dinheiro'), 0)
  ) into v_r
  from sales where route_id = p_route;

  return v_r;
end $$;


-- ─── 12. RLS das tabelas novas ─────────────────────────────────────────

alter table routes              enable row level security;
alter table delivery_fees       enable row level security;
alter table sale_status_history enable row level security;
alter table stock_movements     enable row level security;

drop policy if exists routes_staff    on routes;
drop policy if exists routes_courier  on routes;
create policy routes_staff   on routes for all using (is_staff()) with check (is_staff());
create policy routes_courier on routes for select using (courier_id = auth.uid());

drop policy if exists fees_read  on delivery_fees;
drop policy if exists fees_admin on delivery_fees;
create policy fees_read  on delivery_fees for select using (auth.uid() is not null);
create policy fees_admin on delivery_fees for all
  using (current_has_role('admin')) with check (current_has_role('admin'));

drop policy if exists history_staff   on sale_status_history;
drop policy if exists movements_staff on stock_movements;
create policy history_staff   on sale_status_history for select using (is_staff());
create policy movements_staff on stock_movements     for select using (is_staff());

grant execute on function create_order, transition_sale, dispatch_route, close_route
  to authenticated;
