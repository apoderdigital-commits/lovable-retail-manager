-- Venda orgânica que bate em quantidade de itens e valor com uma oferta
-- ativa (ex.: 4 itens por R$100) — mesma regra usada no PDV pra sugerir a
-- oferta. Serve pra Marketing mostrar "4 por R$100 orgânico" ao lado de
-- "4 por R$100 tráfego", já que o cliente pode ter comprado o mesmo kit
-- sem vir de anúncio.

create or replace function organic_offer_match(p_from date, p_to date)
returns table (
  offer_id    uuid,
  offer_name  text,
  sales_count bigint,
  revenue     numeric,
  customers   bigint
)
language sql stable security definer set search_path = public as $$
  with organic as (
    select s.id, s.customer_id, s.subtotal, s.total
      from sales s
     where s.offer_id is null
       and s.status = 'delivered'
       and s.created_at::date between p_from and p_to
  ),
  units as (
    select sale_id, sum(quantity) as units
      from sale_items
     where sale_id in (select id from organic)
     group by sale_id
  )
  select
    o.id,
    o.name,
    count(*)::bigint,
    coalesce(sum(organic.total), 0),
    count(distinct organic.customer_id)
  from organic
  join units u on u.sale_id = organic.id
  join offers o on o.active
                and o.item_count = u.units
                and abs(o.price - organic.subtotal) < 0.01
  group by o.id, o.name;
$$;

revoke all on function organic_offer_match(date, date) from public, anon;
grant execute on function organic_offer_match(date, date) to authenticated;
