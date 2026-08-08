-- Data de aniversário do cliente, para ações comerciais na data.

alter table customers
  add column if not exists birth_date date;

comment on column customers.birth_date is
  'Data de nascimento do cliente. Opcional — usado para ações de aniversário.';
