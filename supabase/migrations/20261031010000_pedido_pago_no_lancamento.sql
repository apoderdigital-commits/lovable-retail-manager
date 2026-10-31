-- Pagamento confirmado no lancamento do pedido (pedido do usuario, 31/10/2026).
--
-- O PDV pode marcar que o cliente ja pagou (pix antecipado, transferencia,
-- etc.). Nesse caso o motoboy nao cobra nada na entrega: so tira a foto da
-- entrega e conclui. O valor nao entra no acerto do entregador.
--
-- . sales.paid_at: quando o pagamento foi confirmado no lancamento. Nulo =
--   paga na entrega (comportamento de sempre).
-- . create_order ganha p_paid (default false). A assinatura antiga e
--   derrubada antes, senao o PostgREST fica com duas candidatas e recusa
--   a chamada.
-- . set_delivery_payment: entregador nao altera o pagamento de pedido pago.
-- . sale_to_settle: pedido pago = 0 no acerto (o entregador nao recebeu).
-- . route_payment_breakdown: pedido pago aparece como 'pago na loja', pra
--   conferencia, sem entrar como dinheiro ou pix do entregador.
-- . transition_sale nao muda: a foto continua obrigatoria pra concluir.
--
-- So comentarios ASCII neste arquivo: caractere de caixa quebra o SQL Editor.

-- ---- 1. Coluna ----

alter table sales add column if not exists paid_at timestamptz;

comment on column sales.paid_at is
  'Pagamento confirmado no lancamento do pedido. Nulo = cliente paga na entrega.';

-- ---- 2. create_order com p_paid ----

drop function if exists create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text);

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
  p_city           text    default null,
  p_paid           boolean default false
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale       sales;
  v_zone       delivery_zones;
  v_type       customer_type;
  v_item       jsonb;
  v_product    products;
  v_offer      offers;
  v_qty        integer;
  v_avail      integer;
  v_bundles    integer;
  v_take       integer;
  v_regular    numeric(12,2);
  v_unit       numeric(12,2);
  v_diff       numeric(12,2);
  v_subtotal   numeric(12,2) := 0;
  v_fee        numeric(12,2) := 0;
  v_main_offer uuid;
  v_row        record;
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

  -- uma linha por UNIDADE vendida: e assim que da pra separar, do mesmo
  -- produto, o que entrou no kit e o que foi cobrado normal
  drop table if exists _order_units;
  create temp table _order_units (
    seq        serial primary key,
    product_id uuid not null,
    category   uuid,
    regular    numeric(12,2) not null,
    unit_price numeric(12,2),
    offer_id   uuid,
    bundle     integer
  ) on commit drop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade inválida'; end if;

    select * into v_product from products
     where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Produto não encontrado'; end if;

    v_regular := case v_type when 'wholesale' then v_product.wholesale_price
                             else v_product.price end;

    insert into _order_units (product_id, category, regular)
    select v_product.id, v_product.category_id, v_regular
      from generate_series(1, v_qty);
  end loop;

  -- estoque conferido por produto (o mesmo produto pode vir em mais de uma linha)
  for v_row in select u.product_id, count(*)::integer as qty
                 from _order_units u group by u.product_id loop
    select * into v_product from products where id = v_row.product_id;
    if v_product.available_stock < v_row.qty then
      raise exception 'Estoque insuficiente de %: disponível %, pedido %',
        v_product.name, v_product.available_stock, v_row.qty;
    end if;
  end loop;

  -- kits: da maior oferta pra menor, com as unidades elegiveis mais baratas.
  -- Sem categoria configurada, o kit so junta produtos do MESMO preco (a
  -- mesma linha): 9 de R$ 25 + 1 de R$ 150 nao vira "10 por R$ 200".
  for v_offer in select * from offers where active order by item_count desc, price loop
    for v_row in
      select distinct case when cardinality(v_offer.category_ids) = 0 then regular end as grp
        from _order_units
       where offer_id is null
         and (cardinality(v_offer.category_ids) = 0 or category = any(v_offer.category_ids))
    loop
      select count(*) into v_avail
        from _order_units
       where offer_id is null
         and (cardinality(v_offer.category_ids) = 0 or category = any(v_offer.category_ids))
         and (v_row.grp is null or regular = v_row.grp);

      v_bundles := v_avail / v_offer.item_count;
      continue when v_bundles = 0;
      v_take := v_bundles * v_offer.item_count;

      -- so fecha se o kit nao sair mais caro que essas unidades no preco
      -- normal (igual conta: 4 de R$ 25 = "4 por R$ 100", pro Marketing)
      select coalesce(sum(regular), 0) into v_regular
        from (select regular from _order_units
               where offer_id is null
                 and (cardinality(v_offer.category_ids) = 0 or category = any(v_offer.category_ids))
                 and (v_row.grp is null or regular = v_row.grp)
               order by regular, seq
               limit v_take) t;
      continue when v_regular < v_bundles * v_offer.price;

      v_unit := round(v_offer.price / v_offer.item_count, 2);

      update _order_units u set
        offer_id   = v_offer.id,
        unit_price = v_unit
       where u.seq in (
         select seq from _order_units
          where offer_id is null
            and (cardinality(v_offer.category_ids) = 0 or category = any(v_offer.category_ids))
            and (v_row.grp is null or regular = v_row.grp)
          order by regular, seq
          limit v_take);

      v_main_offer := coalesce(v_main_offer, v_offer.id);
    end loop;
  end loop;

  update _order_units set unit_price = regular where unit_price is null;

  insert into sales (customer_id, seller_id, payment_method, offer_id, is_traffic,
                     delivery_address, neighborhood, city, notes, delivery_fee,
                     subtotal, discount, total, paid_at)
  values (p_customer, auth.uid(), p_payment_method, v_main_offer, coalesce(p_is_traffic, false),
          p_address, p_neighborhood, nullif(trim(p_city), ''), nullif(trim(p_notes), ''), v_fee,
          0, coalesce(p_discount, 0), 0,
          case when coalesce(p_paid, false) then now() end)
  returning * into v_sale;

  -- um item por produto + preco (o mesmo perfume pode ter parte no kit e
  -- parte no preco normal). Guarda qual item saiu de qual oferta pro ajuste
  -- de centavos logo abaixo.
  drop table if exists _order_groups;
  create temp table _order_groups (offer_id uuid, item_id uuid, seq integer) on commit drop;

  for v_row in
    select u.product_id, u.unit_price, u.offer_id, count(*)::integer as qty, min(u.seq) as first_seq
      from _order_units u
     group by u.product_id, u.unit_price, u.offer_id
     order by min(u.seq)
  loop
    select * into v_product from products where id = v_row.product_id;
    insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, total)
    values (v_sale.id, v_product.id, v_product.name, v_row.qty, v_row.unit_price,
            v_row.qty * v_row.unit_price)
    returning id into v_last;
    insert into _order_groups values (v_row.offer_id, v_last, v_row.first_seq);
    v_subtotal := v_subtotal + v_row.qty * v_row.unit_price;
  end loop;

  -- arredondamento: preco/quantidade pode nao fechar o valor do kit
  -- (ex.: 3 por R$ 100). A diferenca vai pro ultimo item de cada oferta.
  for v_row in
    select u.offer_id, count(*)::integer as units, sum(u.unit_price) as charged
      from _order_units u where u.offer_id is not null group by u.offer_id
  loop
    select * into v_offer from offers where id = v_row.offer_id;
    v_diff := (v_row.units / v_offer.item_count) * v_offer.price - v_row.charged;
    if v_diff <> 0 then
      update sale_items set total = total + v_diff
       where id = (select g.item_id from _order_groups g
                    where g.offer_id = v_row.offer_id
                    order by g.seq desc limit 1);
      v_subtotal := v_subtotal + v_diff;
    end if;
  end loop;

  for v_row in select u.product_id, count(*)::integer as qty
                 from _order_units u group by u.product_id loop
    update products set reserved_stock = reserved_stock + v_row.qty where id = v_row.product_id;
    insert into stock_movements (product_id, kind, quantity, sale_id, user_id)
    values (v_row.product_id, 'reserve', v_row.qty, v_sale.id, auth.uid());
  end loop;

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


revoke all on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text, boolean)
  from public, anon;
grant execute on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text, boolean)
  to authenticated;

-- ---- 3. Entregador nao mexe no pagamento de pedido pago ----

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

  -- pago no lancamento: o entregador nao mexe no pagamento, so entrega
  if v_sale.paid_at is not null and is_courier() then
    raise exception 'Pedido já pago no lançamento: o pagamento não muda na entrega';
  end if;

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


-- ---- 4. Acerto do entregador ----

-- pedido pago no lancamento: o entregador nao recebeu nada, nao repassa nada
create or replace function sale_to_settle(s sales)
returns numeric language sql immutable as $$
  select case when s.paid_at is not null then 0
              else sale_cash(s)
                 + case when s.pix_to = 'entregador' then sale_pix(s) else 0 end
         end
$$;

-- pedido pago no lancamento aparece como 'pago na loja' (valor cheio, sem
-- dividir em duas formas): o entregador confere a entrega, nao o dinheiro
create or replace function route_payment_breakdown(p_from date, p_to date)
returns table (
  courier_id     uuid,
  payment_method text,
  transactions   bigint,
  amount         numeric
)
language sql stable security definer set search_path = public as $$
  with parts as (
    select r.courier_id,
           case when s.paid_at is not null then 'pago na loja' else s.payment_method end as method,
           s.pix_to,
           case when s.paid_at is not null then s.total
                else s.total - coalesce(s.payment_amount_2, 0) end as amount
      from sales s join routes r on r.id = s.route_id
     where s.status = 'delivered'
       and r.date between p_from and p_to
       and (is_staff() or r.courier_id = auth.uid())
    union all
    select r.courier_id, s.payment_method_2, s.pix_to, s.payment_amount_2
      from sales s join routes r on r.id = s.route_id
     where s.status = 'delivered'
       and s.paid_at is null
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

revoke all on function set_delivery_payment(uuid, text, text, numeric, text) from public, anon;
grant execute on function set_delivery_payment(uuid, text, text, numeric, text) to authenticated;
revoke all on function route_payment_breakdown(date, date) from public, anon;
grant execute on function route_payment_breakdown(date, date) to authenticated;
