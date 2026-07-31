-- ═══════════════════════════════════════════════════════════════════════
-- Fecha as permissões.
--
-- As políticas originais diziam "using (true)" para qualquer usuário
-- autenticado: a base inteira de clientes (com CPF) ficava legível, o
-- custo de cada produto exposto, e preço e estoque alteráveis por
-- qualquer um. Um entregador logado teria tudo isso.
--
-- Depois desta migration:
--   · staff (admin/vendedor/attendant/stockist) opera o back-office
--   · entregador vê SÓ os pedidos da rota dele, e só enquanto on_route
--   · preço e estoque só mudam por estoquista ou admin
--   · custo do produto deixa de ser visível pra quem não é staff
--
-- Idempotente: pode rodar de novo sem quebrar.
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 0. Trava de segurança ─────────────────────────────────────────────
-- Sem nenhum admin em user_roles estas políticas trancariam todo mundo
-- pra fora. Nesse caso a migration aborta e nada é aplicado.

do $$ begin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    raise exception
      'Nenhum admin em user_roles. Atribua o papel antes de aplicar esta migration.';
  end if;
end $$;


-- ─── 1. customers ──────────────────────────────────────────────────────

drop policy if exists customers_select          on customers;
drop policy if exists customers_update          on customers;
drop policy if exists customers_insert          on customers;
drop policy if exists customers_select_staff    on customers;
drop policy if exists customers_select_courier  on customers;
drop policy if exists customers_insert_staff    on customers;
drop policy if exists customers_update_staff    on customers;

create policy customers_select_staff on customers for select using (is_staff());

-- o entregador só vê o cliente que está na mão dele agora
create policy customers_select_courier on customers for select
  using (exists (
    select 1 from sales s
     where s.customer_id = customers.id
       and s.courier_id  = auth.uid()
       and s.status      = 'on_route'
  ));

create policy customers_insert_staff on customers for insert with check (is_staff());
create policy customers_update_staff on customers for update
  using (is_staff()) with check (is_staff());


-- ─── 2. products ───────────────────────────────────────────────────────
-- entregador não precisa da tabela: o nome do item já vem congelado
-- em sale_items.product_name.

drop policy if exists products_select        on products;
drop policy if exists products_update        on products;
drop policy if exists products_insert        on products;
drop policy if exists products_select_staff  on products;
drop policy if exists products_insert_stock  on products;
drop policy if exists products_update_stock  on products;

create policy products_select_staff on products for select using (is_staff());

create policy products_insert_stock on products for insert
  with check (current_has_role('admin') or current_has_role('stockist'));

create policy products_update_stock on products for update
  using (current_has_role('admin') or current_has_role('stockist'))
  with check (current_has_role('admin') or current_has_role('stockist'));


-- ─── 3. sales ──────────────────────────────────────────────────────────
-- não havia política de UPDATE, por isso o status já só mudava via
-- transition_sale(). A de staff abaixo libera editar endereço e desconto;
-- o trigger continua bloqueando mudança de status.

drop policy if exists sales_select         on sales;
drop policy if exists sales_insert         on sales;
drop policy if exists sales_select_staff   on sales;
drop policy if exists sales_select_courier on sales;
drop policy if exists sales_insert_staff   on sales;
drop policy if exists sales_update_staff   on sales;

create policy sales_select_staff   on sales for select using (is_staff());
create policy sales_select_courier on sales for select
  using (courier_id = auth.uid() and status = 'on_route');
create policy sales_insert_staff   on sales for insert with check (is_staff());
create policy sales_update_staff   on sales for update
  using (is_staff()) with check (is_staff());


-- ─── 4. sale_items ─────────────────────────────────────────────────────

drop policy if exists sale_items_select         on sale_items;
drop policy if exists sale_items_insert         on sale_items;
drop policy if exists sale_items_select_staff   on sale_items;
drop policy if exists sale_items_select_courier on sale_items;
drop policy if exists sale_items_insert_staff   on sale_items;

create policy sale_items_select_staff on sale_items for select using (is_staff());

create policy sale_items_select_courier on sale_items for select
  using (exists (
    select 1 from sales s
     where s.id         = sale_items.sale_id
       and s.courier_id = auth.uid()
       and s.status     = 'on_route'
  ));

create policy sale_items_insert_staff on sale_items for insert with check (is_staff());


-- ─── 5. profiles ───────────────────────────────────────────────────────

drop policy if exists profiles_select_authenticated on profiles;
drop policy if exists profiles_select_own           on profiles;
drop policy if exists profiles_select_staff         on profiles;

create policy profiles_select_own   on profiles for select using (id = auth.uid());
create policy profiles_select_staff on profiles for select using (is_staff());


-- ─── 6. user_roles ─────────────────────────────────────────────────────
-- is_staff() e has_role() são security definer, então continuam
-- funcionando com a leitura fechada — sem recursão.

drop policy if exists user_roles_select_authenticated on user_roles;
drop policy if exists user_roles_select_own           on user_roles;
drop policy if exists user_roles_select_staff         on user_roles;

create policy user_roles_select_own   on user_roles for select using (user_id = auth.uid());
create policy user_roles_select_staff on user_roles for select using (is_staff());
