-- ============================================
-- FIX: Hybrid search score normalization
--
-- Problem: ts_rank() returns ~0.0-0.1, cosine similarity returns 0.0-1.0.
-- The weighted sum (fts_r * 0.4 + sem_s * 0.6) means semantic scores
-- always dominate regardless of weights. Search ranking is broken.
--
-- Fix: Normalize FTS rank to 0-1 range using min-max normalization
-- within each result set. Also add similarity threshold (0.3) to
-- the semantic CTE to filter out irrelevant low-similarity results.
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
      -- Similarity threshold: filter out irrelevant results
      AND (1 - (p.embedding <=> query_embedding)) > 0.3
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
  ),
  -- Normalize FTS rank to 0-1 range so it's comparable to cosine similarity
  normalized AS (
    SELECT
      product_id,
      CASE
        WHEN MAX(fts_r) OVER () > 0
        THEN (fts_r / MAX(fts_r) OVER ())::real
        ELSE 0::real
      END AS fts_norm,
      fts_r AS fts_raw,
      sem_s
    FROM combined
  )
  SELECT
    p.id,
    sup.name AS supplier_name,
    p.supplier_code,
    p.description,
    p.selling_uom,
    p.pricing_uom,
    p.price,
    n.fts_raw AS fts_rank,
    n.sem_s AS semantic_similarity,
    (n.fts_norm * fts_weight + n.sem_s * semantic_weight)::float AS combined_score
  FROM normalized n
  JOIN products p ON p.id = n.product_id
  JOIN suppliers sup ON sup.id = p.supplier_id
  ORDER BY (n.fts_norm * fts_weight + n.sem_s * semantic_weight) DESC
  LIMIT result_limit;
END;
$$;
