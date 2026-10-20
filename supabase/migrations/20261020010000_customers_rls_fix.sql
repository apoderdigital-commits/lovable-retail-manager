-- Cadastro de cliente voltou a falhar com
-- "new row violates row-level security policy for table customers".
--
-- Nao e campo faltando (o formulario so exige o nome): e a regra de acesso.
-- O banco ao vivo pode ter ganho politicas que nao estao no repositorio
-- (ajustes de seguranca feitos pelo editor do Lovable). Por isso este script
-- apaga TODAS as politicas de customers e recria as do sistema, alem de
-- garantir que is_staff() conhece todos os papeis da equipe.


-- ---- 1. quem e equipe ----

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
     where user_id = auth.uid()
       and role in ('admin','vendedor','attendant','stockist')
  )
$$;

revoke all on function is_staff() from public, anon;
grant execute on function is_staff() to authenticated;


-- ---- 2. politicas de customers, do zero ----

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'customers' loop
    execute format('drop policy %I on public.customers', p.policyname);
  end loop;
end $$;

alter table customers enable row level security;

create policy customers_select_staff on customers for select using (is_staff());

-- o entregador so ve o cliente que esta na mao dele agora
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
create policy customers_delete_admin on customers for delete
  using (current_has_role('admin'));

grant select, insert, update, delete on customers to authenticated;
