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
 *   "limit": 20,                    // optional (default 20, max 100)
 *   "fts_weight": 0.4,              // optional (default 0.4, clamped to [0,1])
 *   "semantic_weight": 0.6,         // optional (default 0.6, clamped to [0,1])
 *   "stream": false                 // optional (default false) - enable streaming response
 * }
 *
 * Requires OPENAI_API_KEY in Edge Function secrets.
 * Callers must supply a valid Supabase JWT in the Authorization header.
 */

// Structured logging helper for consistent log format across Edge Functions.
function log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), fn: "search", level, message, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// Simple in-memory rate limiter (per-isolate; resets on cold start).
// Allows `maxRequests` per `windowMs` per IP.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Returns CORS headers sourced from the request Origin (or "*" as fallback).
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Escape ILIKE special characters so user input cannot alter the pattern semantics.
function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Retry a fetch call with exponential backoff (for OpenAI 429/5xx).
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || attempt === maxRetries) return res;
    // Retry on 429 (rate limit) or 5xx (server error)
    if (res.status !== 429 && res.status < 500) return res;
    const delay = Math.min(1000 * 2 ** attempt, 8000);
    console.error(`OpenAI returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, delay));
  }
  // Unreachable, but satisfies TypeScript
  throw new Error("fetchWithRetry: exhausted retries");
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  // --- Rate limiting ---
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(clientIp)) {
    log("warn", "rate_limited", { ip: clientIp });
    return new Response(
      JSON.stringify({ error: "Too many requests. Try again later." }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders(req) } }
    );
  }

  // --- JWT verification ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { error: authError } = await anonClient.auth.getUser();
  if (authError) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  const t0 = Date.now();

  try {
    const body = await req.json();
    let {
      query,
      supplier = null,
      price_min = null,
      price_max = null,
      limit = 20,
      fts_weight = 0.4,
      semantic_weight = 0.6,
      stream = false,
    } = body;

    // --- Input validation ---
    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Provide a non-empty string 'query' field" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
      );
    }
    if (query.length > 500) {
      return new Response(
        JSON.stringify({ error: "'query' must be 500 characters or fewer" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
      );
    }

    limit = Math.min(Math.max(1, Number(limit) || 20), 100);
    fts_weight = Math.min(1, Math.max(0, Number(fts_weight) ?? 0.4));
    semantic_weight = Math.min(1, Math.max(0, Number(semantic_weight) ?? 0.6));

    if (price_min !== null && (typeof price_min !== "number" || isNaN(price_min))) {
      return new Response(
        JSON.stringify({ error: "'price_min' must be a number" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
      );
    }
    if (price_max !== null && (typeof price_max !== "number" || isNaN(price_max))) {
      return new Response(
        JSON.stringify({ error: "'price_max' must be a number" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      log("error", "missing_openai_key");
      return new Response(
        JSON.stringify({ error: "Server misconfiguration" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
      );
    }

    // The service role client bypasses RLS for internal search queries.
    // JWT verification above ensures only authenticated callers reach this point.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Steps 1 & 2 run in parallel: embedding generation + supplier lookup are independent.
    const embeddingPromise = fetchWithRetry("https://api.openai.com/v1/embeddings", {
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

    const supplierPromise = (async () => {
      if (!supplier) return null;
      const safeSupplier = escapeLike(String(supplier));
      const { data: sup } = await supabase
        .from("suppliers")
        .select("id")
        .ilike("name", `%${safeSupplier}%`)
        .limit(1)
        .single();
      return sup?.id ?? null;
    })();

    const [embeddingRes, supplierFilter] = await Promise.all([embeddingPromise, supplierPromise]);

    if (!embeddingRes.ok) {
      const errBody = await embeddingRes.text();
      log("error", "openai_embedding_failed", { status: embeddingRes.status, body: errBody });
      return new Response(
        JSON.stringify({ error: "Failed to generate embedding" }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
      );
    }

    const embeddingData = await embeddingRes.json();
    const queryEmbedding = embeddingData.data[0].embedding;

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
      log("error", "hybrid_search_failed", { code: error.code, detail: error.message });
      return new Response(
        JSON.stringify({ error: "Search failed" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
      );
    }

    log("info", "search_ok", { query, count: data?.length ?? 0, ms: Date.now() - t0 });

    // Se lo streaming è abilitato, invia i risultati uno alla volta
    if (stream) {
      const results = data ?? [];

      const readable = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          // Invia metadati iniziali
          controller.enqueue(
            encoder.encode(JSON.stringify({
              type: "metadata",
              query,
              count: results.length
            }) + "\n")
          );

          // Invia ogni risultato
          for (const result of results) {
            controller.enqueue(
              encoder.encode(JSON.stringify({
                type: "result",
                data: result
              }) + "\n")
            );
          }

          // Invia messaggio di completamento
          controller.enqueue(
            encoder.encode(JSON.stringify({
              type: "done",
              count: results.length
            }) + "\n")
          );

          controller.close();
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...corsHeaders(req),
        },
      });
    }

    // Risposta standard non-streaming
    return new Response(
      JSON.stringify({
        query,
        count: data?.length ?? 0,
        results: data ?? [],
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
    );
  } catch (err) {
    log("error", "unhandled_error", { error: String(err), ms: Date.now() - t0 });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(req) } }
    );
  }
});
