-- Resumo de entregas por período (não só o dia de hoje) e quebra por forma
-- de pagamento — usados nos dashboards de Entregas e no painel do
-- entregador, que hoje só enxergam a soma de tudo em espécie.
--
-- Mesma regra de acesso de route_day_summary: staff vê qualquer motoboy,
-- entregador só enxerga a própria rota.

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
    coalesce(sum(s.total) filter (
      where s.status = 'delivered' and s.payment_method = 'dinheiro'
    ), 0)
  from routes r
  left join sales s on s.route_id = r.id
  where r.date between p_from and p_to
    and (is_staff() or r.courier_id = auth.uid())
  group by r.courier_id
  order by r.courier_id;
$$;

revoke all on function route_range_summary(date, date) from public, anon;
grant execute on function route_range_summary(date, date) to authenticated;

-- quantidade e valor apurado por forma de pagamento, por motoboy, no período
create or replace function route_payment_breakdown(p_from date, p_to date)
returns table (
  courier_id     uuid,
  payment_method text,
  transactions   bigint,
  amount         numeric
)
language sql stable security definer set search_path = public as $$
  select
    r.courier_id,
    s.payment_method,
    count(*),
    coalesce(sum(s.total), 0)
  from sales s
  join routes r on r.id = s.route_id
  where s.status = 'delivered'
    and r.date between p_from and p_to
    and (is_staff() or r.courier_id = auth.uid())
  group by r.courier_id, s.payment_method
  order by r.courier_id, s.payment_method;
$$;

revoke all on function route_payment_breakdown(date, date) from public, anon;
grant execute on function route_payment_breakdown(date, date) to authenticated;
