-- ============================================
-- VECTOR SEARCH con pgvector
-- Per ricerca semantica AI-powered
-- ============================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (1536 dim = OpenAI text-embedding-3-small)
ALTER TABLE products ADD COLUMN embedding vector(1536);

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX idx_products_embedding ON products 
  USING hnsw(embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Semantic search function
CREATE OR REPLACE FUNCTION search_products_semantic(
  query_embedding vector(1536),
  supplier_filter uuid DEFAULT NULL,
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  similarity_threshold float DEFAULT 0.5,
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
  similarity float
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
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > similarity_threshold
    AND (supplier_filter IS NULL OR p.supplier_id = supplier_filter)
    AND (price_min IS NULL OR p.price >= price_min)
    AND (price_max IS NULL OR p.price <= price_max)
  ORDER BY p.embedding <=> query_embedding
  LIMIT result_limit;
$$;

-- Hybrid search: combines full-text + semantic
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
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH fts_results AS (
    SELECT 
      p.id,
      s.name AS supplier_name,
      p.supplier_code,
      p.description,
      p.selling_uom,
      p.pricing_uom,
      p.price,
      ts_rank(p.fts_vector, websearch_to_tsquery('italian', search_text)) AS fts_rank,
      CASE 
        WHEN query_embedding IS NOT NULL AND p.embedding IS NOT NULL 
        THEN 1 - (p.embedding <=> query_embedding)
        ELSE 0 
      END AS semantic_similarity
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE 
      (p.fts_vector @@ websearch_to_tsquery('italian', search_text))
      OR (query_embedding IS NOT NULL AND p.embedding IS NOT NULL AND 1 - (p.embedding <=> query_embedding) > 0.5)
    AND (supplier_filter IS NULL OR p.supplier_id = supplier_filter)
    AND (price_min IS NULL OR p.price >= price_min)
    AND (price_max IS NULL OR p.price <= price_max)
  )
  SELECT 
    fr.*,
    (fr.fts_rank * fts_weight + fr.semantic_similarity * semantic_weight)::float AS combined_score
  FROM fts_results fr
  ORDER BY combined_score DESC
  LIMIT result_limit;
$$;
