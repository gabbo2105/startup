-- ============================================
-- CREATE: customers table + auto-creation trigger
--
-- This table bridges Supabase Auth users to business-level
-- customer profiles. It was previously created via dashboard
-- but never version-controlled, causing schema drift.
--
-- A trigger on auth.users automatically creates a customer
-- record when a new user signs up, using the metadata
-- provided during registration.
-- ============================================

-- Create customers table
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL DEFAULT '',
  vat_number text NOT NULL DEFAULT '',
  hotel_name text NOT NULL DEFAULT '',
  hotel_address text DEFAULT '',
  contact_person text NOT NULL DEFAULT '',
  contact_role text DEFAULT '',
  phone text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast lookup by auth user
CREATE INDEX IF NOT EXISTS idx_customers_auth_user_id ON customers(auth_user_id);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only access their own record, admins can access all
DROP POLICY IF EXISTS "customers_select_own" ON customers;
CREATE POLICY "customers_select_own" ON customers
  FOR SELECT
  USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "customers_insert_own" ON customers;
CREATE POLICY "customers_insert_own" ON customers
  FOR INSERT
  WITH CHECK (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "customers_update_own" ON customers;
CREATE POLICY "customers_update_own" ON customers
  FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "customers_admin" ON customers;
CREATE POLICY "customers_admin" ON customers
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Trigger function: auto-create customer record on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.customers (
    auth_user_id,
    company_name,
    vat_number,
    hotel_name,
    hotel_address,
    contact_person,
    contact_role,
    phone
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'company_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'vat_number', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'hotel_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'hotel_address', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'contact_person', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'contact_role', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'phone', '')
  );
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users (drop first for idempotency)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
