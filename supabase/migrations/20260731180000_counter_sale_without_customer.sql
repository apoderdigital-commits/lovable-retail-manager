-- Venda de balcão pode não ter cliente cadastrado.
--
-- Quem compra um frasco no balcão e paga na hora não precisa entrar na
-- base. Já um pedido para entrega precisa de cliente: é dele que sai o
-- endereço e o telefone.
--
-- Sem cliente, o preço aplicado é o de varejo.

create or replace function create_order(
  p_customer       uuid,
  p_payment_method text,
  p_items          jsonb,
  p_address        text    default null,
  p_neighborhood   text    default null,
  p_discount       numeric(12,2) default 0,
  p_counter_sale   boolean default false
) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_sale     sales;
  v_type     customer_type;
  v_item     jsonb;
  v_product  products;
  v_qty      integer;
  v_price    numeric(12,2);
  v_subtotal numeric(12,2) := 0;
begin
  if not is_staff() then raise exception 'Sem permissão para criar venda'; end if;

  if p_customer is null then
    if not p_counter_sale then
      raise exception 'Pedido para entrega precisa de um cliente cadastrado';
    end if;
    v_type := 'retail';
  else
    select customer_type into v_type from customers where id = p_customer;
    if not found then raise exception 'Cliente não encontrado'; end if;
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Adicione ao menos um produto';
  end if;

  insert into sales (customer_id, seller_id, payment_method,
                     delivery_address, neighborhood, subtotal, discount, total)
  values (p_customer, auth.uid(), p_payment_method,
          p_address, p_neighborhood, 0, coalesce(p_discount, 0), 0)
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantidade inválida'; end if;

    -- FOR UPDATE trava a linha: o segundo atendente espera e vê o saldo real
    select * into v_product from products
     where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'Produto não encontrado'; end if;

    if v_product.available_stock < v_qty then
      raise exception 'Estoque insuficiente de %: disponível %, pedido %',
        v_product.name, v_product.available_stock, v_qty;
    end if;

    v_price := case v_type when 'wholesale' then v_product.wholesale_price
                           else v_product.price end;

    insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, total)
    values (v_sale.id, v_product.id, v_product.name, v_qty, v_price, v_qty * v_price);

    update products set reserved_stock = reserved_stock + v_qty where id = v_product.id;

    insert into stock_movements (product_id, kind, quantity, sale_id, user_id)
    values (v_product.id, 'reserve', v_qty, v_sale.id, auth.uid());

    v_subtotal := v_subtotal + (v_qty * v_price);
  end loop;

  update sales
     set subtotal   = v_subtotal,
         total      = greatest(v_subtotal - coalesce(p_discount, 0), 0),
         updated_at = now()
   where id = v_sale.id
  returning * into v_sale;

  insert into sale_status_history (sale_id, from_status, to_status, user_id)
  values (v_sale.id, null, 'new', auth.uid());

  -- balcão: o cliente leva na hora, então já baixa o estoque
  if p_counter_sale then
    v_sale := transition_sale(v_sale.id, 'delivered');
  end if;

  return v_sale;
end $$;
