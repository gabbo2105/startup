-- ============================================
-- SERVER-SIDE ORDER CREATION with price validation
--
-- Replaces client-side direct inserts to orders/order_items.
-- Prices are looked up from the products table, not trusted
-- from the client. This prevents price manipulation attacks.
--
-- Usage from frontend:
--   const { data, error } = await supabase.rpc('create_order', {
--     p_items: [
--       { product_id: 'uuid-here', qty: 2 },
--       { product_id: 'uuid-here', qty: 1 }
--     ]
--   });
--
-- Returns: { order_id, order_number, total }
-- ============================================

CREATE OR REPLACE FUNCTION create_order(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_customer    RECORD;
  v_order_id    uuid;
  v_order_num   text;
  v_total       numeric(10,2) := 0;
  v_item        jsonb;
  v_product     RECORD;
  v_qty         integer;
BEGIN
  -- 1. Get customer from authenticated user
  SELECT id, hotel_name, hotel_address, company_name, vat_number,
         contact_person, phone
  INTO v_customer
  FROM customers
  WHERE auth_user_id = auth.uid();

  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Customer not found for authenticated user';
  END IF;

  v_customer_id := v_customer.id;

  -- 2. Validate input
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Order cannot exceed 100 items';
  END IF;

  -- 3. Calculate total from server-side prices
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item ->> 'qty')::integer;

    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Invalid quantity for product %', v_item ->> 'product_id';
    END IF;

    SELECT id, description, supplier_code, price, selling_uom, supplier_id
    INTO v_product
    FROM products
    WHERE id = (v_item ->> 'product_id')::uuid;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item ->> 'product_id';
    END IF;

    IF v_product.price IS NULL THEN
      RAISE EXCEPTION 'Product has no price: %', v_product.description;
    END IF;

    v_total := v_total + (v_product.price * v_qty);
  END LOOP;

  -- 4. Create order
  INSERT INTO orders (
    customer_id, total, delivery_hotel, delivery_address,
    billing_company, billing_vat, contact_person, contact_phone, status
  ) VALUES (
    v_customer_id,
    v_total,
    COALESCE(v_customer.hotel_name, ''),
    COALESCE(v_customer.hotel_address, ''),
    COALESCE(v_customer.company_name, ''),
    COALESCE(v_customer.vat_number, ''),
    COALESCE(v_customer.contact_person, ''),
    COALESCE(v_customer.phone, ''),
    'pending'
  )
  RETURNING id, order_number INTO v_order_id, v_order_num;

  -- 5. Create order items with server-validated prices
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item ->> 'qty')::integer;

    SELECT p.id, p.description, p.supplier_code, p.price, p.selling_uom, s.name AS supplier_name
    INTO v_product
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = (v_item ->> 'product_id')::uuid;

    INSERT INTO order_items (
      order_id, product_id, supplier_code, description,
      supplier_name, selling_uom, unit_price, qty
    ) VALUES (
      v_order_id,
      v_product.id,
      v_product.supplier_code,
      v_product.description,
      v_product.supplier_name,
      v_product.selling_uom,
      v_product.price,
      v_qty
    );
  END LOOP;

  -- 6. Return result
  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_num,
    'total', v_total
  );
END;
$$;
