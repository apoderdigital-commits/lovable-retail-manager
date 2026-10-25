-- "4 por R$ 100" so vale para a categoria a base de oleo.
--
-- Sem categoria configurada, a oferta pegava qualquer 4 unidades do mesmo
-- preco: 4 perfumes de R$ 150 viravam R$ 100. Agora a oferta fica presa a
-- categoria cujo nome tem "oleo" (com ou sem acento).
--
-- Depende da 20261021010000_partial_offers (coluna offers.category_ids).
-- A categoria e procurada pelo nome por regex: ó = o com acento agudo,
-- escrito assim pra manter o arquivo so em ASCII.

do $$
declare
  v_cats uuid[];
begin
  select array_agg(id) into v_cats
    from product_categories
   where name ~* '[oó]leo';

  if v_cats is null then
    raise exception 'Nenhuma categoria com "oleo" no nome. Confira em Produtos > Categorias.';
  end if;

  update offers
     set category_ids = v_cats
   where item_count = 4 and price = 100;

  if not found then
    raise exception 'Oferta "4 por R$ 100" nao encontrada (item_count = 4, price = 100).';
  end if;
end $$;
