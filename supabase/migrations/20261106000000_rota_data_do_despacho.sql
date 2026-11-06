-- Rota ganha a data do dia em que saiu, nao a do dia em que foi aberta.
--
-- open_route_for reaproveita a rota do motoboy que ainda nao saiu, mesmo que
-- ela tenha sido aberta dias antes. Em 06/11 a rota do Wallace era de 31/10:
-- as 7 entregas do dia sairam do Dashboard de entregas, que filtra por
-- routes.date. Agora o despacho grava a data de hoje na rota, e as rotas ja
-- despachadas sao corrigidas para o dia em que sairam.

create or replace function dispatch_route(p_route uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_route routes;
  v_id    uuid;
  v_n     integer := 0;
begin
  if not is_staff() then raise exception 'Sem permissão para despachar rota'; end if;

  select * into v_route from routes where id = p_route for update;
  if not found then raise exception 'Rota não encontrada'; end if;
  if v_route.dispatched_at is not null then raise exception 'Rota já despachada'; end if;

  for v_id in select id from sales where route_id = p_route and status = 'picked' loop
    update sales set
      courier_id   = v_route.courier_id,
      delivery_fee = case
                       when delivery_fee > 0 then delivery_fee
                       else coalesce((select amount from delivery_fees f
                                       where f.neighborhood = sales.neighborhood), 0)
                     end
     where id = v_id;
    perform transition_sale(v_id, 'on_route');
    v_n := v_n + 1;
  end loop;

  update routes
     set dispatched_at = now(),
         date = (now() at time zone 'America/Recife')::date
   where id = p_route;
  return v_n;
end $$;

-- Rotas que ja sairam: a data passa a ser o dia do despacho.
update routes
   set date = (dispatched_at at time zone 'America/Recife')::date
 where dispatched_at is not null
   and date <> (dispatched_at at time zone 'America/Recife')::date;
