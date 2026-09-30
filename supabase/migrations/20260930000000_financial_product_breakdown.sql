-- Custo de produto detalhado por item vendido no período, pra tela
-- Financeiro. Diferente de financial_summary (que usa custo de kit pra
-- venda com oferta), aqui é sempre quantidade × custo de catálogo do
-- produto — é o "quanto cada produto específico custou", não o resultado
-- contábil da venda. Pode não bater exato com "Custo dos produtos" lá em
-- cima quando o custo negociado do kit difere da soma dos cost_price.

create or replace function product_cost_breakdown(p_from date, p_to date)
returns table (
  product_id   uuid,
  product_name text,
  quantity     bigint,
  unit_cost    numeric,
  total_cost   numeric,
  revenue      numeric
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.name,
    sum(i.quantity),
    p.cost_price,
    sum(i.quantity) * p.cost_price,
    sum(i.total)
  from sale_items i
  join sales s on s.id = i.sale_id
  join products p on p.id = i.product_id
  where s.status = 'delivered'
    and s.created_at::date between p_from and p_to
  group by p.id, p.name, p.cost_price
  order by sum(i.quantity) * p.cost_price desc;
$$;

revoke all on function product_cost_breakdown(date, date) from public, anon;
grant execute on function product_cost_breakdown(date, date) to authenticated;
