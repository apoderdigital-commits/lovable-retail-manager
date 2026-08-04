-- Endereço completo do cliente e histórico de compras.
--
-- Numa loja com entrega própria o cadastro do cliente é operacional, não
-- burocrático: cada campo que falta vira ligação do motoboy na rua.

alter table customers
  add column if not exists zip_code        text,
  add column if not exists city            text,
  add column if not exists reference_point text;

comment on column customers.reference_point is
  'Ponto de referência: "portão azul", "ao lado da padaria". É o que resolve endereço que o mapa não acha.';

-- quantas compras o cliente já concluiu. usado no PDV para o atendente
-- saber na hora se está atendendo alguém novo ou um cliente fiel.
create or replace function customer_stats(p_customer uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders',        count(*),
    'total_spent',   coalesce(sum(total), 0),
    'last_order_at', max(created_at)
  )
  from sales
  where customer_id = p_customer
    and status = 'delivered';
$$;

revoke all on function customer_stats(uuid) from public, anon;
grant execute on function customer_stats(uuid) to authenticated;
