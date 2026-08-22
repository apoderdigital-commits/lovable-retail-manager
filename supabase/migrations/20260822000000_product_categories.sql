-- Categorias de produto viram uma lista gerenciável em vez de texto livre.
-- Mesmo padrão de offers: leitura pra qualquer staff, escrita só admin.

create table if not exists product_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table product_categories enable row level security;

drop policy if exists product_categories_read  on product_categories;
drop policy if exists product_categories_admin on product_categories;
create policy product_categories_read  on product_categories for select using (auth.uid() is not null);
create policy product_categories_admin on product_categories for all
  using (current_has_role('admin')) with check (current_has_role('admin'));

alter table products add column if not exists category_id uuid references product_categories(id) on delete set null;

-- backfill: cada valor distinto hoje em products.category vira uma
-- categoria, e os produtos são religados por category_id
insert into product_categories (name)
select distinct trim(category) from products
where category is not null and trim(category) <> ''
on conflict (name) do nothing;

update products p set category_id = c.id
from product_categories c
where trim(p.category) = c.name and p.category_id is null;

alter table products drop column if exists category;
