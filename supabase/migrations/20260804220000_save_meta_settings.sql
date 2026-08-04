-- Gravar credencial por função, não direto na tabela.
--
-- A escrita via RLS dependia da política acertar o papel no momento do
-- insert, e falhava sem dizer por quê. Aqui a checagem é explícita e o
-- erro sai em português. É também o padrão que o resto do sistema já
-- usa: create_order, transition_sale, dispatch_route.
--
-- Com isso a tabela fica totalmente selada: nem leitura, nem escrita
-- direta. Só as funções alcançam.

drop policy if exists integration_write  on integration_settings;
drop policy if exists integration_update on integration_settings;

create or replace function save_meta_settings(
  p_account text,
  p_token   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not current_has_role('admin') then
    raise exception 'Apenas administradores alteram integrações';
  end if;

  if coalesce(trim(p_account), '') = '' then
    raise exception 'Informe o ID da conta de anúncios';
  end if;

  insert into integration_settings (id, ad_account_id, access_token, updated_at, updated_by)
  values ('meta_ads', trim(p_account), nullif(trim(coalesce(p_token, '')), ''), now(), auth.uid())
  on conflict (id) do update set
    -- token em branco mantém o atual: dá pra corrigir só a conta
    ad_account_id = excluded.ad_account_id,
    access_token  = coalesce(excluded.access_token, integration_settings.access_token),
    updated_at    = now(),
    updated_by    = auth.uid();

  return meta_settings_status();
end $$;

revoke all on function save_meta_settings(text, text) from public, anon;
grant execute on function save_meta_settings(text, text) to authenticated;
