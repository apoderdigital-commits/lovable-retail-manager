-- Taxa de entrega por cidade, com excecoes por bairro.
--
-- O valor e cobrado do cliente (entra no total do pedido) e o mesmo valor
-- e o que a loja paga ao entregador no acerto da rota. Por isso a taxa e
-- gravada na venda ja na criacao do pedido, e o despacho so recalcula
-- pedidos antigos que nasceram sem ela.
--
-- A tabela antiga delivery_fees (por bairro, so pagamento do entregador)
-- continua existindo apenas como reserva para esses pedidos antigos.


-- ---- 1. Normalizacao de nome de lugar ----
-- "Jaboatão dos Guararapes - PE", "jaboatao dos guararapes" e
-- "JABOATAO DOS GUARARAPES" precisam bater: o ViaCEP devolve com UF.

create or replace function norm_place(p text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        translate(lower(trim(coalesce(p, ''))),
                  'áàâãäéèêëíìîïóòôõöúùûüç',
                  'aaaaaeeeeiiiiooooouuuuc'),
        '\s*-\s*[a-z]{2}$', ''),
      '\s+', ' ', 'g'),
    '')
$$;


-- ---- 2. Zonas de entrega ----
-- neighborhood nulo = valor geral da cidade. serves = false = nao atende.

create table if not exists delivery_zones (
  id           uuid primary key default gen_random_uuid(),
  city         text not null,
  neighborhood text,
  amount       numeric(12,2) check (amount >= 0),
  serves       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint delivery_zones_amount_when_serves check (not serves or amount is not null)
);

create unique index if not exists delivery_zones_place_uniq
  on delivery_zones (norm_place(city), coalesce(norm_place(neighborhood), ''));

alter table delivery_zones enable row level security;

drop policy if exists delivery_zones_read  on delivery_zones;
drop policy if exists delivery_zones_admin on delivery_zones;
create policy delivery_zones_read  on delivery_zones for select using (auth.uid() is not null);
create policy delivery_zones_admin on delivery_zones for all
  using (current_has_role('admin')) with check (current_has_role('admin'));

insert into delivery_zones (city, neighborhood, amount, serves)
select * from (values
  ('Recife',                  null::text,            15.00::numeric(12,2), true),
  ('Olinda',                  null,                  20.00, true),
  ('Paulista',                null,                  20.00, true),
  ('Paulista',                'Pau Amarelo',         30.00, true),
  ('Jaboatão dos Guararapes', null,                  15.00, true),
  ('Jaboatão dos Guararapes', 'Barra de Jangada',    20.00, true),
  ('Jaboatão dos Guararapes', 'Comportas',           30.00, true),
  ('Cabo de Santo Agostinho', null,                  30.00, true),
  ('Cabo de Santo Agostinho', 'Enseada dos Corais',  40.00, true),
  ('Cabo de Santo Agostinho', 'Gaibu',               40.00, true),
  ('Camaragibe',              null,                  20.00, true),
  ('Camaragibe',              'Aldeia de Baixo',     30.00, true),
  ('São Lourenço da Mata',    null,                  20.00, true),
  ('São Lourenço da Mata',    'Penedo',              30.00, true),
  ('São Lourenço da Mata',    'Tiúma',               30.00, true),
  ('São Lourenço da Mata',    'Nova Tiúma',          30.00, true),
  ('São Lourenço da Mata',    'Matriz da Luz',       30.00, true),
  ('Abreu e Lima',            null,                  20.00, true),
  ('Abreu e Lima',            'Distrito Industrial', 30.00, true),
  ('Abreu e Lima',            'Área Rural',          null,  false),
  ('Igarassu',                null,                  30.00, true),
  ('Igarassu',                'Área Rural',          null,  false)
) as v(city, neighborhood, amount, serves)
where not exists (select 1 from delivery_zones);


-- ---- 3. Cotacao: bairro especifico ganha do valor geral da cidade ----

create or replace function delivery_quote(p_city text, p_neighborhood text)
returns delivery_zones
language sql stable security definer set search_path = public as $$
  select *
    from delivery_zones z
   where norm_place(z.city) = norm_place(p_city)
     and (z.neighborhood is null or norm_place(z.neighborhood) = norm_place(p_neighborhood))
   order by z.neighborhood is null
   limit 1
$$;

revoke all on function delivery_quote(text, text) from public, anon;
grant execute on function delivery_quote(text, text) to authenticated;


-- ---- 4. Cidade na venda ----

alter table sales add column if not exists city text;


-- ---- 5. create_order cobra a taxa da entrega ----

drop function if exists create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text);

create or replace function create_order(
  p_customer       uuid,
  p_payment_method text,
  p_items          jsonb,
  p_address        text    default null,
  p_neighborhood   text    default null,
  p_discount       numeric(12,2) default 0,
  p_counter_sale   boolean default false,
  p_offer          uuid    default null,
  p_is_traffic     boolean default false,
  p_notes          text    default null,
  p_city           text    default null
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale       sales;
  v_offer      offers;
  v_zone       delivery_zones;
  v_type       customer_type;
  v_item       jsonb;
  v_product    products;
  v_qty        integer;
  v_price      numeric(12,2);
  v_subtotal   numeric(12,2) := 0;
  v_units      integer := 0;
  v_fee        numeric(12,2) := 0;
  v_last       uuid;
begin
  if not is_staff() then raise exception 'Sem permissão para criar venda'; end if;

  if p_customer is null then
    if not p_counter_sale then
      raise exception 'Pedido para entrega precisa de um cliente cadastrado';
    end if;
    v_type := 'retail';
  else
    select customer_type into v_type from customers where id = p_customer;
    if not found then raise exception 'Cliente não encontrado'; end if;
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Adicione ao menos um produto';
  end if;

  -- entrega: a taxa sai da tabela de zonas e e cobrada do cliente
  if not p_counter_sale then
    if norm_place(p_city) is null then
      raise exception 'Informe a cidade da entrega';
    end if;
    v_zone := delivery_quote(p_city, p_neighborhood);
    if v_zone.id is null then
      raise exception 'Não há taxa de entrega cadastrada para %', p_city;
    end if;
    if not v_zone.serves then
      raise exception 'Não atendemos % - %', v_zone.city, coalesce(v_zone.neighborhood, '');
    end if;
    v_fee := v_zone.amount;
  end if;

  if p_offer is not null then
    select * into v_offer from offers where id = p_offer and active;
    if not found then raise exception 'Oferta não encontrada ou inativa'; end if;

    select coalesce(sum((i->>'quantity')::integer), 0) into v_units
      from jsonb_array_elements(p_items) i;

    if v_units <> v_offer.item_count then
      raise exception 'A oferta % exige % itens, e foram informados %',
        v_offer.name, v_offer.item_count, v_units;
    end if;

    v_price := round(v_offer.price / v_offer.item_count, 2);
  end if;

  insert into sales (customer_id, seller_id, payment_method, offer_id, is_traffic,
                     delivery_address, neighborhood, city, notes, delivery_fee,
                     subtotal, discount, total)
  values (p_customer, auth.uid(), p_payment_method, p_offer, coalesce(p_is_traffic, false),
          p_address, p_neighborhood, nullif(trim(p_city), ''), nullif(trim(p_notes), ''), v_fee,
          0, coalesce(p_discount, 0), 0)
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade inválida'; end if;

    select * into v_product from products
     where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Produto não encontrado'; end if;

    if v_product.available_stock < v_qty then
      raise exception 'Estoque insuficiente de %: disponível %, pedido %',
        v_product.name, v_product.available_stock, v_qty;
    end if;

    if p_offer is null then
      v_price := case v_type when 'wholesale' then v_product.wholesale_price
                             else v_product.price end;
    end if;

    insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, total)
    values (v_sale.id, v_product.id, v_product.name, v_qty, v_price, v_qty * v_price)
    returning id into v_last;

    update products set reserved_stock = reserved_stock + v_qty where id = v_product.id;

    insert into stock_movements (product_id, kind, quantity, sale_id, user_id)
    values (v_product.id, 'reserve', v_qty, v_sale.id, auth.uid());

    v_subtotal := v_subtotal + (v_qty * v_price);
  end loop;

  if p_offer is not null and v_subtotal <> v_offer.price then
    update sale_items
       set total = total + (v_offer.price - v_subtotal)
     where id = v_last;
    v_subtotal := v_offer.price;
  end if;

  update sales
     set subtotal   = v_subtotal,
         total      = greatest(v_subtotal - coalesce(p_discount, 0), 0) + v_fee,
         updated_at = now()
   where id = v_sale.id
  returning * into v_sale;

  insert into sale_status_history (sale_id, from_status, to_status, user_id)
  values (v_sale.id, null, 'new', auth.uid());

  if p_counter_sale then
    v_sale := transition_sale(v_sale.id, 'delivered');
  end if;

  return v_sale;
end $$;

revoke all on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text)
  from public, anon;
grant execute on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text)
  to authenticated;


-- ---- 6. Despacho mantem a taxa gravada no pedido ----
-- so pedido antigo, criado sem taxa, ainda usa a tabela por bairro.

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

  for v_id in select id from sales where route_id = p_route and status = 'picked' loop
    update sales set
      courier_id   = v_route.courier_id,
      delivery_fee = case
                       when delivery_fee > 0 then delivery_fee
                       else coalesce((select amount from delivery_fees f
                                       where f.neighborhood = sales.neighborhood), 0)
                     end
     where id = v_id;
    perform transition_sale(v_id, 'on_route');
    v_n := v_n + 1;
  end loop;

  update routes set dispatched_at = now() where id = p_route;
  return v_n;
end $$;
