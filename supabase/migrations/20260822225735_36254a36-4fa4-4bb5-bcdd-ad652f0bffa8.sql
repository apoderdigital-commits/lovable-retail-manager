
create or replace function public.guard_product_stock_writes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_direct boolean;
begin
  -- Chamadas diretas do app rodam como 'authenticated'/'anon'.
  -- As funções controladas (create_order, transition_sale, decrement_stock)
  -- são SECURITY DEFINER, então rodam como o dono do banco.
  v_direct := current_user in ('authenticated', 'anon');

  if v_direct then
    if new.reserved_stock is distinct from old.reserved_stock then
      raise exception 'reserved_stock só pode mudar pelo fluxo de pedidos';
    end if;

    if new.stock is distinct from old.stock then
      if not (current_has_role('admin') or current_has_role('stockist')) then
        raise exception 'Sem permissão para ajustar estoque';
      end if;
      insert into stock_movements (product_id, kind, quantity, user_id, note)
      values (new.id, 'adjustment', new.stock - old.stock, auth.uid(),
              'Ajuste manual de estoque');
    end if;
  end if;

  return new;
end $$;

drop trigger if exists products_stock_guard on public.products;
create trigger products_stock_guard
  before update on public.products
  for each row execute function public.guard_product_stock_writes();

revoke execute on function public.guard_product_stock_writes() from public, anon, authenticated;
