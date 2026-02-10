-- ============================================
-- FULL-TEXT SEARCH con configurazione ITALIANA
-- ============================================

-- Add tsvector column for Italian full-text search
ALTER TABLE products ADD COLUMN fts_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('italian', coalesce(description, ''))
  ) STORED;

-- GIN index for fast full-text search
CREATE INDEX idx_products_fts ON products USING gin(fts_vector);

-- Helper function: search products with Italian full-text
CREATE OR REPLACE FUNCTION search_products_fts(
  search_query text,
  supplier_filter uuid DEFAULT NULL,
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  result_limit int DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  supplier_name text,
  supplier_code text,
  description text,
  selling_uom text,
  pricing_uom text,
  price numeric,
  rank real
) 
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT 
    p.id,
    s.name AS supplier_name,
    p.supplier_code,
    p.description,
    p.selling_uom,
    p.pricing_uom,
    p.price,
    ts_rank(p.fts_vector, websearch_to_tsquery('italian', search_query)) AS rank
  FROM products p
  JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.fts_vector @@ websearch_to_tsquery('italian', search_query)
    AND (supplier_filter IS NULL OR p.supplier_id = supplier_filter)
    AND (price_min IS NULL OR p.price >= price_min)
    AND (price_max IS NULL OR p.price <= price_max)
  ORDER BY rank DESC
  LIMIT result_limit;
$$;

-- Helper function: fuzzy search with trigrams (for typos)
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_query text,
  similarity_threshold real DEFAULT 0.2,
  result_limit int DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  supplier_name text,
  supplier_code text,
  description text,
  selling_uom text,
  pricing_uom text,
  price numeric,
  similarity real
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT 
    p.id,
    s.name AS supplier_name,
    p.supplier_code,
    p.description,
    p.selling_uom,
    p.pricing_uom,
    p.price,
    similarity(p.description, search_query) AS similarity
  FROM products p
  JOIN suppliers s ON s.id = p.supplier_id
  WHERE similarity(p.description, search_query) > similarity_threshold
  ORDER BY similarity DESC
  LIMIT result_limit;
$$;
