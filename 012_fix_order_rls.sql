-- ============================================
-- FIX: Restrict RLS on orders, order_items, cart_sessions
--
-- These tables were created via Supabase dashboard with
-- overly permissive policies (WITH CHECK (true)).
-- This migration enforces proper row-level isolation:
--   - Users can only access their own data
--   - Admins have full access
--
-- Uses (select auth.uid()) pattern per ADR convention.
-- ============================================

-- =====================
-- ORDERS
-- =====================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE tablename = 'orders' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON orders', pol.policyname);
  END LOOP;
END $$;

-- Users can read their own orders
CREATE POLICY "orders_select_own" ON orders
  FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
    )
  );

-- Users can insert orders only for themselves
CREATE POLICY "orders_insert_own" ON orders
  FOR INSERT
  WITH CHECK (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
    )
  );

-- Only admins can update orders (change status, etc.)
-- Users cannot modify their own orders after creation
CREATE POLICY "orders_admin" ON orders
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- =====================
-- ORDER_ITEMS
-- =====================
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE tablename = 'order_items' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON order_items', pol.policyname);
  END LOOP;
END $$;

-- Users can read items from their own orders
CREATE POLICY "order_items_select_own" ON order_items
  FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
      )
    )
  );

-- Users can insert items only for their own orders
CREATE POLICY "order_items_insert_own" ON order_items
  FOR INSERT
  WITH CHECK (
    order_id IN (
      SELECT id FROM orders WHERE customer_id IN (
        SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
      )
    )
  );

-- Admins have full access
CREATE POLICY "order_items_admin" ON order_items
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- =====================
-- CART_SESSIONS
-- =====================
ALTER TABLE cart_sessions ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE tablename = 'cart_sessions' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON cart_sessions', pol.policyname);
  END LOOP;
END $$;

-- Users can only access their own cart sessions
CREATE POLICY "cart_sessions_own" ON cart_sessions
  FOR ALL
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
    )
  );

-- Admins have full access
CREATE POLICY "cart_sessions_admin" ON cart_sessions
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
