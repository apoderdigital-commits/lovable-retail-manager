-- Resumo das rotas do dia: corridas e taxa a pagar.
--
-- A tela de Entregas carrega só pedidos em aberto, então o que já foi
-- entregue não está lá para somar. Esta função fecha a conta no banco.
--
-- "Taxa a pagar" conta apenas fee_due, que só vira true na entrega
-- concluída. Parada não entregue aparece na contagem mas não no valor -
-- é a decisão de não pagar taxa por tentativa frustrada, visível.

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
    coalesce(sum(s.total) filter (
      where s.status = 'delivered' and s.payment_method = 'dinheiro'
    ), 0)
  from routes r
  left join sales s on s.route_id = r.id
  where r.date = p_date
    -- entregador enxerga só as próprias rotas
    and (is_staff() or r.courier_id = auth.uid())
  group by r.id, r.courier_id, r.dispatched_at, r.closed_at
  order by r.created_at;
$$;

revoke all on function route_day_summary(date) from public, anon;
grant execute on function route_day_summary(date) to authenticated;
