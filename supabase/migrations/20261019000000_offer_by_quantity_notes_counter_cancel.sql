-- Três mudanças pedidas pela loja:
--
--   1. Oferta passa a valer pela quantidade (10 frascos = "10 por R$ 200"),
--      em venda orgânica ou de tráfego. Antes o PDV só reconhecia a oferta
--      quando a soma dos preços de tabela já dava o valor dela, o que nunca
--      acontecia no 10 por 200. Com isso offer_id deixa de significar
--      "veio de anúncio": quem diz a origem agora é só is_traffic.
--   2. Observação livre no pedido (sales.notes).
--   3. Venda de balcão já concluída pode ser cancelada (só admin), com o
--      estoque voltando pra prateleira.


-- ─── 1. Observação do pedido ────────────────────────────────────────────

alter table sales add column if not exists notes text;

comment on column sales.notes is 'Observação livre digitada ao tirar o pedido.';
comment on column sales.offer_id is
  'Oferta (kit) aplicada pela quantidade de itens. Não indica origem — ver is_traffic.';


-- ─── 2. create_order com observação e sem forçar tráfego pela oferta ────

drop function if exists create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean);

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
  p_notes          text    default null
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale       sales;
  v_offer      offers;
  v_type       customer_type;
  v_item       jsonb;
  v_product    products;
  v_qty        integer;
  v_price      numeric(12,2);
  v_subtotal   numeric(12,2) := 0;
  v_units      integer := 0;
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
                     delivery_address, neighborhood, notes, subtotal, discount, total)
  values (p_customer, auth.uid(), p_payment_method, p_offer, coalesce(p_is_traffic, false),
          p_address, p_neighborhood, nullif(trim(p_notes), ''), 0, coalesce(p_discount, 0), 0)
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
         total      = greatest(v_subtotal - coalesce(p_discount, 0), 0),
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

revoke all on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text)
  from public, anon;
grant execute on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text)
  to authenticated;


-- ─── 3. transition_sale: cancelar venda de balcão concluída ─────────────
-- balcão = concluída sem entregador nem rota. Só admin cancela, porque a
-- venda já foi paga; o estoque baixado volta pra prateleira.

create or replace function transition_sale(
  p_sale     uuid,
  p_to       order_status,
  p_reason   text default null,
  p_proof    text default null,
  p_schedule date default null
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale    sales;
  v_from    order_status;
  v_uid     uuid := auth.uid();
  v_item    record;
  v_counter boolean;
begin
  select * into v_sale from sales where id = p_sale for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  v_from := v_sale.status;
  v_counter := v_sale.courier_id is null and v_sale.route_id is null;

  -- a transição existe no ciclo?
  if not (
       (v_from = 'new'      and p_to in ('picked','cancelled','delivered'))  -- delivered = balcão
    or (v_from = 'picked'   and p_to in ('on_route','cancelled'))
    or (v_from = 'on_route' and p_to in ('delivered','scheduled','not_delivered','cancelled'))
    or (v_from in ('scheduled','not_delivered') and p_to in ('picked','cancelled'))
    or (v_from = 'delivered' and p_to = 'cancelled' and v_counter)
  ) then
    raise exception 'Transição inválida: % -> %', v_from, p_to;
  end if;

  -- quem pode
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
    if v_from = 'delivered' and not current_has_role('admin') then
      raise exception 'Venda concluída só pode ser cancelada por admin';
    end if;
    if not is_staff() then raise exception 'Sem permissão para cancelar'; end if;

  else
    if not is_staff() then raise exception 'Sem permissão para essa transição'; end if;
  end if;

  -- exigências
  if p_to in ('not_delivered','cancelled') and coalesce(p_reason, '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;
  if p_to = 'scheduled' and p_schedule is null then
    raise exception 'Informe a data do reagendamento';
  end if;

  -- estoque
  if p_to = 'delivered' then
    for v_item in select product_id, quantity from sale_items where sale_id = p_sale loop
      update products
         set stock          = stock          - v_item.quantity,
             reserved_stock = reserved_stock - v_item.quantity
       where id = v_item.product_id;
      insert into stock_movements (product_id, kind, quantity, sale_id, user_id)
      values (v_item.product_id, 'writeoff', v_item.quantity, p_sale, v_uid);
    end loop;

  elsif p_to = 'cancelled' and v_from = 'delivered' then
    -- já tinha saído da prateleira: volta pro saldo físico
    for v_item in select product_id, quantity from sale_items
                   where sale_id = p_sale and product_id is not null loop
      update products set stock = stock + v_item.quantity
       where id = v_item.product_id;
      insert into stock_movements (product_id, kind, quantity, sale_id, user_id, note)
      values (v_item.product_id, 'inbound', v_item.quantity, p_sale, v_uid,
              'Estorno de venda de balcão cancelada');
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

  -- grava
  perform set_config('app.transition_ok', 'on', true);

  update sales set
    status        = p_to,
    fee_due       = (p_to = 'delivered' and courier_id is not null),
    proof_url     = coalesce(p_proof,  proof_url),
    reason        = coalesce(p_reason, reason),
    scheduled_for = case when p_to = 'scheduled' then p_schedule else scheduled_for end,
    route_id      = case when p_to = 'picked' then null else route_id end,
    updated_at    = now()
  where id = p_sale
  returning * into v_sale;

  perform set_config('app.transition_ok', 'off', true);

  insert into sale_status_history (sale_id, from_status, to_status, user_id, reason, attachment_url)
  values (p_sale, v_from, p_to, v_uid, p_reason, p_proof);

  return v_sale;
end $$;


-- ─── 4. Marketing: oferta não é mais sinônimo de tráfego ────────────────

-- desempenho da campanha conta só venda de tráfego que usou a oferta
create or replace function offer_performance(p_from date, p_to date)
returns table (
  offer_id      uuid,
  offer_name    text,
  spend         numeric,
  conversations bigint,
  clicks        bigint,
  sales_count   bigint,
  revenue       numeric,
  customers     bigint
)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    o.name,
    coalesce(a.spend, 0),
    coalesce(a.conversations, 0),
    coalesce(a.clicks, 0),
    coalesce(v.sales_count, 0),
    coalesce(v.revenue, 0),
    coalesce(v.customers, 0)
  from offers o
  left join lateral (
    select sum(i.spend) as spend,
           sum(i.conversations) as conversations,
           sum(i.clicks) as clicks
      from offer_campaigns oc
      join ad_insights i on i.campaign_id = oc.campaign_id
     where oc.offer_id = o.id
       and i.date between p_from and p_to
  ) a on true
  left join lateral (
    select count(*) as sales_count,
           sum(s.total) as revenue,
           count(distinct s.customer_id) as customers
      from sales s
     where s.offer_id = o.id
       and s.is_traffic
       and s.status = 'delivered'
       and s.created_at::date between p_from and p_to
  ) v on true
  where o.active
  order by o.item_count;
$$;

-- orgânico é tudo que não veio de tráfego, com ou sem oferta
create or replace function organic_performance(p_from date, p_to date)
returns table (sales_count bigint, revenue numeric, customers bigint)
language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(total), 0), count(distinct customer_id)
    from sales
   where not is_traffic
     and status = 'delivered'
     and created_at::date between p_from and p_to;
$$;

-- kit comprado sem vir de anúncio: as vendas novas já vêm com offer_id;
-- as antigas ainda são reconhecidas por quantidade + valor
create or replace function organic_offer_match(p_from date, p_to date)
returns table (
  offer_id    uuid,
  offer_name  text,
  sales_count bigint,
  revenue     numeric,
  customers   bigint
)
language sql stable security definer set search_path = public as $$
  with organic as (
    select s.id, s.offer_id, s.customer_id, s.subtotal, s.total
      from sales s
     where not s.is_traffic
       and s.status = 'delivered'
       and s.created_at::date between p_from and p_to
  ),
  units as (
    select sale_id, sum(quantity) as units
      from sale_items
     where sale_id in (select id from organic)
     group by sale_id
  )
  select
    o.id,
    o.name,
    count(*)::bigint,
    coalesce(sum(organic.total), 0),
    count(distinct organic.customer_id)
  from organic
  join units u on u.sale_id = organic.id
  join offers o on o.active
               and (organic.offer_id = o.id
                    or (organic.offer_id is null
                        and o.item_count = u.units
                        and abs(o.price - organic.subtotal) < 0.01))
  group by o.id, o.name;
$$;
