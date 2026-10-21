-- Regras pedidas pela loja:
--   1. Cancelamento
--      . venda de balcao: o vendedor que fez pode cancelar (admin tambem),
--        inclusive ja concluida (o estoque volta pra prateleira)
--      . pedido de entrega (online): so admin cancela
--   2. Pagamento na entrega: o entregador pode trocar a forma de pagamento
--      e dividir em duas formas (ex.: parte no pix, parte em dinheiro).
--      A segunda forma fica em payment_method_2 / payment_amount_2; a
--      primeira e o resto do total.


-- ---- 1. Segunda forma de pagamento ----

alter table sales
  add column if not exists payment_method_2 text,
  add column if not exists payment_amount_2 numeric(12,2) not null default 0;

comment on column sales.payment_method_2 is
  'Segunda forma de pagamento, quando o cliente divide. A primeira (payment_method) fica com total - payment_amount_2.';

-- quanto da venda entrou em especie (o que o entregador acerta em maos)
create or replace function sale_cash(s sales)
returns numeric language sql immutable as $$
  select (case when s.payment_method = 'dinheiro'
               then s.total - coalesce(s.payment_amount_2, 0) else 0 end)
       + (case when s.payment_method_2 = 'dinheiro'
               then coalesce(s.payment_amount_2, 0) else 0 end)
$$;


-- ---- 2. Trocar / dividir o pagamento na hora da entrega ----

create or replace function set_delivery_payment(
  p_sale     uuid,
  p_method   text,
  p_method_2 text    default null,
  p_amount_2 numeric default 0
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale  sales;
  v_ok    text[] := array['dinheiro','pix','débito','crédito','boleto'];
begin
  select * into v_sale from sales where id = p_sale for update;
  if not found then raise exception 'Venda não encontrada'; end if;

  -- o entregador mexe só no pedido que está com ele, em rota; equipe da loja
  -- pode ajustar enquanto o pedido não foi concluído
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

  update sales set
    payment_method   = p_method,
    payment_method_2 = p_method_2,
    payment_amount_2 = coalesce(p_amount_2, 0),
    updated_at       = now()
  where id = p_sale
  returning * into v_sale;

  return v_sale;
end $$;

revoke all on function set_delivery_payment(uuid, text, text, numeric) from public, anon;
grant execute on function set_delivery_payment(uuid, text, text, numeric) to authenticated;


-- ---- 3. Especie e quebra por forma levam a divisao em conta ----

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
    'cash_in_hand',  coalesce(sum(sale_cash(s)) filter (where s.status = 'delivered'), 0)
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
    coalesce(sum(sale_cash(s)) filter (where s.status = 'delivered'), 0)
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
    coalesce(sum(sale_cash(s)) filter (where s.status = 'delivered'), 0)
  from routes r
  left join sales s on s.route_id = r.id
  where r.date between p_from and p_to
    and (is_staff() or r.courier_id = auth.uid())
  group by r.courier_id
  order by r.courier_id;
$$;

-- cada forma conta separado: uma venda dividida aparece nas duas
create or replace function route_payment_breakdown(p_from date, p_to date)
returns table (
  courier_id     uuid,
  payment_method text,
  transactions   bigint,
  amount         numeric
)
language sql stable security definer set search_path = public as $$
  with parts as (
    select r.courier_id, s.payment_method as method,
           s.total - coalesce(s.payment_amount_2, 0) as amount
      from sales s join routes r on r.id = s.route_id
     where s.status = 'delivered'
       and r.date between p_from and p_to
       and (is_staff() or r.courier_id = auth.uid())
    union all
    select r.courier_id, s.payment_method_2, s.payment_amount_2
      from sales s join routes r on r.id = s.route_id
     where s.status = 'delivered'
       and s.payment_method_2 is not null
       and r.date between p_from and p_to
       and (is_staff() or r.courier_id = auth.uid())
  )
  select courier_id, method, count(*), coalesce(sum(amount), 0)
    from parts
   group by courier_id, method
   order by courier_id, method;
$$;


-- ---- 4. Quem cancela o que ----

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
