-- ============================================
-- FIX: Riscrive semantic e hybrid in plpgsql
-- con search_path = public, extensions
-- (necessario dopo spostamento estensioni in schema extensions)
-- ============================================

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
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    s.name AS supplier_name,
    p.supplier_code,
    p.description,
    p.selling_uom,
    p.pricing_uom,
    p.price,
    (1 - (p.embedding <=> query_embedding))::float AS similarity
  FROM products p
  JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.embedding IS NOT NULL
    AND (1 - (p.embedding <=> query_embedding)) > similarity_threshold
    AND (supplier_filter IS NULL OR p.supplier_id = supplier_filter)
    AND (price_min IS NULL OR p.price >= price_min)
    AND (price_max IS NULL OR p.price <= price_max)
  ORDER BY p.embedding <=> query_embedding
  LIMIT result_limit;
END;
$$;
