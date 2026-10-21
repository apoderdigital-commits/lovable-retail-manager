-- Fuso do banco em Recife.
--
-- O Supabase roda em UTC: "created_at::date", "current_date" e o dia das
-- rotas viravam meia-noite UTC = 21h em Recife. Venda das 21h17 caia no dia
-- seguinte nos relatorios, no Marketing, no Financeiro e no resumo das
-- rotas. Com o fuso do banco em America/Recife essas contas passam a usar o
-- dia da loja. Os instantes gravados (timestamptz) nao mudam.

alter database postgres set timezone to 'America/Recife';
alter role authenticated set timezone to 'America/Recife';
alter role anon set timezone to 'America/Recife';
alter role service_role set timezone to 'America/Recife';
