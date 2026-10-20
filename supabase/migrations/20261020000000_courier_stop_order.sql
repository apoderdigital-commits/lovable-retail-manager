-- O entregador reordena as proprias paradas no celular.
--
-- stop_order e a posicao escolhida por ele; pedido sem posicao fica no fim,
-- pela hora de criacao. A escrita vai por funcao: o entregador nao tem
-- UPDATE em sales, e a funcao so mexe em pedido em rota dele mesmo.

alter table sales add column if not exists stop_order integer;

create or replace function reorder_my_stops(p_sales uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  i     integer;
begin
  if not (is_courier() or current_has_role('admin')) then
    raise exception 'Sem permissão para reordenar a rota';
  end if;

  if exists (
    select 1 from sales
     where id = any(p_sales)
       and (status <> 'on_route'
            or (courier_id is distinct from v_uid and not current_has_role('admin')))
  ) then
    raise exception 'Só dá para reordenar pedidos em rota que são seus';
  end if;

  for i in 1 .. coalesce(array_length(p_sales, 1), 0) loop
    update sales set stop_order = i where id = p_sales[i];
  end loop;
end $$;

revoke all on function reorder_my_stops(uuid[]) from public, anon;
grant execute on function reorder_my_stops(uuid[]) to authenticated;
