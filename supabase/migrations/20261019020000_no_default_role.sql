-- Conta nova deixa de ganhar o papel 'vendedor' automaticamente.
--
-- O gatilho dava 'vendedor' a toda conta criada. A tela Usuarios (funcao
-- admin-create-user) grava o papel escolhido logo depois, e ao escolher
-- Vendedor o insert duplicava: user_roles_user_id_role_key. Alem disso,
-- qualquer pessoa que se cadastrasse sozinha na tela de login virava
-- vendedora e passava a enxergar o sistema.
--
-- Agora o papel vem so de quem cria o acesso. A unica excecao continua
-- sendo a primeira conta do sistema, que vira admin.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.email)
  on conflict (id) do nothing;

  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
    on conflict do nothing;
  end if;

  return new;
end $$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
