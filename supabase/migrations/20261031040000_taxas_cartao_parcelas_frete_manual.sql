-- Taxa da maquininha repassada ao cliente, parcelas, frete manual e pedido
-- por Correios (pedido do usuario, 31/10/2026).
--
-- Taxas. payment_fees guarda a porcentagem por forma e parcela (editavel em
-- Configuracoes). Debito e credito (1x a 18x) sao somados em cima do valor
-- e cobrados do cliente: R$ 100 no credito 5x (7,31%) vira R$ 107,31. Pix
-- (0,56%) NAO e cobrado do cliente, fica por conta da loja. As duas coisas
-- entram em "Impostos" no Financeiro (sales.fee_cost); como a taxa do
-- cartao tambem entra no faturamento, ela e neutra no lucro; a do pix
-- reduz o lucro.
--
-- Onde a taxa mora: sales.surcharge_1 / surcharge_2 (uma por forma de
-- pagamento, somadas em sales.total), sales.installments (parcelas do
-- credito), sales.fee_cost (custo total das taxas). apply_payment_fees
-- recalcula tudo a partir do total base (produtos - desconto + entrega);
-- create_order e set_delivery_payment chamam ela, entao a taxa acompanha
-- a forma escolhida no PDV ou trocada pelo entregador.
--
-- Frete manual. Regiao sem taxa cadastrada: o PDV manda p_manual_fee com
-- p_shipping_method 'motoboy' (taxa digitada) ou 'correios' (valor do frete
-- cobrado do cliente). Pedido por Correios nao entra em rota: vai de
-- 'picked' direto pra 'delivered' pela post_correios, com codigo de rastreio.
-- O frete dos Correios entra no Financeiro como custo (custo_correios),
-- neutro porque foi cobrado do cliente.
--
-- Assinaturas antigas de create_order e set_delivery_payment sao derrubadas
-- antes, senao o PostgREST acha duas candidatas e recusa a chamada.
--
-- So comentarios ASCII neste arquivo: caractere de caixa quebra o SQL Editor.

-- ---- 1. Tabela de taxas ----

create table if not exists payment_fees (
  method       text    not null,
  installments integer not null default 1 check (installments >= 1),
  rate_pct     numeric(6,2) not null default 0 check (rate_pct >= 0),
  updated_at   timestamptz not null default now(),
  primary key (method, installments)
);

comment on table payment_fees is
  'Taxa da maquininha por forma de pagamento e parcela, em porcento. Debito e credito sao repassados ao cliente; pix fica com a loja.';

alter table payment_fees enable row level security;
drop policy if exists payment_fees_read  on payment_fees;
drop policy if exists payment_fees_admin on payment_fees;
create policy payment_fees_read  on payment_fees for select using (is_staff());
create policy payment_fees_admin on payment_fees for all
  using (current_has_role('admin')) with check (current_has_role('admin'));

insert into payment_fees (method, installments, rate_pct) values
  ('pix',      1, 0.56),
  ('débito',   1, 1.66),
  ('crédito',  1, 3.50),
  ('crédito',  2, 5.26),
  ('crédito',  3, 5.95),
  ('crédito',  4, 6.63),
  ('crédito',  5, 7.31),
  ('crédito',  6, 7.98),
  ('crédito',  7, 9.34),
  ('crédito',  8, 10.00),
  ('crédito',  9, 10.65),
  ('crédito', 10, 11.29),
  ('crédito', 11, 11.93),
  ('crédito', 12, 12.57),
  ('crédito', 13, 13.19),
  ('crédito', 14, 13.81),
  ('crédito', 15, 14.43),
  ('crédito', 16, 15.04),
  ('crédito', 17, 15.65),
  ('crédito', 18, 16.24)
on conflict (method, installments) do nothing;

-- ---- 2. Colunas em sales ----

alter table sales
  add column if not exists installments    integer not null default 1,
  add column if not exists surcharge_1     numeric(12,2) not null default 0,
  add column if not exists surcharge_2     numeric(12,2) not null default 0,
  add column if not exists fee_cost        numeric(12,2) not null default 0,
  add column if not exists shipping_method text not null default 'motoboy',
  add column if not exists tracking_code   text;

alter table sales drop constraint if exists sales_shipping_method_check;
alter table sales add constraint sales_shipping_method_check
  check (shipping_method in ('motoboy', 'correios'));

comment on column sales.surcharge_1 is 'Taxa da maquininha da 1a forma, cobrada do cliente e somada em total.';
comment on column sales.surcharge_2 is 'Taxa da maquininha da 2a forma, cobrada do cliente e somada em total.';
comment on column sales.fee_cost    is 'Custo das taxas (cartao repassado + pix por conta da loja). Financeiro > Impostos.';
comment on column sales.installments is 'Parcelas do credito (1 = a vista). Vale pra forma que for credito.';

-- ---- 3. Calculo ----

create or replace function payment_fee_pct(p_method text, p_installments integer)
returns numeric language sql stable as $$
  select coalesce((
    select rate_pct from payment_fees
     where method = p_method
       and installments = case when p_method = 'crédito'
                               then greatest(coalesce(p_installments, 1), 1)
                               else 1 end
  ), 0)
$$;

-- recalcula taxa cobrada, custo da taxa e total a partir do total base.
-- base = produtos - desconto + entrega; a 2a forma paga payment_amount_2
-- (sem taxa) e a 1a paga o resto.
create or replace function apply_payment_fees(p_sale uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s      sales;
  v_base   numeric(12,2);
  v_base_1 numeric(12,2);
  v_base_2 numeric(12,2);
  v_s1     numeric(12,2) := 0;
  v_s2     numeric(12,2) := 0;
  v_cost   numeric(12,2) := 0;
begin
  select * into v_s from sales where id = p_sale for update;
  if not found then return; end if;

  v_base   := greatest(v_s.subtotal - coalesce(v_s.discount, 0), 0) + coalesce(v_s.delivery_fee, 0);
  v_base_2 := case when v_s.payment_method_2 is null then 0 else coalesce(v_s.payment_amount_2, 0) end;
  v_base_1 := greatest(v_base - v_base_2, 0);

  if v_s.payment_method in ('débito', 'crédito') then
    v_s1 := round(v_base_1 * payment_fee_pct(v_s.payment_method, v_s.installments) / 100, 2);
    v_cost := v_cost + v_s1;
  elsif v_s.payment_method = 'pix' then
    v_cost := v_cost + round(v_base_1 * payment_fee_pct('pix', 1) / 100, 2);
  end if;

  if v_s.payment_method_2 in ('débito', 'crédito') then
    v_s2 := round(v_base_2 * payment_fee_pct(v_s.payment_method_2, v_s.installments) / 100, 2);
    v_cost := v_cost + v_s2;
  elsif v_s.payment_method_2 = 'pix' then
    v_cost := v_cost + round(v_base_2 * payment_fee_pct('pix', 1) / 100, 2);
  end if;

  update sales set
    surcharge_1 = v_s1,
    surcharge_2 = v_s2,
    fee_cost    = v_cost,
    total       = v_base + v_s1 + v_s2,
    updated_at  = now()
  where id = p_sale;
end $$;

revoke all on function apply_payment_fees(uuid) from public, anon, authenticated;

-- ---- 4. Funcoes que gravam venda ----

drop function if exists create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text, boolean);
drop function if exists set_delivery_payment(uuid, text, text, numeric, text);

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
  p_paid           boolean default false,
  p_installments   integer default 1,
  p_shipping_method text   default 'motoboy',
  p_manual_fee     numeric(12,2) default null
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
    if coalesce(p_shipping_method, 'motoboy') not in ('motoboy', 'correios') then
      raise exception 'Forma de envio inválida';
    end if;
    if p_manual_fee is not null then
      -- regiao sem taxa cadastrada: valor digitado no PDV (motoboy ou Correios)
      if p_manual_fee < 0 then raise exception 'Taxa de entrega inválida'; end if;
      v_fee := p_manual_fee;
    else
      v_zone := delivery_quote(p_city, p_neighborhood);
      if v_zone.id is null then
        raise exception 'Não há taxa de entrega cadastrada para %', p_city;
      end if;
      if not v_zone.serves then
        raise exception 'Não atendemos % - %', v_zone.city, coalesce(v_zone.neighborhood, '');
      end if;
      v_fee := v_zone.amount;
    end if;
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
                     subtotal, discount, total, paid_at, installments, shipping_method)
  values (p_customer, auth.uid(), p_payment_method, v_main_offer, coalesce(p_is_traffic, false),
          p_address, p_neighborhood, nullif(trim(p_city), ''), nullif(trim(p_notes), ''), v_fee,
          0, coalesce(p_discount, 0), 0,
          case when coalesce(p_paid, false) then now() end,
          greatest(coalesce(p_installments, 1), 1),
          case when p_counter_sale then 'motoboy' else coalesce(p_shipping_method, 'motoboy') end)
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

  -- taxa da maquininha em cima do total (debito/credito) e custo da taxa
  perform apply_payment_fees(v_sale.id);
  select * into v_sale from sales where id = v_sale.id;

  insert into sale_status_history (sale_id, from_status, to_status, user_id)
  values (v_sale.id, null, 'new', auth.uid());

  if p_counter_sale then
    v_sale := transition_sale(v_sale.id, 'delivered');
  end if;

  return v_sale;
end $$;

create or replace function set_delivery_payment(
  p_sale     uuid,
  p_method   text,
  p_method_2 text    default null,
  p_amount_2 numeric default 0,
  p_pix_to   text    default null,
  p_installments integer default 1
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale  sales;
  v_ok    text[] := array['dinheiro','pix','débito','crédito','boleto'];
  v_base  numeric(12,2);
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
    -- compara com o total SEM a taxa do cartao: a taxa e recalculada depois
    v_base := greatest(v_sale.subtotal - v_sale.discount, 0) + v_sale.delivery_fee;
    if coalesce(p_amount_2, 0) <= 0 or p_amount_2 >= v_base then
      raise exception 'O valor da segunda forma precisa ser maior que zero e menor que o total (%)', v_base;
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
    installments     = greatest(coalesce(p_installments, 1), 1),
    updated_at       = now()
  where id = p_sale;

  perform apply_payment_fees(p_sale);
  select * into v_sale from sales where id = p_sale;

  return v_sale;
end $$;

create or replace function transition_sale(
  p_sale     uuid,
  p_to       order_status,
  p_reason   text default null,
  p_proof    text default null,
  p_schedule date default null
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale     sales;
  v_from     order_status;
  v_uid      uuid := auth.uid();
  v_item     record;
  v_counter  boolean;
begin
  select * into v_sale from sales where id = p_sale for update;
  if not found then raise exception 'Venda não encontrada'; end if;
  v_from := v_sale.status;
  -- balcao: sem endereco de entrega, sem entregador, sem rota
  v_counter := v_sale.delivery_address is null
           and v_sale.courier_id is null and v_sale.route_id is null;

  if not (
       (v_from = 'new'      and p_to in ('picked','cancelled','delivered'))
    or (v_from = 'picked'   and p_to in ('on_route','cancelled'))
    or (v_from = 'picked'   and p_to = 'delivered' and v_sale.shipping_method = 'correios')
    or (v_from = 'on_route' and p_to in ('delivered','scheduled','not_delivered','cancelled'))
    or (v_from in ('scheduled','not_delivered') and p_to in ('picked','cancelled'))
    or (v_from = 'delivered' and p_to = 'cancelled' and v_counter)
  ) then
    raise exception 'Transição inválida: % -> %', v_from, p_to;
  end if;

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
      if not is_staff() then raise exception 'Sem permissão'; end if;
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
    if not is_staff() then raise exception 'Sem permissão para cancelar'; end if;
    if not current_has_role('admin') then
      if not v_counter then
        raise exception 'Pedido de entrega só pode ser cancelado por admin';
      end if;
      if v_sale.seller_id is distinct from v_uid then
        raise exception 'Você só pode cancelar as vendas que você fez';
      end if;
    end if;

  else
    if not is_staff() then raise exception 'Sem permissão para essa transição'; end if;
  end if;

  if p_to in ('not_delivered','cancelled') and coalesce(p_reason, '') = '' then
    raise exception 'Motivo é obrigatório';
  end if;
  if p_to = 'scheduled' and p_schedule is null then
    raise exception 'Informe a data do reagendamento';
  end if;

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

revoke all on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text, boolean, integer, text, numeric)
  from public, anon;
grant execute on function create_order(uuid, text, jsonb, text, text, numeric, boolean, uuid, boolean, text, text, boolean, integer, text, numeric)
  to authenticated;
revoke all on function set_delivery_payment(uuid, text, text, numeric, text, integer) from public, anon;
grant execute on function set_delivery_payment(uuid, text, text, numeric, text, integer) to authenticated;

-- ---- 5. Postagem nos Correios ----

create or replace function post_correios(p_sale uuid, p_tracking text default null)
returns sales
language plpgsql security definer set search_path = public as $$
declare v_sale sales;
begin
  if not is_staff() then raise exception 'Sem permissão'; end if;
  select * into v_sale from sales where id = p_sale;
  if not found then raise exception 'Venda não encontrada'; end if;
  if v_sale.shipping_method <> 'correios' then
    raise exception 'Este pedido não é por Correios';
  end if;
  update sales set tracking_code = nullif(trim(coalesce(p_tracking, '')), '') where id = p_sale;
  return transition_sale(p_sale, 'delivered');
end $$;

revoke all on function post_correios(uuid, text) from public, anon;
grant execute on function post_correios(uuid, text) to authenticated;

-- ---- 6. Acerto do entregador: valores sem a taxa da outra forma ----

-- 1a forma paga total - 2a forma - taxas; dinheiro e pix nao tem taxa propria
create or replace function sale_cash(s sales)
returns numeric language sql immutable as $$
  select (case when s.payment_method = 'dinheiro'
               then s.total - coalesce(s.payment_amount_2, 0)
                    - coalesce(s.surcharge_1, 0) - coalesce(s.surcharge_2, 0)
               else 0 end)
       + (case when s.payment_method_2 = 'dinheiro'
               then coalesce(s.payment_amount_2, 0) else 0 end)
$$;

create or replace function sale_pix(s sales)
returns numeric language sql immutable as $$
  select (case when s.payment_method = 'pix'
               then s.total - coalesce(s.payment_amount_2, 0)
                    - coalesce(s.surcharge_1, 0) - coalesce(s.surcharge_2, 0)
               else 0 end)
       + (case when s.payment_method_2 = 'pix'
               then coalesce(s.payment_amount_2, 0) else 0 end)
$$;

-- cada forma aparece com o que o cliente pagou nela, taxa inclusa
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
                else s.total - coalesce(s.payment_amount_2, 0) - coalesce(s.surcharge_2, 0) end as amount
      from sales s join routes r on r.id = s.route_id
     where s.status = 'delivered'
       and r.date between p_from and p_to
       and (is_staff() or r.courier_id = auth.uid())
    union all
    select r.courier_id, s.payment_method_2, s.pix_to,
           coalesce(s.payment_amount_2, 0) + coalesce(s.surcharge_2, 0)
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

-- ---- 7. Financeiro: Impostos e Correios ----

create or replace function financial_summary(p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public as $$
  with dias as (
    select greatest((p_to - p_from) + 1, 1) as n
  ),
  vendas as (
    select coalesce(sum(total), 0) as receita,
           coalesce(sum(delivery_fee) filter (where fee_due), 0) as motoboy,
           coalesce(sum(delivery_fee) filter (where shipping_method = 'correios'), 0) as correios,
           coalesce(sum(fee_cost), 0) as taxas,
           count(*) as pedidos
      from sales
     where status <> 'cancelled'
       and created_at::date between p_from and p_to
  ),
  custo_produto as (
    select coalesce(sum(i.quantity * p.cost_price), 0) as valor
      from sales s
      join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id
     where s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ),
  trafego as (
    select coalesce(sum(i.spend), 0) as valor
      from ad_insights i
      join ad_campaigns c on c.id = i.campaign_id
     where c.tracked
       and i.date between p_from and p_to
  ),
  fixos as (
    select coalesce(sum(monthly_amount), 0) * 12.0 / 365.0 * (select n from dias) as valor
      from fixed_costs where active
  )
  select jsonb_build_object(
    'dias',           (select n from dias),
    'pedidos',        (select pedidos from vendas),
    'receita',        (select receita from vendas),
    'custo_produto',  round((select valor from custo_produto), 2),
    'custo_motoboy',  (select motoboy from vendas),
    'custo_correios', (select correios from vendas),
    'custo_taxas',    (select taxas from vendas),
    'custo_trafego',  (select valor from trafego),
    'custo_fixo',     round((select valor from fixos), 2)
  );
$$;

revoke all on function financial_summary(date, date) from public, anon;
grant execute on function financial_summary(date, date) to authenticated;
