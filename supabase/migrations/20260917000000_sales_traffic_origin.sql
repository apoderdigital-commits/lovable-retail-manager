-- Tráfego deixa de exigir bater com uma oferta fixa (4 por 100, 10 por
-- 200). Agora dá pra marcar qualquer venda (1, 2, 3... itens) como vinda
-- de tráfego, com ou sem oferta específica vinculada.
--
-- offer_id continua sendo "qual kit específico" (pra ROAS/campanha).
-- is_traffic é independente: verdadeiro sempre que offer_id existe, mas
-- também pode ser verdadeiro sozinho (venda avulsa que veio de anúncio).

alter table sales add column if not exists is_traffic boolean not null default false;

update sales set is_traffic = true where offer_id is not null and not is_traffic;

comment on column sales.offer_id is
  'Oferta específica (kit) vinculada, se a venda bateu com uma cadastrada. Nulo não significa orgânico — ver is_traffic.';
comment on column sales.is_traffic is
  'Veio de campanha (tráfego), com ou sem oferta específica vinculada. Falso = orgânico.';


-- ─── create_order com is_traffic ────────────────────────────────────────

drop function if exists create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid);

create or replace function create_order(
  p_customer       uuid,
  p_payment_method text,
  p_items          jsonb,
  p_address        text    default null,
  p_neighborhood   text    default null,
  p_discount       numeric(12,2) default 0,
  p_counter_sale   boolean default false,
  p_offer          uuid    default null,
  p_is_traffic     boolean default false
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
  v_is_traffic boolean;
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

  -- bater com uma oferta específica já é tráfego por definição, mesmo que
  -- o front esqueça de mandar a flag
  v_is_traffic := coalesce(p_is_traffic, false) or p_offer is not null;

  insert into sales (customer_id, seller_id, payment_method, offer_id, is_traffic,
                     delivery_address, neighborhood, subtotal, discount, total)
  values (p_customer, auth.uid(), p_payment_method, p_offer, v_is_traffic,
          p_address, p_neighborhood, 0, coalesce(p_discount, 0), 0)
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

revoke all on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean)
  from public, anon;
grant execute on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean)
  to authenticated;


-- ─── Marketing: orgânico de verdade vs. tráfego avulso ──────────────────
-- organic_performance contava tudo que não tinha oferta como orgânico;
-- agora isso inclui venda avulsa de tráfego, que precisa da própria conta.

create or replace function organic_performance(p_from date, p_to date)
returns table (sales_count bigint, revenue numeric, customers bigint)
language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(total), 0), count(distinct customer_id)
    from sales
   where offer_id is null
     and not is_traffic
     and status = 'delivered'
     and created_at::date between p_from and p_to;
$$;

-- venda de tráfego sem oferta específica vinculada (avulsa)
create or replace function traffic_loose_performance(p_from date, p_to date)
returns table (sales_count bigint, revenue numeric, customers bigint)
language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(total), 0), count(distinct customer_id)
    from sales
   where offer_id is null
     and is_traffic
     and status = 'delivered'
     and created_at::date between p_from and p_to;
$$;

revoke all on function traffic_loose_performance(date, date) from public, anon;
grant execute on function traffic_loose_performance(date, date) to authenticated;
