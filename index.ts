import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Unified hybrid search endpoint for the AI agent.
 * Generates embedding via OpenAI, then calls search_products_hybrid.
 *
 * POST /functions/v1/search
 * {
 *   "query": "prodotti per la colazione",
 *   "supplier": "MARR SPA",        // optional - filter by supplier name
 *   "price_min": 5,                 // optional
 *   "price_max": 50,                // optional
 *   "limit": 20,                    // optional (default 20)
 *   "fts_weight": 0.4,              // optional (default 0.4)
 *   "semantic_weight": 0.6          // optional (default 0.6)
 * }
 *
 * Requires OPENAI_API_KEY in Edge Function secrets.
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
      fts_weight = 0.4,
      semantic_weight = 0.6,
    } = body;

    if (!query) {
      return new Response(
        JSON.stringify({ error: "Provide a 'query' field" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured in Edge Function secrets" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 1: Generate embedding for the query
    const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query,
      }),
    });

    if (!embeddingRes.ok) {
      const err = await embeddingRes.text();
      return new Response(
        JSON.stringify({ error: `OpenAI embedding failed: ${err}` }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const embeddingData = await embeddingRes.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Step 2: Resolve supplier name to UUID if provided
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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

    // Step 3: Call hybrid search
    const { data, error } = await supabase.rpc("search_products_hybrid", {
      search_text: query,
      query_embedding: JSON.stringify(queryEmbedding),
      supplier_filter: supplierFilter,
      price_min: price_min,
      price_max: price_max,
      fts_weight: fts_weight,
      semantic_weight: semantic_weight,
      result_limit: limit,
    });

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        query,
        count: data?.length ?? 0,
        results: data ?? [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
