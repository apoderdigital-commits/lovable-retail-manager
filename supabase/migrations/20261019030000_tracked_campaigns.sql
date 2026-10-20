-- Campanhas acompanhadas, sem vinculo com oferta.
--
-- A oferta de cada venda ja sai sozinha da quantidade x valor no PDV, entao
-- nao faz mais sentido amarrar campanha a oferta. A tela de Configuracoes
-- passa a so marcar quais campanhas do Meta entram na conta de Marketing.
--
-- offer_campaigns fica no banco, mas deixa de ser usada pela tela.


-- ---- 1. Marca de campanha acompanhada ----

alter table ad_campaigns add column if not exists tracked boolean not null default false;

-- quem ja estava vinculado a alguma oferta continua acompanhado
update ad_campaigns set tracked = true
 where not tracked
   and id in (select campaign_id from offer_campaigns);


-- ---- 2. Desempenho por campanha acompanhada ----

create or replace function campaign_performance(p_from date, p_to date)
returns table (
  campaign_id   text,
  campaign_name text,
  spend         numeric,
  impressions   bigint,
  clicks        bigint,
  conversations bigint
)
language sql stable security definer set search_path = public as $$
  select c.id,
         c.name,
         coalesce(sum(i.spend), 0),
         coalesce(sum(i.impressions), 0)::bigint,
         coalesce(sum(i.clicks), 0)::bigint,
         coalesce(sum(i.conversations), 0)::bigint
    from ad_campaigns c
    left join ad_insights i
      on i.campaign_id = c.id
     and i.date between p_from and p_to
   where c.tracked
     and is_staff()
   group by c.id, c.name
   order by 3 desc;
$$;

revoke all on function campaign_performance(date, date) from public, anon;
grant execute on function campaign_performance(date, date) to authenticated;
