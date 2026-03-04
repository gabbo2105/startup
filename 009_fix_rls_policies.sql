-- ============================================
-- FIX: Restrict write access to admin users only
-- Previous policies granted ALL authenticated users
-- full INSERT/UPDATE/DELETE — any registered buyer
-- could delete the entire catalog.
--
-- New policies require app_metadata.role = 'admin'
-- for write operations. Read access is unchanged.
--
-- To grant admin access to a user, set their
-- app_metadata via Supabase Dashboard or:
--   UPDATE auth.users
--   SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
--   WHERE id = '<user-uuid>';
-- ============================================

-- =====================
-- PRICE_LISTS
-- =====================
DROP POLICY IF EXISTS "price_lists_admin" ON price_lists;

CREATE POLICY "price_lists_admin_write" ON price_lists
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- =====================
-- SUPPLIERS
-- =====================
DROP POLICY IF EXISTS "suppliers_admin" ON suppliers;

CREATE POLICY "suppliers_admin_write" ON suppliers
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- =====================
-- PRODUCTS
-- =====================
DROP POLICY IF EXISTS "products_admin" ON products;

CREATE POLICY "products_admin_write" ON products
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- =====================
-- CUSTOMERS
-- Enable RLS and add row-level isolation.
-- Users can only read/modify their own record.
-- Admins can access all records.
-- =====================
DO $$
BEGIN
  -- Only enable RLS if the table exists (it may have been created via dashboard)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    EXECUTE 'ALTER TABLE customers ENABLE ROW LEVEL SECURITY';

    -- Drop existing policies if any
    DROP POLICY IF EXISTS "customers_select_own" ON customers;
    DROP POLICY IF EXISTS "customers_insert_own" ON customers;
    DROP POLICY IF EXISTS "customers_update_own" ON customers;
    DROP POLICY IF EXISTS "customers_admin" ON customers;

    -- Users can read their own record
    CREATE POLICY "customers_select_own" ON customers
      FOR SELECT
      USING (auth.uid() = auth_user_id);

    -- Users can insert their own record (on signup)
    CREATE POLICY "customers_insert_own" ON customers
      FOR INSERT
      WITH CHECK (auth.uid() = auth_user_id);

    -- Users can update their own record
    CREATE POLICY "customers_update_own" ON customers
      FOR UPDATE
      USING (auth.uid() = auth_user_id)
      WITH CHECK (auth.uid() = auth_user_id);

    -- Admins can access all customer records
    CREATE POLICY "customers_admin" ON customers
      FOR ALL
      USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
      WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
  END IF;
END $$;
