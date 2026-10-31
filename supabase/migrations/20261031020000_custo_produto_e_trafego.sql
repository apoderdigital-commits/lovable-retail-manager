-- Financeiro: custo dos produtos por item e trafego das campanhas
-- acompanhadas (pedido do usuario, 31/10/2026).
--
-- Custo dos produtos. Antes: venda com oferta contava UM custo de kit por
-- venda (offer_costs) e venda avulsa contava quantidade x cost_price. Desde
-- que o carrinho monta varios kits e mistura kit com unidade solta
-- (21/10), isso subcontava: 2 kits = custo de 1, unidade solta em venda
-- com oferta = custo zero, oferta sem kit configurado = custo zero.
-- Agora e uma regra so, a mesma da tabela "Custo de produto" da tela:
-- quantidade x cost_price de cada item, em toda venda nao cancelada.
-- offer_costs deixa de ser usada (a tabela fica, sem efeito).
--
-- Trafego. Antes somava ad_insights de TODAS as campanhas; o Marketing so
-- conta as campanhas marcadas como acompanhadas em Configuracoes. Agora o
-- Financeiro segue a mesma regra. O dado so existe depois de sincronizar
-- com o Meta (botao na tela ou o cron da migration seguinte).
--
-- So comentarios ASCII neste arquivo: caractere de caixa quebra o SQL Editor.

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
  -- quantidade x custo de cadastro, em todo item de toda venda
  custo_produto as (
    select coalesce(sum(i.quantity * p.cost_price), 0) as valor
      from sales s
      join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id
     where s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ),
  -- so campanhas acompanhadas, igual ao Marketing
  trafego as (
    select coalesce(sum(i.spend), 0) as valor
      from ad_insights i
      join ad_campaigns c on c.id = i.campaign_id
     where c.tracked
       and i.date between p_from and p_to
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
    'custo_produto', round((select valor from custo_produto), 2),
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
    coalesce(c.custo, 0),
    coalesce(v.motoboy, 0),
    coalesce(a.gasto, 0)
  from offers o
  left join lateral (
    select count(*) as pedidos,
           sum(s.total) as receita,
           sum(s.delivery_fee) filter (where s.fee_due) as motoboy
      from sales s
     where s.offer_id = o.id
       and s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ) v on true
  -- custo dos itens das vendas dessa oferta (kits e unidades soltas)
  left join lateral (
    select sum(i.quantity * p.cost_price) as custo
      from sales s
      join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id
     where s.offer_id = o.id
       and s.status <> 'cancelled'
       and s.created_at::date between p_from and p_to
  ) c on true
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

revoke all on function financial_summary(date, date)  from public, anon;
revoke all on function financial_by_offer(date, date) from public, anon;
grant execute on function financial_summary(date, date)  to authenticated;
grant execute on function financial_by_offer(date, date) to authenticated;
