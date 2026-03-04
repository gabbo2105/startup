import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Server-side proxy for n8n chat webhook.
 * Verifies JWT, looks up real customer data from DB, and forwards to n8n.
 * This prevents the n8n webhook URL from being exposed in client code.
 *
 * POST /functions/v1/chat-proxy
 * {
 *   "chatInput": "Che prosecco avete?",
 *   "sessionId": "uuid",
 *   "stream": true
 * }
 *
 * Requires N8N_WEBHOOK_URL in Edge Function secrets.
 * Callers must supply a valid Supabase JWT in the Authorization header.
 */

function log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), fn: "chat-proxy", level, message, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonError("POST only", 405);
  }

  // --- JWT verification ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonError("Missing or invalid Authorization header", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    log("error", "missing_env", { vars: "SUPABASE_URL or SUPABASE_ANON_KEY" });
    return jsonError("Server configuration error", 500);
  }

  // Use anon key + caller's JWT to keep RLS in effect
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError("Unauthorized", 401);
  }

  // --- Read n8n webhook URL from environment ---
  const n8nWebhookUrl = Deno.env.get("N8N_WEBHOOK_URL");
  if (!n8nWebhookUrl) {
    log("error", "missing_env", { vars: "N8N_WEBHOOK_URL" });
    return jsonError("Upstream service not configured", 500);
  }

  // --- Parse and validate request body ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Request body must be valid JSON", 400);
  }

  const { chatInput, sessionId, stream = false } = body;

  if (typeof chatInput !== "string" || chatInput.trim().length === 0) {
    return jsonError("'chatInput' must be a non-empty string", 400);
  }
  if (chatInput.length > 2000) {
    return jsonError("'chatInput' exceeds the maximum length of 2000 characters", 400);
  }
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return jsonError("'sessionId' is required", 400);
  }

  // --- Look up real customer data from DB (never trust client-provided identity) ---
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, contact_person, hotel_name, company_name")
    .eq("auth_user_id", user.id)
    .single();

  if (customerError || !customer) {
    log("warn", "customer_not_found", { userId: user.id, error: customerError?.message ?? "no record" });
    return jsonError("Customer profile not found", 403);
  }

  // --- Forward to n8n with server-verified identity ---
  const upstreamPayload = {
    chatInput: chatInput.trim(),
    sessionId: sessionId.trim(),
    customerId: customer.id,
    customerName: customer.contact_person ?? "",
    hotelName: customer.hotel_name ?? "",
    companyName: customer.company_name ?? "",
    stream,
  };

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstreamPayload),
    });
  } catch (fetchErr) {
    log("error", "n8n_unreachable", { error: String(fetchErr) });
    return jsonError("Failed to reach upstream service", 502);
  }

  if (!upstreamRes.ok) {
    const upstreamBody = await upstreamRes.text().catch(() => "(unreadable)");
    log("error", "n8n_error", { status: upstreamRes.status, body: upstreamBody });
    return jsonError("Upstream service returned an error", 502);
  }

  log("info", "chat_ok", { userId: user.id, customerId: customer.id });

  // --- Pipe response back (supports streaming NDJSON passthrough) ---
  const contentType = upstreamRes.headers.get("Content-Type") ?? "application/json";
  const isStreaming =
    contentType.includes("application/x-ndjson") ||
    contentType.includes("text/event-stream");

  const responseHeaders: HeadersInit = {
    ...corsHeaders,
    "Content-Type": contentType,
    ...(isStreaming ? { "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } : {}),
  };

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
});
