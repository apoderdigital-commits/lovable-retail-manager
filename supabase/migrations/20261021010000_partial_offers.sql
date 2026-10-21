-- Oferta dentro do carrinho, nao do carrinho inteiro.
--
-- Antes "10 por R$ 200" so valia se o carrinho tivesse EXATAMENTE 10
-- unidades: com 10 da linha da oferta + 1 de outra linha (R$ 150), a oferta
-- sumia e tudo voltava ao preco cheio. Agora o banco monta os kits sozinho:
--   . cada oferta pode ser limitada a categorias (offers.category_ids);
--     vazio = qualquer produto, mas o kit so junta produtos do mesmo preco
--   . da maior oferta pra menor, junta as unidades elegiveis mais baratas
--     em kits (10 da linha -> 1 kit; 20 -> 2 kits; 14 -> 10 + 4)
--   . so fecha o kit se nao sair mais caro que o preco normal das unidades
--   . o que sobra e cobrado pelo preco da tabela do cliente
-- Exemplo do video: 10 x R$ 25 (kit R$ 200) + 1 x R$ 150 = R$ 350.
--
-- p_offer continua na assinatura so pra nao quebrar chamadas antigas: o
-- banco ignora e decide a oferta pelas regras acima.


-- ---- 1. Categorias de cada oferta ----

alter table offers add column if not exists category_ids uuid[] not null default '{}';

comment on column offers.category_ids is
  'Categorias (linhas) que entram nesta oferta. Vazio = qualquer produto.';


-- ---- 2. create_order com kits automaticos ----

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
                     subtotal, discount, total)
  values (p_customer, auth.uid(), p_payment_method, v_main_offer, coalesce(p_is_traffic, false),
          p_address, p_neighborhood, nullif(trim(p_city), ''), nullif(trim(p_notes), ''), v_fee,
          0, coalesce(p_discount, 0), 0)
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

revoke all on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text)
  from public, anon;
grant execute on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text)
  to authenticated;
