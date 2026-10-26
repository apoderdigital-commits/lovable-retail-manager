-- "4 por R$ 100" e "10 por R$ 200" so valem para a categoria a base de oleo.
--
-- Sem categoria configurada, a oferta pegava quaisquer unidades do mesmo
-- preco: 4 perfumes de R$ 150 viravam R$ 100. Agora as duas ofertas ficam
-- presas a categoria cujo nome tem "oleo" (com ou sem acento).
--
-- Depende da 20261021010000_partial_offers (coluna offers.category_ids).
-- A categoria e procurada pelo nome por regex: ó = o com acento agudo,
-- escrito assim pra manter o arquivo so em ASCII. Pode rodar de novo sem
-- problema.

do $$
declare
  v_cats uuid[];
  v_n    integer;
begin
  select array_agg(id) into v_cats
    from product_categories
   where name ~* '[oó]leo';

  if v_cats is null then
    raise exception 'Nenhuma categoria com "oleo" no nome. Confira em Produtos > Categorias.';
  end if;

  update offers
     set category_ids = v_cats
   where (item_count, price) in ((4, 100), (10, 200));
  get diagnostics v_n = row_count;

  if v_n < 2 then
    raise exception 'Esperava as ofertas "4 por R$ 100" e "10 por R$ 200", achei %.', v_n;
  end if;
end $$;
