import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Unified search endpoint for the AI agent.
 * 
 * POST /functions/v1/search
 * {
 *   "query": "vino rosso toscano",
 *   "supplier": "MARR SPA",        // optional
 *   "price_min": 5,                 // optional
 *   "price_max": 50,                // optional
 *   "limit": 20,                    // optional (default 20)
 *   "mode": "fts"                   // "fts" | "fuzzy" | "semantic" | "hybrid"
 * }
 */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const {
      query,
      supplier = null,
      price_min = null,
      price_max = null,
      limit = 20,
      mode = "fts",
    } = body;

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Provide a 'query' field" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve supplier name to UUID if provided
    let supplierFilter = null;
    if (supplier) {
      const { data: sup } = await supabase
        .from("suppliers")
        .select("id")
        .ilike("name", `%${supplier}%`)
        .limit(1)
        .single();
      supplierFilter = sup?.id ?? null;
    }

    let results;

    if (mode === "fuzzy") {
      const { data, error } = await supabase.rpc("search_products_fuzzy", {
        search_query: query,
        similarity_threshold: 0.15,
        result_limit: limit,
      });
      if (error) throw error;
      results = data;
    } else {
      // Default: full-text search (Italian)
      const { data, error } = await supabase.rpc("search_products_fts", {
        search_query: query,
        supplier_filter: supplierFilter,
        price_min: price_min,
        price_max: price_max,
        result_limit: limit,
      });
      if (error) throw error;
      results = data;
    }

    return new Response(
      JSON.stringify({
        query,
        mode,
        count: results?.length ?? 0,
        results: results ?? [],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
