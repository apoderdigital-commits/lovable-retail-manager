-- Produtos so apareciam para admin.
--
-- No repositorio a leitura de products sempre foi da equipe toda
-- (is_staff), mas o banco ao vivo ganhou regra diferente fora do
-- repositorio — o mesmo que aconteceu com customers. Este script apaga
-- TODAS as politicas de products e recria as do sistema:
--   . ler: equipe toda (admin, vendedor, atendente, estoque)
--   . cadastrar e editar: admin e estoque
--   . excluir: so admin

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'products' loop
    execute format('drop policy %I on public.products', p.policyname);
  end loop;
end $$;

alter table products enable row level security;

create policy products_select_staff on products for select using (is_staff());

create policy products_insert_stock on products for insert
  with check (current_has_role('admin') or current_has_role('stockist'));

create policy products_update_stock on products for update
  using (current_has_role('admin') or current_has_role('stockist'))
  with check (current_has_role('admin') or current_has_role('stockist'));

create policy products_delete_admin on products for delete
  using (current_has_role('admin'));

grant select, insert, update, delete on products to authenticated;
