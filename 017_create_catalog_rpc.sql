-- CREATE: search_products_catalog RPC for browsable catalog
-- Lightweight search+filter+pagination without embeddings.
-- Uses Italian FTS + ILIKE for instant results.

CREATE OR REPLACE FUNCTION search_products_catalog(
  search_text text DEFAULT NULL,
  category_filter uuid DEFAULT NULL,
  supplier_filter uuid DEFAULT NULL,
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  sort_by text DEFAULT 'description',
  page_size int DEFAULT 24,
  page_offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  supplier_id uuid,
  supplier_name text,
  supplier_code text,
  description text,
  selling_uom text,
  price numeric,
  category_id uuid,
  category_name text,
  category_slug text,
  total_count bigint
)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT
      p.id, p.supplier_id, s.name AS supplier_name,
      p.supplier_code, p.description, p.selling_uom,
      p.price, p.category_id,
      c.name AS category_name, c.slug AS category_slug
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE
      (search_text IS NULL OR search_text = '' OR
        p.fts_vector @@ websearch_to_tsquery('italian', search_text) OR
        p.description ILIKE '%' || search_text || '%')
      AND (category_filter IS NULL OR p.category_id = category_filter)
      AND (supplier_filter IS NULL OR p.supplier_id = supplier_filter)
      AND (price_min IS NULL OR p.price >= price_min)
      AND (price_max IS NULL OR p.price <= price_max)
  )
  SELECT
    f.id, f.supplier_id, f.supplier_name, f.supplier_code,
    f.description, f.selling_uom, f.price,
    f.category_id, f.category_name, f.category_slug,
    count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    CASE WHEN sort_by = 'price_asc' THEN f.price END ASC NULLS LAST,
    CASE WHEN sort_by = 'price_desc' THEN f.price END DESC NULLS LAST,
    CASE WHEN sort_by = 'description' OR sort_by IS NULL THEN f.description END ASC
  LIMIT page_size
  OFFSET page_offset;
END;
$$;
