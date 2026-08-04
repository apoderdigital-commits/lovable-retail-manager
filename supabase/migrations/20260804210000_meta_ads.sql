-- ═══════════════════════════════════════════════════════════════════════
-- Integração com Meta Ads + métricas de marketing
--
-- O token fica numa tabela SÓ DE ESCRITA: não existe política de SELECT,
-- então nem admin lê pelo navegador. Só a Edge Function alcança, porque
-- roda com service role e passa por cima do RLS. Se o token vazasse pro
-- front, qualquer pessoa da equipe com o DevTools teria acesso de
-- leitura à conta de anúncios.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1. Credenciais ────────────────────────────────────────────────────

create table if not exists integration_settings (
  id            text primary key,
  ad_account_id text,
  access_token  text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

alter table integration_settings enable row level security;

-- de propósito: nenhuma política de SELECT. o token entra e não sai.
drop policy if exists integration_write  on integration_settings;
drop policy if exists integration_update on integration_settings;
create policy integration_write on integration_settings for insert
  with check (current_has_role('admin'));
create policy integration_update on integration_settings for update
  using (current_has_role('admin')) with check (current_has_role('admin'));

-- a tela precisa saber se está configurado sem ver o valor
create or replace function meta_settings_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when not current_has_role('admin') then jsonb_build_object('configured', false)
    else coalesce(
      (select jsonb_build_object(
         'configured',    coalesce(length(access_token), 0) > 0,
         'ad_account_id', ad_account_id,
         'token_tail',    right(coalesce(access_token, ''), 4),
         'updated_at',    updated_at)
         from integration_settings where id = 'meta_ads'),
      jsonb_build_object('configured', false))
  end
$$;


-- ─── 2. Dados vindos do Meta ───────────────────────────────────────────

create table if not exists ad_campaigns (
  id        text primary key,          -- id da campanha no Meta
  name      text not null,
  status    text,
  synced_at timestamptz not null default now()
);

-- os números do Meta mudam retroativamente por causa da janela de
-- atribuição, então a sincronização repuxa os últimos dias e sobrescreve.
-- daí a chave composta: é upsert, nunca append.
create table if not exists ad_insights (
  campaign_id   text not null references ad_campaigns(id) on delete cascade,
  date          date not null,
  spend         numeric(12,2) not null default 0,
  impressions   bigint not null default 0,
  reach         bigint not null default 0,
  clicks        bigint not null default 0,
  conversations integer not null default 0,
  synced_at     timestamptz not null default now(),
  primary key (campaign_id, date)
);
create index if not exists ad_insights_date_idx on ad_insights (date);

create table if not exists offer_campaigns (
  offer_id    uuid not null references offers(id) on delete cascade,
  campaign_id text not null references ad_campaigns(id) on delete cascade,
  primary key (offer_id, campaign_id)
);

alter table ad_campaigns    enable row level security;
alter table ad_insights     enable row level security;
alter table offer_campaigns enable row level security;

drop policy if exists campaigns_read     on ad_campaigns;
drop policy if exists campaigns_admin    on ad_campaigns;
drop policy if exists insights_read      on ad_insights;
drop policy if exists offercamp_read     on offer_campaigns;
drop policy if exists offercamp_admin    on offer_campaigns;

create policy campaigns_read  on ad_campaigns for select using (is_staff());
create policy campaigns_admin on ad_campaigns for all
  using (current_has_role('admin')) with check (current_has_role('admin'));
create policy insights_read   on ad_insights for select using (is_staff());
create policy offercamp_read  on offer_campaigns for select using (is_staff());
create policy offercamp_admin on offer_campaigns for all
  using (current_has_role('admin')) with check (current_has_role('admin'));


-- ─── 3. Desempenho por oferta ──────────────────────────────────────────
-- cruza o gasto das campanhas mapeadas com as vendas que usaram a oferta.
-- só conta venda entregue: pedido cancelado não é receita.

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
       and s.status = 'delivered'
       and s.created_at::date between p_from and p_to
  ) v on true
  where o.active
  order by o.item_count;
$$;


-- ─── 4. Vendas orgânicas ───────────────────────────────────────────────
-- venda sem oferta é a que não veio de campanha. serve de contraponto.

create or replace function organic_performance(p_from date, p_to date)
returns table (sales_count bigint, revenue numeric, customers bigint)
language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(total), 0), count(distinct customer_id)
    from sales
   where offer_id is null
     and status = 'delivered'
     and created_at::date between p_from and p_to;
$$;


-- ─── 5. LTV por oferta de entrada ──────────────────────────────────────
-- o cliente é atribuído à oferta da PRIMEIRA compra dele. depois soma-se
-- tudo que ele gastou desde então, inclusive avulso e recompra. é assim
-- que se descobre qual oferta traz cliente que volta.

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
     where status = 'delivered' and customer_id is not null
     order by customer_id, created_at
  ),
  vida as (
    select s.customer_id, sum(s.total) as receita, count(*) as pedidos
      from sales s
     where s.status = 'delivered' and s.customer_id is not null
     group by s.customer_id
  )
  select
    p.offer_id,
    coalesce(o.name, 'Sem oferta (orgânico)'),
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

revoke all on function meta_settings_status()               from public, anon;
revoke all on function offer_performance(date, date)        from public, anon;
revoke all on function organic_performance(date, date)      from public, anon;
revoke all on function ltv_by_acquisition()                 from public, anon;
grant execute on function meta_settings_status()            to authenticated;
grant execute on function offer_performance(date, date)     to authenticated;
grant execute on function organic_performance(date, date)   to authenticated;
grant execute on function ltv_by_acquisition()              to authenticated;
