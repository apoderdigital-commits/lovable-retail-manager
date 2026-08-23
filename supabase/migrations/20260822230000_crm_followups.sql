-- CRM de recompra: dias de recompra por oferta, credenciais da Evolution
-- API (guardadas, ainda nao usadas pra enviar) e o log de follow-ups. Por
-- enquanto "enviar follow up" so registra que foi enviado -- o disparo de
-- verdade pela Evolution API fica pra uma proxima etapa.

-- 1. Dias pra recompra, por oferta
alter table offers add column if not exists repurchase_days integer;

-- 2. Credenciais da Evolution API -- mesmo padrao do integration_settings:
-- sem politica de SELECT, so sai (redigido) pela funcao de status abaixo.
create table if not exists crm_settings (
  id                  text primary key,
  evolution_api_url   text,
  evolution_instance  text,
  evolution_api_key   text,
  followup_message    text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id)
);
alter table crm_settings enable row level security;

drop policy if exists crm_settings_write  on crm_settings;
drop policy if exists crm_settings_update on crm_settings;
create policy crm_settings_write on crm_settings for insert
  with check (current_has_role('admin'));
create policy crm_settings_update on crm_settings for update
  using (current_has_role('admin')) with check (current_has_role('admin'));

create or replace function save_crm_settings(
  p_evolution_api_url  text default null,
  p_evolution_instance text default null,
  p_evolution_api_key  text default null,
  p_followup_message   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not current_has_role('admin') then
    raise exception 'Apenas administradores alteram integracoes';
  end if;

  insert into crm_settings (
    id, evolution_api_url, evolution_instance, evolution_api_key, followup_message, updated_at, updated_by
  )
  values (
    'evolution',
    nullif(trim(coalesce(p_evolution_api_url, '')), ''),
    nullif(trim(coalesce(p_evolution_instance, '')), ''),
    nullif(trim(coalesce(p_evolution_api_key, '')), ''),
    nullif(p_followup_message, ''),
    now(),
    auth.uid()
  )
  on conflict (id) do update set
    evolution_api_url  = coalesce(excluded.evolution_api_url, crm_settings.evolution_api_url),
    evolution_instance = coalesce(excluded.evolution_instance, crm_settings.evolution_instance),
    evolution_api_key  = coalesce(excluded.evolution_api_key, crm_settings.evolution_api_key),
    followup_message   = coalesce(excluded.followup_message, crm_settings.followup_message),
    updated_at         = now(),
    updated_by         = auth.uid();

  return crm_settings_status();
end $$;

revoke all on function save_crm_settings(text, text, text, text) from public, anon;
grant execute on function save_crm_settings(text, text, text, text) to authenticated;

-- a tela precisa saber se esta configurado, ver a instancia/mensagem (nao
-- sao segredo) e os 4 ultimos digitos da key -- nunca a key inteira
create or replace function crm_settings_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when not current_has_role('admin') then jsonb_build_object('configured', false)
    else coalesce(
      (select jsonb_build_object(
         'configured',         coalesce(length(evolution_api_key), 0) > 0,
         'evolution_api_url',  evolution_api_url,
         'evolution_instance', evolution_instance,
         'followup_message',   followup_message,
         'key_tail',           right(coalesce(evolution_api_key, ''), 4),
         'updated_at',         updated_at)
         from crm_settings where id = 'evolution'),
      jsonb_build_object('configured', false))
  end
$$;

revoke all on function crm_settings_status() from public, anon;
grant execute on function crm_settings_status() to authenticated;

-- crm_settings_status() e so pra Configuracoes (admin). O quadro do CRM e
-- usado pela equipe toda pra mandar follow-up, entao precisa de um jeito de
-- ler so a mensagem (nao e segredo) sem expor URL/instancia/chave.
create or replace function crm_followup_message()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_message text;
begin
  if not is_staff() then
    return null;
  end if;
  select followup_message into v_message from crm_settings where id = 'evolution';
  return v_message;
end $$;

revoke all on function crm_followup_message() from public, anon;
grant execute on function crm_followup_message() to authenticated;

-- 3. Log de follow-ups. Nao e dado sensivel (e so "avisei o cliente em tal
-- dia"), entao segue o padrao normal de staff, sem funcao.
create table if not exists crm_followups (
  id          bigint generated always as identity primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  sale_id     uuid references sales(id) on delete set null,
  offer_id    uuid references offers(id) on delete set null,
  message     text,
  sent_by     uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists crm_followups_customer_idx on crm_followups (customer_id, created_at);

alter table crm_followups enable row level security;

drop policy if exists crm_followups_select_staff on crm_followups;
drop policy if exists crm_followups_insert_staff on crm_followups;
create policy crm_followups_select_staff on crm_followups for select using (is_staff());
create policy crm_followups_insert_staff on crm_followups for insert with check (is_staff());
