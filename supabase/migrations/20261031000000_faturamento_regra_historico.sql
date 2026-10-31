-- Faturamento segue a regra do Historico de Vendas (decisao do usuario,
-- 31/10/2026): venda cancelada nao conta; todo o resto conta (nova, separada,
-- em rota, agendada, nao entregue, entregue).
--
-- Antes, Financeiro, Marketing, LTV e "total gasto" do cliente contavam so
-- status = 'delivered', e o Painel/Relatorios/Historico contavam tudo menos
-- cancelada. O mesmo mes dava numeros diferentes em cada tela.
--
-- O que NAO muda: taxa do motoboy continua so em fee_due (que so vira true na
-- entrega), e o acerto do entregador (route_*, close_route, sale_to_settle)
-- continua por entrega, porque e dinheiro em maos do entregador, nao
-- faturamento.
--
-- So comentarios ASCII neste arquivo: caractere de caixa quebra o SQL Editor.

-- ---- 1. Financeiro ----

create or replace function financial_summary(p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public as $$
  with dias as (
    select greatest((p_to - p_from) + 1, 1) as n
  ),
  vendas as (
    select coalesce(sum(total), 0) as receita,
           coalesce(sum(delivery_fee) filter (where fee_due), 0) as motoboy,
           count(*) as pedidos
      from sales
     where status <> 'cancelled'
       and created_at::date between p_from and p_to
  ),
  -- venda com oferta: custo do kit. uma venda = um kit.
  custo_oferta as (
    select coalesce(sum(c.kit_cost), 0) as valor
      from sales s
      join offer_costs c on c.offer_id = s.offer_id
     where s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ),
  -- venda avulsa: custo real dos itens
  custo_avulso as (
    select coalesce(sum(i.quantity * p.cost_price), 0) as valor
      from sales s
      join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id
     where s.status <> 'cancelled'
       and s.offer_id is null
       and s.created_at::date between p_from and p_to
  ),
  trafego as (
    select coalesce(sum(spend), 0) as valor
      from ad_insights
     where date between p_from and p_to
  ),
  fixos as (
    -- valor mensal rateado por dia (12 meses / 365 dias)
    select coalesce(sum(monthly_amount), 0) * 12.0 / 365.0 * (select n from dias) as valor
      from fixed_costs where active
  )
  select jsonb_build_object(
    'dias',          (select n from dias),
    'pedidos',       (select pedidos from vendas),
    'receita',       (select receita from vendas),
    'custo_produto', round((select valor from custo_oferta) + (select valor from custo_avulso), 2),
    'custo_motoboy', (select motoboy from vendas),
    'custo_trafego', (select valor from trafego),
    'custo_fixo',    round((select valor from fixos), 2)
  );
$$;

create or replace function financial_by_offer(p_from date, p_to date)
returns table (
  offer_id      uuid,
  offer_name    text,
  orders        bigint,
  revenue       numeric,
  product_cost  numeric,
  courier_cost  numeric,
  ad_cost       numeric
)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    o.name,
    coalesce(v.pedidos, 0),
    coalesce(v.receita, 0),
    coalesce(v.pedidos, 0) * coalesce(c.kit_cost, 0),
    coalesce(v.motoboy, 0),
    coalesce(a.gasto, 0)
  from offers o
  left join offer_costs c on c.offer_id = o.id
  left join lateral (
    select count(*) as pedidos,
           sum(s.total) as receita,
           sum(s.delivery_fee) filter (where s.fee_due) as motoboy
      from sales s
     where s.offer_id = o.id
       and s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ) v on true
  left join lateral (
    select sum(i.spend) as gasto
      from offer_campaigns oc
      join ad_insights i on i.campaign_id = oc.campaign_id
     where oc.offer_id = o.id
       and i.date between p_from and p_to
  ) a on true
  where o.active

  union all

  -- em subconsultas separadas: juntar itens na mesma query multiplicaria
  -- as linhas e o faturamento seria somado uma vez por item
  select
    null::uuid,
    'Avulso (organico)',
    coalesce(v.pedidos, 0),
    coalesce(v.receita, 0),
    coalesce(c.custo, 0),
    coalesce(v.motoboy, 0),
    0::numeric
  from (values (1)) as x(n)
  left join lateral (
    select count(*) as pedidos,
           sum(total) as receita,
           sum(delivery_fee) filter (where fee_due) as motoboy
      from sales
     where offer_id is null
       and status <> 'cancelled'
       and created_at::date between p_from and p_to
  ) v on true
  left join lateral (
    select sum(i.quantity * p.cost_price) as custo
      from sales s
      join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id
     where s.offer_id is null
       and s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ) c on true;
$$;

create or replace function product_cost_breakdown(p_from date, p_to date)
returns table (
  product_id   uuid,
  product_name text,
  quantity     bigint,
  unit_cost    numeric,
  total_cost   numeric,
  revenue      numeric
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.name,
    sum(i.quantity),
    p.cost_price,
    sum(i.quantity) * p.cost_price,
    sum(i.total)
  from sale_items i
  join sales s on s.id = i.sale_id
  join products p on p.id = i.product_id
  where s.status <> 'cancelled'
    and s.created_at::date between p_from and p_to
  group by p.id, p.name, p.cost_price
  order by sum(i.quantity) * p.cost_price desc;
$$;

-- ---- 2. Marketing ----

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
       and s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ) v on true
  where o.active
  order by o.item_count;
$$;

-- organico e tudo que nao veio de trafego, com ou sem oferta
create or replace function organic_performance(p_from date, p_to date)
returns table (sales_count bigint, revenue numeric, customers bigint)
language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(total), 0), count(distinct customer_id)
    from sales
   where not is_traffic
     and status <> 'cancelled'
     and created_at::date between p_from and p_to;
$$;

-- venda de trafego sem oferta especifica vinculada (avulsa)
create or replace function traffic_loose_performance(p_from date, p_to date)
returns table (sales_count bigint, revenue numeric, customers bigint)
language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(total), 0), count(distinct customer_id)
    from sales
   where offer_id is null
     and is_traffic
     and status <> 'cancelled'
     and created_at::date between p_from and p_to;
$$;

-- kit comprado sem vir de anuncio: as vendas novas ja vem com offer_id;
-- as antigas ainda sao reconhecidas por quantidade + valor
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
       and s.status <> 'cancelled'
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

create or replace function ltv_by_acquisition()
returns table (
  offer_id       uuid,
  offer_name     text,
  customers      bigint,
  total_revenue  numeric,
  avg_ltv        numeric,
  avg_orders     numeric
)
language sql stable security definer set search_path = public as $$
  with primeira as (
    select distinct on (customer_id)
           customer_id, offer_id
      from sales
     where status <> 'cancelled' and customer_id is not null
     order by customer_id, created_at
  ),
  vida as (
    select s.customer_id, sum(s.total) as receita, count(*) as pedidos
      from sales s
     where s.status <> 'cancelled' and s.customer_id is not null
     group by s.customer_id
  )
  select
    p.offer_id,
    coalesce(o.name, 'Sem oferta (organico)'),
    count(*)::bigint,
    sum(v.receita),
    round(avg(v.receita), 2),
    round(avg(v.pedidos), 2)
  from primeira p
  join vida v on v.customer_id = p.customer_id
  left join offers o on o.id = p.offer_id
  group by p.offer_id, o.name
  order by 5 desc nulls last;
$$;

-- ---- 3. Total gasto do cliente (PDV) ----

create or replace function customer_stats(p_customer uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders',        count(*),
    'total_spent',   coalesce(sum(total), 0),
    'last_order_at', max(created_at)
  )
  from sales
  where customer_id = p_customer
    and status <> 'cancelled';
$$;

-- grants: create or replace mantem os existentes; repetidos por seguranca
revoke all on function financial_summary(date, date)         from public, anon;
revoke all on function financial_by_offer(date, date)        from public, anon;
revoke all on function product_cost_breakdown(date, date)    from public, anon;
revoke all on function offer_performance(date, date)         from public, anon;
revoke all on function organic_performance(date, date)       from public, anon;
revoke all on function traffic_loose_performance(date, date) from public, anon;
revoke all on function organic_offer_match(date, date)       from public, anon;
revoke all on function ltv_by_acquisition()                  from public, anon;
revoke all on function customer_stats(uuid)                  from public, anon;
grant execute on function financial_summary(date, date)         to authenticated;
grant execute on function financial_by_offer(date, date)        to authenticated;
grant execute on function product_cost_breakdown(date, date)    to authenticated;
grant execute on function offer_performance(date, date)         to authenticated;
grant execute on function organic_performance(date, date)       to authenticated;
grant execute on function traffic_loose_performance(date, date) to authenticated;
grant execute on function organic_offer_match(date, date)       to authenticated;
grant execute on function ltv_by_acquisition()                  to authenticated;
grant execute on function customer_stats(uuid)                  to authenticated;
