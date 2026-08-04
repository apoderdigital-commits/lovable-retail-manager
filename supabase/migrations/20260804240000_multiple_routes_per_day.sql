-- Várias rotas por entregador no mesmo dia.
--
-- O modelo original tinha unique (courier_id, date): uma rota por
-- entregador por dia. Na prática o motoboy faz duas ou três saídas, e
-- encerrar a rota da manhã travava a da tarde - pedido novo não tinha
-- onde entrar.
--
-- A regra que fica no lugar: no máximo uma rota EM MONTAGEM por
-- entregador. Rota já despachada não impede montar a próxima, o que é
-- justamente o caso de pedido novo chegando com o motoboy na rua.

alter table routes drop constraint if exists routes_courier_id_date_key;

create unique index if not exists routes_one_open_per_courier
  on routes (courier_id) where dispatched_at is null;

-- devolve a rota em montagem do entregador, criando se não houver.
-- fica no banco em vez do front para não haver corrida entre dois
-- atendentes atribuindo ao mesmo motoboy ao mesmo tempo.
create or replace function open_route_for(p_courier uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_staff() then raise exception 'Sem permissão para montar rota'; end if;

  select id into v_id
    from routes
   where courier_id = p_courier and dispatched_at is null
   order by created_at
   limit 1;

  if v_id is null then
    insert into routes (courier_id, date) values (p_courier, current_date)
    returning id into v_id;
  end if;

  return v_id;
end $$;

revoke all on function open_route_for(uuid) from public, anon;
grant execute on function open_route_for(uuid) to authenticated;
