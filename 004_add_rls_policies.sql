-- ============================================
-- ROW LEVEL SECURITY
-- Read-only per utenti anonimi (agente AI)
-- Full access per utenti autenticati (admin)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- PRICE_LISTS: everyone can read
CREATE POLICY "price_lists_read" ON price_lists
  FOR SELECT USING (true);

CREATE POLICY "price_lists_admin" ON price_lists
  FOR ALL USING (auth.role() = 'authenticated');

-- SUPPLIERS: everyone can read
CREATE POLICY "suppliers_read" ON suppliers
  FOR SELECT USING (true);

CREATE POLICY "suppliers_admin" ON suppliers
  FOR ALL USING (auth.role() = 'authenticated');

-- PRODUCTS: everyone can read
CREATE POLICY "products_read" ON products
  FOR SELECT USING (true);

CREATE POLICY "products_admin" ON products
  FOR ALL USING (auth.role() = 'authenticated');
