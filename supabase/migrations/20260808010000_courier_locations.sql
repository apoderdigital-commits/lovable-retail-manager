-- Última posição de cada entregador, pro rastreio ao vivo em /rastreio.
--
-- Guarda só a posição atual (uma linha por entregador, upsert), não
-- histórico — não é replay de rota, é "onde ele está agora". A tela mede
-- "sem sinal há Xmin" pela diferença entre agora e updated_at, não por
-- nenhum sinal explícito de desconexão (o navegador não avisa quando a
-- aba fecha).

create table if not exists courier_locations (
  courier_id uuid primary key references auth.users(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  accuracy   double precision,
  updated_at timestamptz not null default now()
);

alter table courier_locations enable row level security;

drop policy if exists courier_locations_select on courier_locations;
drop policy if exists courier_locations_insert on courier_locations;
drop policy if exists courier_locations_update on courier_locations;

-- staff acompanha todo mundo; o próprio entregador só enxerga (e escreve) a dele
create policy courier_locations_select on courier_locations
  for select using (is_staff() or courier_id = auth.uid());

create policy courier_locations_insert on courier_locations
  for insert with check (courier_id = auth.uid());

create policy courier_locations_update on courier_locations
  for update using (courier_id = auth.uid()) with check (courier_id = auth.uid());
