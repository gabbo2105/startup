-- ============================================
-- CATALOGO FORNITORI - BORGO PALACE HOTEL
-- Schema base: suppliers, products, price_lists
-- ============================================

-- Extensions first
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Price lists (import metadata)
CREATE TABLE price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name text NOT NULL,
  price_valid_date date NOT NULL,
  import_date timestamptz NOT NULL DEFAULT now(),
  source_file text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE price_lists IS 'Metadata per ogni import di listino prezzi';

-- Suppliers
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  account_number text,
  depot text,
  telesales text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE suppliers IS 'Fornitori del Borgo Palace Hotel di Sansepolcro';

-- Products (main table, ~9200 rows)
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_code text NOT NULL,
  description text NOT NULL,
  selling_uom text,
  pricing_uom text,
  price numeric(10,2),
  currency text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(price_list_id, supplier_id, supplier_code)
);

COMMENT ON TABLE products IS 'Prodotti dal catalogo fornitori con prezzi';

-- Indexes
CREATE INDEX idx_products_supplier ON products(supplier_id);
CREATE INDEX idx_products_price_list ON products(price_list_id);
CREATE INDEX idx_products_description_trgm ON products USING gin(description gin_trgm_ops);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_supplier_code ON products(supplier_code);
