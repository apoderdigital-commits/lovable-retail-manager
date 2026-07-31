-- Papéis novos para o ciclo de entrega.
-- Fica em migration separada porque o Postgres não deixa criar e usar
-- um valor de enum na mesma transação.
--
-- 'vendedor' já existia (criado pelo Lovable) e continua valendo como staff.

alter type app_role add value if not exists 'attendant';
alter type app_role add value if not exists 'stockist';
alter type app_role add value if not exists 'courier';
