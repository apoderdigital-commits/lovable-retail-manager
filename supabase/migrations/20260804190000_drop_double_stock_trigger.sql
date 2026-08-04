-- Remove a baixa automática de estoque no insert de item.
--
-- O schema original tinha:
--   CREATE TRIGGER sale_items_decrement_stock AFTER INSERT ON sale_items
--   ... UPDATE products SET stock = stock - NEW.quantity
--
-- Isso fazia sentido quando toda venda era de balcão e saía na hora. Com
-- o ciclo de entrega, virou contagem dupla: create_order insere o item
-- (trigger baixa o stock) e ainda soma reserved_stock. Resultado:
--
--   · o disponível cai o dobro do que foi vendido
--   · no último item, reserved_stock <= stock estoura e a venda falha
--   · na entrega, transition_sale desconta uma terceira vez
--
-- A partir daqui o estoque tem um dono só: create_order reserva,
-- transition_sale baixa na entrega ou devolve no cancelamento. Movimento
-- silencioso por trigger é exatamente o que torna saldo não confiável.

drop trigger if exists sale_items_decrement_stock on public.sale_items;

-- a função fica (sem uso) porque a migration de segurança do Lovable
-- referencia ela num REVOKE; removê-la quebraria o replay daquele arquivo
comment on function public.decrement_stock() is
  'Sem uso desde 04/08/2026. O estoque é movimentado por create_order e transition_sale.';

-- corrige o que a contagem dupla já tiver deixado para trás:
-- nenhuma reserva pode ser maior que o saldo físico
update public.products
   set reserved_stock = least(reserved_stock, stock)
 where reserved_stock > stock;
