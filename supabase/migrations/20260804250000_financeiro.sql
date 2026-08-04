-- ═══════════════════════════════════════════════════════════════════════
-- Financeiro: faturamento menos custos, com margem
--
-- Fontes de cada linha:
--   faturamento  · vendas entregues no período
--   produto      · oferta usa o custo do kit; avulso usa cost_price
--   motoboy      · taxa das entregas concluídas (fee_due)
--   tráfego      · gasto das campanhas no período
--   fixos        · valor mensal rateado pelos dias do período
--
-- O custo do produto tem UMA fonte por venda, nunca duas. Venda com
-- oferta não soma cost_price em cima do custo do kit.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1. Custo por oferta ───────────────────────────────────────────────
-- quanto custa montar um kit inteiro, não por item

create table if not exists offer_costs (
  offer_id   uuid primary key references offers(id) on delete cascade,
  kit_cost   numeric(12,2) not null check (kit_cost >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table offer_costs enable row level security;
drop policy if exists offer_costs_read  on offer_costs;
drop policy if exists offer_costs_admin on offer_costs;
create policy offer_costs_read  on offer_costs for select using (is_staff());
create policy offer_costs_admin on offer_costs for all
  using (current_has_role('admin')) with check (current_has_role('admin'));


-- ─── 2. Custos fixos ───────────────────────────────────────────────────
-- folha entra aqui. a tabela é genérica de propósito: aluguel, energia e
-- contador têm a mesma natureza e apareceriam depois de qualquer jeito.

create table if not exists fixed_costs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  monthly_amount numeric(12,2) not null check (monthly_amount >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

insert into fixed_costs (name, monthly_amount)
select 'Folha salarial', 0
where not exists (select 1 from fixed_costs);

alter table fixed_costs enable row level security;
drop policy if exists fixed_costs_read  on fixed_costs;
drop policy if exists fixed_costs_admin on fixed_costs;
create policy fixed_costs_read  on fixed_costs for select using (is_staff());
create policy fixed_costs_admin on fixed_costs for all
  using (current_has_role('admin')) with check (current_has_role('admin'));


-- ─── 3. Resultado do período ───────────────────────────────────────────

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
     where status = 'delivered'
       and created_at::date between p_from and p_to
  ),
  -- venda com oferta: custo do kit. uma venda = um kit.
  custo_oferta as (
    select coalesce(sum(c.kit_cost), 0) as valor
      from sales s
      join offer_costs c on c.offer_id = s.offer_id
     where s.status = 'delivered'
       and s.created_at::date between p_from and p_to
  ),
  -- venda avulsa: custo real dos itens
  custo_avulso as (
    select coalesce(sum(i.quantity * p.cost_price), 0) as valor
      from sales s
      join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id
     where s.status = 'delivered'
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


-- ─── 4. Resultado por oferta ───────────────────────────────────────────
-- o avulso entra como uma linha à parte, sem tráfego nem custo de kit

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
       and s.status = 'delivered'
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
    'Avulso (orgânico)',
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
       and status = 'delivered'
       and created_at::date between p_from and p_to
  ) v on true
  left join lateral (
    select sum(i.quantity * p.cost_price) as custo
      from sales s
      join sale_items i on i.sale_id = s.id
      join products p on p.id = i.product_id
     where s.offer_id is null
       and s.status = 'delivered'
       and s.created_at::date between p_from and p_to
  ) c on true;
$$;

revoke all on function financial_summary(date, date)  from public, anon;
revoke all on function financial_by_offer(date, date) from public, anon;
grant execute on function financial_summary(date, date)  to authenticated;
grant execute on function financial_by_offer(date, date) to authenticated;
