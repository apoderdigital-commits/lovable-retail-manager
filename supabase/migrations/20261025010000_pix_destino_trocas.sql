-- Pedidos da loja:
--   1. Pix na entrega: o entregador diz se o pix caiu na maquina (loja) ou
--      na chave dele. Pix na chave do entregador entra no acerto junto com
--      o dinheiro. A quebra por forma de pagamento separa os dois.
--   2. Trocas a partir de uma venda concluida: troca normal, defeito ou
--      troca de fragrancia. Produto devolvido volta pro estoque, menos no
--      defeito (entra e sai como baixa). Produto novo sai do estoque. A
--      diferenca de preco fica registrada com a forma de pagamento.


-- ---- 1. Destino do pix ----

alter table sales
  add column if not exists pix_to text
    check (pix_to in ('maquina', 'entregador'));

comment on column sales.pix_to is
  'Pix recebido na entrega: maquina (caiu na loja) ou entregador (caiu na chave dele e entra no acerto). Null = sem pix ou venda antiga.';

-- quanto da venda entrou em pix
create or replace function sale_pix(s sales)
returns numeric language sql immutable as $$
  select (case when s.payment_method = 'pix'
               then s.total - coalesce(s.payment_amount_2, 0) else 0 end)
       + (case when s.payment_method_2 = 'pix'
               then coalesce(s.payment_amount_2, 0) else 0 end)
$$;

-- o que o entregador tem na mao pra repassar: especie + pix na chave dele
create or replace function sale_to_settle(s sales)
returns numeric language sql immutable as $$
  select sale_cash(s)
       + case when s.pix_to = 'entregador' then sale_pix(s) else 0 end
$$;

-- assinatura nova (p_pix_to): a antiga sai pra nao ficar ambigua
drop function if exists set_delivery_payment(uuid, text, text, numeric);

create or replace function set_delivery_payment(
  p_sale     uuid,
  p_method   text,
  p_method_2 text    default null,
  p_amount_2 numeric default 0,
  p_pix_to   text    default null
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale  sales;
  v_ok    text[] := array['dinheiro','pix','débito','crédito','boleto'];
begin
  select * into v_sale from sales where id = p_sale for update;
  if not found then raise exception 'Venda não encontrada'; end if;

  if is_courier() and v_sale.courier_id = auth.uid() then
    if v_sale.status <> 'on_route' then
      raise exception 'O pagamento só pode ser alterado com o pedido em rota';
    end if;
  elsif not (is_staff() and v_sale.status in ('new','picked','on_route','scheduled','not_delivered')) then
    raise exception 'Sem permissão para alterar o pagamento';
  end if;

  if not (p_method = any(v_ok)) then raise exception 'Forma de pagamento inválida'; end if;

  if nullif(trim(coalesce(p_method_2, '')), '') is null then
    p_method_2 := null;
    p_amount_2 := 0;
  else
    if not (p_method_2 = any(v_ok)) then raise exception 'Segunda forma de pagamento inválida'; end if;
    if p_method_2 = p_method then raise exception 'As duas formas de pagamento são iguais'; end if;
    if coalesce(p_amount_2, 0) <= 0 or p_amount_2 >= v_sale.total then
      raise exception 'O valor da segunda forma precisa ser maior que zero e menor que o total (%)', v_sale.total;
    end if;
  end if;

  if 'pix' in (p_method, coalesce(p_method_2, '')) then
    if p_pix_to is null or p_pix_to not in ('maquina', 'entregador') then
      raise exception 'Informe se o pix caiu na máquina ou na chave do entregador';
    end if;
  else
    p_pix_to := null;
  end if;

  update sales set
    payment_method   = p_method,
    payment_method_2 = p_method_2,
    payment_amount_2 = coalesce(p_amount_2, 0),
    pix_to           = p_pix_to,
    updated_at       = now()
  where id = p_sale
  returning * into v_sale;

  return v_sale;
end $$;

revoke all on function set_delivery_payment(uuid, text, text, numeric, text) from public, anon;
grant execute on function set_delivery_payment(uuid, text, text, numeric, text) to authenticated;

-- acerto do entregador passa a somar o pix que caiu na chave dele
create or replace function close_route(p_route uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r jsonb;
begin
  if not (is_staff() or is_courier()) then raise exception 'Sem permissão'; end if;

  update routes set closed_at = now() where id = p_route and closed_at is null;

  select jsonb_build_object(
    'delivered',     count(*) filter (where s.status = 'delivered'),
    'not_delivered', count(*) filter (where s.status = 'not_delivered'),
    'scheduled',     count(*) filter (where s.status = 'scheduled'),
    'fee_payable',   coalesce(sum(s.delivery_fee) filter (where s.fee_due), 0),
    'fee_lost',      coalesce(sum(s.delivery_fee) filter (where s.status = 'not_delivered'), 0),
    'cash_in_hand',  coalesce(sum(sale_to_settle(s)) filter (where s.status = 'delivered'), 0)
  ) into v_r
  from sales s where s.route_id = p_route;

  return v_r;
end $$;

create or replace function route_day_summary(p_date date default current_date)
returns table (
  route_id       uuid,
  courier_id     uuid,
  dispatched_at  timestamptz,
  closed_at      timestamptz,
  stops          bigint,
  delivered      bigint,
  not_delivered  bigint,
  pending        bigint,
  fee_payable    numeric,
  cash_collected numeric
)
language sql stable security definer set search_path = public as $$
  select
    r.id,
    r.courier_id,
    r.dispatched_at,
    r.closed_at,
    count(s.id),
    count(*) filter (where s.status = 'delivered'),
    count(*) filter (where s.status = 'not_delivered'),
    count(*) filter (where s.status = 'on_route'),
    coalesce(sum(s.delivery_fee) filter (where s.fee_due), 0),
    coalesce(sum(sale_to_settle(s)) filter (where s.status = 'delivered'), 0)
  from routes r
  left join sales s on s.route_id = r.id
  where r.date = p_date
    and (is_staff() or r.courier_id = auth.uid())
  group by r.id, r.courier_id, r.dispatched_at, r.closed_at
  order by r.created_at;
$$;

create or replace function route_range_summary(p_from date, p_to date)
returns table (
  courier_id     uuid,
  stops          bigint,
  delivered      bigint,
  not_delivered  bigint,
  pending        bigint,
  fee_payable    numeric,
  cash_collected numeric
)
language sql stable security definer set search_path = public as $$
  select
    r.courier_id,
    count(s.id),
    count(*) filter (where s.status = 'delivered'),
    count(*) filter (where s.status = 'not_delivered'),
    count(*) filter (where s.status = 'on_route'),
    coalesce(sum(s.delivery_fee) filter (where s.fee_due), 0),
    coalesce(sum(sale_to_settle(s)) filter (where s.status = 'delivered'), 0)
  from routes r
  left join sales s on s.route_id = r.id
  where r.date between p_from and p_to
    and (is_staff() or r.courier_id = auth.uid())
  group by r.courier_id
  order by r.courier_id;
$$;

-- pix aparece como "pix máquina" ou "pix entregador"; venda antiga sem
-- destino continua como "pix"
create or replace function route_payment_breakdown(p_from date, p_to date)
returns table (
  courier_id     uuid,
  payment_method text,
  transactions   bigint,
  amount         numeric
)
language sql stable security definer set search_path = public as $$
  with parts as (
    select r.courier_id, s.payment_method as method, s.pix_to,
           s.total - coalesce(s.payment_amount_2, 0) as amount
      from sales s join routes r on r.id = s.route_id
     where s.status = 'delivered'
       and r.date between p_from and p_to
       and (is_staff() or r.courier_id = auth.uid())
    union all
    select r.courier_id, s.payment_method_2, s.pix_to, s.payment_amount_2
      from sales s join routes r on r.id = s.route_id
     where s.status = 'delivered'
       and s.payment_method_2 is not null
       and r.date between p_from and p_to
       and (is_staff() or r.courier_id = auth.uid())
  ),
  labeled as (
    select courier_id, amount,
           case when method = 'pix' and pix_to = 'maquina'    then 'pix máquina'
                when method = 'pix' and pix_to = 'entregador' then 'pix entregador'
                else method end as method
      from parts
  )
  select courier_id, method, count(*), coalesce(sum(amount), 0)
    from labeled
   group by courier_id, method
   order by courier_id, method;
$$;


-- ---- 2. Trocas ----

create table if not exists sale_exchanges (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references sales(id),
  customer_id         uuid references customers(id),
  kind                text not null check (kind in ('troca', 'defeito', 'fragrancia')),
  returned_product_id uuid not null references products(id),
  returned_name       text not null,
  returned_qty        integer not null check (returned_qty > 0),
  returned_value      numeric(12,2) not null,
  given_product_id    uuid not null references products(id),
  given_name          text not null,
  given_qty           integer not null check (given_qty > 0),
  given_value         numeric(12,2) not null,
  -- positivo: cliente paga a diferenca; negativo: loja devolve
  difference          numeric(12,2) not null,
  difference_payment  text,
  notes               text,
  user_id             uuid references auth.users(id),
  created_at          timestamptz not null default now()
);

create index if not exists sale_exchanges_sale_idx on sale_exchanges (sale_id);

comment on table sale_exchanges is
  'Trocas feitas a partir de uma venda concluida. Estoque mexido so pela register_exchange.';

alter table sale_exchanges enable row level security;
drop policy if exists sale_exchanges_staff on sale_exchanges;
create policy sale_exchanges_staff on sale_exchanges for select using (is_staff());

create or replace function register_exchange(
  p_sale             uuid,
  p_kind             text,
  p_returned_product uuid,
  p_returned_qty     integer,
  p_given_product    uuid,
  p_given_qty        integer,
  p_payment          text default null,
  p_notes            text default null
) returns sale_exchanges
language plpgsql security definer set search_path = public as $$
declare
  v_sale     sales;
  v_type     customer_type;
  v_ret      products;
  v_new      products;
  v_sold     integer;
  v_paid     numeric(12,2);
  v_already  integer;
  v_ret_val  numeric(12,2);
  v_new_val  numeric(12,2);
  v_diff     numeric(12,2);
  v_label    text;
  v_row      sale_exchanges;
begin
  if not is_staff() then raise exception 'Sem permissão para registrar troca'; end if;

  select * into v_sale from sales where id = p_sale;
  if not found then raise exception 'Venda não encontrada'; end if;
  if v_sale.status <> 'delivered' then
    raise exception 'Troca só em venda concluída';
  end if;

  if p_kind not in ('troca', 'defeito', 'fragrancia') then
    raise exception 'Tipo de troca inválido';
  end if;
  if coalesce(p_returned_qty, 0) <= 0 or coalesce(p_given_qty, 0) <= 0 then
    raise exception 'Quantidade inválida';
  end if;

  -- o que volta tem que ter saido nesta venda, descontando trocas anteriores
  select coalesce(sum(quantity), 0), coalesce(sum(total), 0)
    into v_sold, v_paid
    from sale_items where sale_id = p_sale and product_id = p_returned_product;
  if v_sold = 0 then raise exception 'Esse produto não está nesta venda'; end if;

  select coalesce(sum(returned_qty), 0) into v_already
    from sale_exchanges where sale_id = p_sale and returned_product_id = p_returned_product;
  if p_returned_qty > v_sold - v_already then
    raise exception 'Só restam % unidade(s) desse produto pra trocar nesta venda', v_sold - v_already;
  end if;

  select * into v_ret from products where id = p_returned_product for update;
  select * into v_new from products where id = p_given_product for update;
  if v_new.id is null then raise exception 'Produto novo não encontrado'; end if;

  -- devolvido vale o que o cliente pagou por unidade (kit de oferta incluso);
  -- o novo vale o preco de hoje da tabela do cliente
  if v_sale.customer_id is null then
    v_type := 'retail';
  else
    select customer_type into v_type from customers where id = v_sale.customer_id;
  end if;
  v_ret_val := round(v_paid / v_sold * p_returned_qty, 2);
  v_new_val := p_given_qty * case v_type when 'wholesale' then v_new.wholesale_price
                                         else v_new.price end;
  v_diff := v_new_val - v_ret_val;

  if v_diff <> 0 and nullif(trim(coalesce(p_payment, '')), '') is null then
    raise exception 'Informe a forma de pagamento da diferença';
  end if;

  -- devolvido saiu da prateleira na venda: estoque reservado nao muda,
  -- so o fisico. O mesmo produto pode voltar e sair na mesma troca, por
  -- isso o devolvido entra antes de conferir o disponivel do novo.
  v_label := case p_kind when 'defeito' then 'defeito'
                         when 'fragrancia' then 'troca de fragrância'
                         else 'troca' end;

  update products set stock = stock + p_returned_qty where id = v_ret.id;
  insert into stock_movements (product_id, kind, quantity, sale_id, user_id, note)
  values (v_ret.id, 'inbound', p_returned_qty, p_sale, auth.uid(),
          'Devolvido na ' || v_label || ' da venda #' || v_sale.sale_number);

  if p_kind = 'defeito' then
    update products set stock = stock - p_returned_qty where id = v_ret.id;
    insert into stock_movements (product_id, kind, quantity, sale_id, user_id, note)
    values (v_ret.id, 'writeoff', p_returned_qty, p_sale, auth.uid(),
            'Baixa por defeito, venda #' || v_sale.sale_number);
  end if;

  select * into v_new from products where id = p_given_product;
  if v_new.available_stock < p_given_qty then
    raise exception 'Estoque insuficiente de %: disponível %, pedido %',
      v_new.name, v_new.available_stock, p_given_qty;
  end if;

  update products set stock = stock - p_given_qty where id = v_new.id;
  insert into stock_movements (product_id, kind, quantity, sale_id, user_id, note)
  values (v_new.id, 'writeoff', p_given_qty, p_sale, auth.uid(),
          'Saiu na ' || v_label || ' da venda #' || v_sale.sale_number);

  insert into sale_exchanges (
    sale_id, customer_id, kind,
    returned_product_id, returned_name, returned_qty, returned_value,
    given_product_id, given_name, given_qty, given_value,
    difference, difference_payment, notes, user_id)
  values (
    p_sale, v_sale.customer_id, p_kind,
    v_ret.id, v_ret.name, p_returned_qty, v_ret_val,
    v_new.id, v_new.name, p_given_qty, v_new_val,
    v_diff, case when v_diff <> 0 then trim(p_payment) end,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_row;

  return v_row;
end $$;

revoke all on function register_exchange(uuid, text, uuid, integer, uuid, integer, text, text)
  from public, anon;
grant execute on function register_exchange(uuid, text, uuid, integer, uuid, integer, text, text)
  to authenticated;
