-- ============================================
-- OPTIMIZE: Hybrid search riscritta con UNION
-- La versione precedente con OR nella WHERE
-- causava statement timeout (full table scan)
-- ============================================

CREATE OR REPLACE FUNCTION search_products_hybrid(
  search_text text,
  query_embedding vector(1536) DEFAULT NULL,
  supplier_filter uuid DEFAULT NULL,
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  fts_weight float DEFAULT 0.4,
  semantic_weight float DEFAULT 0.6,
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
  fts_rank real,
  semantic_similarity float,
  combined_score float
)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  WITH fts_hits AS (
    SELECT p.id, 
           ts_rank(p.fts_vector, websearch_to_tsquery('italian', search_text)) AS rank
    FROM products p
    WHERE p.fts_vector @@ websearch_to_tsquery('italian', search_text)
      AND (supplier_filter IS NULL OR p.supplier_id = supplier_filter)
      AND (price_min IS NULL OR p.price >= price_min)
      AND (price_max IS NULL OR p.price <= price_max)
    ORDER BY rank DESC
    LIMIT result_limit
  ),
  semantic_hits AS (
    SELECT p.id,
           (1 - (p.embedding <=> query_embedding))::float AS sim
    FROM products p
    WHERE query_embedding IS NOT NULL
      AND p.embedding IS NOT NULL
      AND (supplier_filter IS NULL OR p.supplier_id = supplier_filter)
      AND (price_min IS NULL OR p.price >= price_min)
      AND (price_max IS NULL OR p.price <= price_max)
    ORDER BY p.embedding <=> query_embedding
    LIMIT result_limit
  ),
  combined AS (
    SELECT 
      COALESCE(f.id, s.id) AS product_id,
      COALESCE(f.rank, 0::real) AS fts_r,
      COALESCE(s.sim, 0::float) AS sem_s
    FROM fts_hits f
    FULL OUTER JOIN semantic_hits s ON f.id = s.id
  )
  SELECT 
    p.id,
    sup.name AS supplier_name,
    p.supplier_code,
    p.description,
    p.selling_uom,
    p.pricing_uom,
    p.price,
    c.fts_r AS fts_rank,
    c.sem_s AS semantic_similarity,
    (c.fts_r * fts_weight + c.sem_s * semantic_weight)::float AS combined_score
  FROM combined c
  JOIN products p ON p.id = c.product_id
  JOIN suppliers sup ON sup.id = p.supplier_id
  ORDER BY (c.fts_r * fts_weight + c.sem_s * semantic_weight) DESC
  LIMIT result_limit;
END;
$$;
