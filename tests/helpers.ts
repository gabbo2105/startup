/**
 * helpers.ts
 *
 * Pure utility functions extracted from the edge function source files so they
 * can be unit-tested without importing the full Deno.serve() entry-points.
 *
 * These implementations must stay in sync with index.ts and chat_proxy.ts.
 * When either source file changes, update the corresponding function here and
 * add a regression test.
 */

// ---------------------------------------------------------------------------
// Extracted from index.ts
// ---------------------------------------------------------------------------

/**
 * Escape ILIKE special characters so that user-supplied supplier names cannot
 * alter pattern semantics in a PostgreSQL ILIKE expression.
 *
 * Characters escaped: backslash (\), percent (%), underscore (_).
 *
 * Source: index.ts line 35-37.
 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Build CORS headers from the request Origin, falling back to "*".
 *
 * Source: index.ts line 25-32.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ---------------------------------------------------------------------------
// Extracted from index.html (frontend helper used in XSS tests)
// ---------------------------------------------------------------------------

/**
 * Safely HTML-escape a plain-text string using the browser's own escaping
 * rules.  In the frontend this uses a live DOM element; here we replicate the
 * identical five-character substitution table that browsers apply.
 *
 * Characters escaped: &, <, >, ", '
 *
 * Source: index.html line 423.
 */
export function esc(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------
// Extracted from chat_proxy.ts
// ---------------------------------------------------------------------------

/**
 * Static CORS headers used by chat_proxy.ts (origin is hardcoded to "*").
 *
 * Source: chat_proxy.ts lines 20-24.
 */
export const chatProxyCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Build a JSON error Response identical to the one produced by the
 * `jsonError` helper inside chat_proxy.ts.
 *
 * Source: chat_proxy.ts lines 26-31.
 */
export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...chatProxyCorsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Validation helpers (mirrors logic inside the Deno.serve handlers)
// ---------------------------------------------------------------------------

/** Clamp a numeric value to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validate and normalise a raw `limit` value the same way index.ts does:
 *   limit = Math.min(Math.max(1, Number(limit) || 20), 100)
 */
export function normaliseLimit(raw: unknown): number {
  return Math.min(Math.max(1, Number(raw) || 20), 100);
}

/**
 * Validate and normalise a raw weight value the same way index.ts does:
 *   weight = Math.min(1, Math.max(0, Number(weight) ?? default))
 *
 * NOTE: index.ts uses `Number(weight) ?? default`.  The `??` operator does NOT
 * catch NaN — it only catches null and undefined.  Therefore:
 *   - Number(undefined) === NaN, and NaN ?? 0.4 === NaN (no fallback)
 *   - Math.max(0, NaN)  === NaN
 *   - Math.min(1, NaN)  === NaN
 * This means undefined/null weight values actually produce NaN at runtime.
 * The helper replicates this behaviour faithfully so the tests document the
 * actual source behaviour rather than an idealised version of it.
 */
export function normaliseWeight(raw: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, Number(raw) ?? fallback));
}
