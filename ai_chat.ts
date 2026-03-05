import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * AI Chat Edge Function — replaces n8n + chat-proxy.
 * Direct OpenAI Chat Completions with tool calling + streaming.
 *
 * POST /functions/v1/ai-chat
 * { "chatInput": "Che prosecco avete?", "sessionId": "uuid" }
 *
 * Requires: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */

// ============================================================
// Infrastructure (from index.ts pattern)
// ============================================================

function log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), fn: "ai-chat", level, message, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60_000;

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

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonError(message: string, status: number, req: Request): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || attempt === maxRetries) return res;
    if (res.status !== 429 && res.status < 500) return res;
    const delay = Math.min(1000 * 2 ** attempt, 8000);
    log("warn", "openai_retry", { status: res.status, attempt: attempt + 1, delay });
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error("fetchWithRetry: exhausted retries");
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ============================================================
// Types
// ============================================================

interface CustomerRecord {
  id: string;
  email: string | null;
  contact_person: string | null;
  hotel_name: string | null;
  hotel_address: string | null;
  company_name: string | null;
  vat_number: string | null;
  phone: string | null;
  contact_role: string | null;
}

interface ChatMessageRow {
  role: string;
  content: string | null;
  tool_calls: unknown | null;
  tool_call_id: string | null;
  tool_name: string | null;
}

// deno-lint-ignore no-explicit-any
type OpenAIMessage = Record<string, any>;

// ============================================================
// System Prompt
// ============================================================

function buildSystemPrompt(customer: CustomerRecord): string {
  return `Sei l'assistente per gli acquisti di Hotel Supply Pro.
Hai accesso al catalogo prodotti di tutti gli hotel serviti.

Quando l'utente chiede informazioni su prodotti, prezzi o fornitori, usa lo strumento "search_products" per cercare nel database.

CONTESTO UTENTE (pre-caricato dal sistema, NON serve chiamare get_customer per questi dati):
- Customer ID: ${customer.id}
- Nome: ${customer.contact_person ?? "N/A"}
- Email: ${customer.email ?? "N/A"}
- Hotel: ${customer.hotel_name ?? "N/A"}
- Indirizzo: ${customer.hotel_address ?? "N/A"}
- Ragione sociale: ${customer.company_name ?? "N/A"}
- P.IVA: ${customer.vat_number ?? "N/A"}
- Telefono: ${customer.phone ?? "N/A"}
- Ruolo: ${customer.contact_role ?? "N/A"}

REGOLA AZIONE IMMEDIATA:
Quando l'utente chiede di aggiungere, rimuovere o modificare prodotti nel carrello, ESEGUI SUBITO con <!--CART_ACTION[...]-->. NON chiedere conferma, NON dire "procedo a..." senza farlo — includi il blocco CART_ACTION nella stessa risposta. Chiedi conferma SOLO per ordini finali.

REGOLE PER LE QUERY DI RICERCA:
- Traduci sempre la richiesta dell'utente in termini specifici da catalogo. NON usare parole generiche.
  Esempi:
  • "alcol da bere" → cerca "vodka", "gin", "rum", "whisky", "liquore" (NON "alcol" che trova alcol etilico per pulizia)
  • "qualcosa per la colazione" → cerca "cornetti", "brioche", "marmellata", "cereali"
  • "roba per pulire" → cerca "detersivo", "sgrassatore", "disinfettante"
  • "bibite" → cerca "coca cola", "fanta", "sprite", "aranciata"
- Se la richiesta è ampia, fai PIÙ RICERCHE con termini specifici diversi invece di una sola ricerca generica
- Usa le abbreviazioni del catalogo quando le conosci: "EVO" per extravergine, "DOCG"/"DOC" per i vini, "CL" per centilitri, "PET" per bottiglie di plastica
- Se non trovi risultati, prova con sinonimi o parole chiave diverse

REGOLE PER LE RISPOSTE:
- Presenta i risultati in modo chiaro con nome prodotto, fornitore, prezzo e unità, e prezzo unitario
- Se l'utente chiede confronti tra fornitori, cerca il prodotto e mostra le opzioni di tutti i fornitori
- Rispondi sempre in italiano
- I prezzi sono in EUR
- Usa markdown per formattare le risposte (grassetto, elenchi, tabelle quando utile)
FILTRA i risultati: mostra SOLO i prodotti che corrispondono a ciò che l'utente ha chiesto.
Se chiede "Coca Cola", mostra solo Coca Cola classica, NON Coca Cola Zero/Light/Diet.
Se ci sono varianti correlate, menzionale brevemente alla fine
(es. "Ho trovato anche varianti Zero e Light, vuoi vederle?")

IMPORTANTE — FORMATO PRESENTAZIONE PRODOTTI:
Il frontend aggiunge automaticamente un bottone 🛒 "Aggiungi al carrello" accanto ad ogni prodotto che presenti, a condizione che il testo contenga il simbolo € con il prezzo.

Per far funzionare correttamente i bottoni, quando presenti prodotti segui SEMPRE questo formato:

Per ELENCHI PUNTATI (formato preferito):
• NOME PRODOTTO IN MAIUSCOLO (FORNITORE) – €prezzo unità/confezione
Esempio:
• PROSECCO DOC EXTRA DRY CONTARINI CL75 (DAC SPA) – €4,30 a confezione da 6 bottiglie da 750 ml
• MARMELLATA M&G ARANCIA 3 kg (MARR SPA) – €13,15 (CT da 1 da 3 kg)

Per ELENCHI CON SOTTO-DETTAGLI:
1. NOME PRODOTTO IN MAIUSCOLO
   - Fornitore: NOME FORNITORE
   - Prezzo: €prezzo
   - Unità: descrizione unità
   - prezzo unitario

Per TABELLE (quando confronti prezzi):
| Prodotto | Fornitore | Formato | Prezzo | Prezzo Unitario |
|----------|-----------|---------|--------|-----------------|
| COCA-COLA PET 6X1,5 L | MARR SPA | 6 x 1,5 L | €11,98 | €1,99

REGOLE CHIAVE per i bottoni:
- Includi SEMPRE il simbolo € davanti al prezzo (es. €4,30, NON 4,30 EUR)
- Metti il nome del fornitore tra parentesi tonde dopo il nome prodotto, OPPURE in una colonna/riga dedicata "Fornitore:"
- Il nome prodotto deve essere la parte iniziale della riga, PRIMA del fornitore e del prezzo
- Non servono tag nascosti o markup speciali — basta seguire questi formati

REGOLE PER GLI ORDINI:
Gli ordini vengono creati dal frontend (popup di conferma) e salvati su Supabase. L'agente NON deve creare ordini.

Se l'utente chiede informazioni sui propri ordini ma non ha il numero, suggerisci di controllare la sezione "I miei ordini".

NOTE: nelle risposte relative agli ordini NON usare il formato prodotto con € (altrimenti il frontend aggiungerebbe bottoni inutili). Usa "EUR" al posto di €.

=== CARRELLO ===

Il carrello dell'utente è salvato su Supabase nella tabella cart_sessions.
Usa lo strumento "read_cart" per leggere il contenuto del carrello quando l'utente:
- Chiede "cosa ho nel carrello", "mostra il carrello", "che prodotti ho aggiunto"
- Vuole ordinare (devi prima leggere cosa c'è nel carrello)
- Chiede di rimuovere o modificare un prodotto nel carrello

Il tool restituirà un JSON con il campo "items" che contiene un array di prodotti con id, description, supplier_name, price, selling_uom e qty.

Il frontend gestisce le azioni sul carrello tramite blocchi nascosti alla fine della risposta:
<!--CART_ACTION[{"action":"...", ...},...]-->

AZIONI DISPONIBILI:

1. AGGIUNGERE un prodotto:
   {"action":"add","id":"uuid","description":"NOME PRODOTTO","supplier_name":"FORNITORE","price":12.34,"selling_uom":"unità","qty":1}
   → PRIMA cerca il prodotto con lo strumento "search_products" per ottenere id, descrizione, prezzo e fornitore esatti
   → Poi inserisci TUTTI i campi nell'azione add (id, description, supplier_name, price, selling_uom, qty sono tutti obbligatori)

2. RIMUOVERE un prodotto:
   {"action":"remove","id":"uuid"}
   → Usa l'id che trovi leggendo il carrello con lo strumento "read_cart"

3. MODIFICARE la quantità:
   {"action":"update_qty","id":"uuid","qty":3}

4. SVUOTARE il carrello:
   {"action":"clear"}

ESEMPI:

Utente: "aggiungi un prosecco al carrello"
→ Cerca "prosecco" con lo strumento search_products
→ Se trovi un solo risultato ovvio, aggiungilo. Se ne trovi molti, chiedi quale vuole.
→ Risposta (con 1 solo risultato chiaro):
  Ho aggiunto **PROSECCO DOC EXTRA DRY CONTARINI** (DAC SPA, €4,30) al carrello.
  <!--CART_ACTION[{"action":"add","id":"abc-123","description":"PROSECCO DOC EXTRA DRY CONTARINI","supplier_name":"DAC SPA","price":4.30,"selling_uom":"750 ml","qty":1}]-->

Utente: "togli il prosecco dal carrello"
→ Usa lo strumento "read_cart" per leggere gli items, trova l'id del prosecco
→ Risposta:
  Ho rimosso il prosecco dal carrello.
  <!--CART_ACTION[{"action":"remove","id":"abc-123"}]-->

Utente: "metti 5 unità del detersivo"
→ Usa lo strumento "read_cart" per leggere gli items, trova l'id del detersivo
→ Risposta:
  Ho aggiornato la quantità del detersivo a 5.
  <!--CART_ACTION[{"action":"update_qty","id":"def-456","qty":5}]-->

Utente: "svuota il carrello"
  Ho svuotato il carrello.
  <!--CART_ACTION[{"action":"clear"}]-->

REGOLE IMPORTANTI:
- Per ADD: devi SEMPRE fare prima una ricerca con lo strumento per avere dati reali (id, prezzo). NON inventare id o prezzi.
- Se la richiesta è ambigua (es. "aggiungi il prosecco" ma ce ne sono 10 tipi), mostra le opzioni nel formato prodotto standard (con €) così l'utente può cliccare il bottone 🛒 direttamente dalla lista. NON usare CART_ACTION in questo caso.
- Puoi combinare più azioni: [{"action":"remove","id":"a"},{"action":"add","id":"b",...}]
- NON menzionare mai i blocchi nascosti all'utente`;
}

// ============================================================
// OpenAI Tool Definitions
// ============================================================

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_products",
      description:
        "Cerca prodotti nel catalogo fornitori dell'hotel. Restituisce prodotti con nome, fornitore, prezzo, e punteggio di rilevanza. Usa termini specifici da catalogo, NON parole generiche. Fai più chiamate se servono più categorie.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Termini specifici da catalogo (es. 'prosecco DOC', 'detersivo piatti'). NON usare parole generiche.",
          },
          supplier: {
            type: "string",
            description: "Nome fornitore opzionale (es. 'MARR', 'DAC SPA')",
          },
          price_min: { type: "number", description: "Prezzo minimo EUR" },
          price_max: { type: "number", description: "Prezzo massimo EUR" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_cart",
      description:
        "Leggi il contenuto del carrello dell'utente. Usa quando l'utente chiede cosa ha nel carrello, vuole ordinare, o chiede di modificare/rimuovere un prodotto.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_customer",
      description:
        "Recupera il profilo completo del cliente. I dati base sono già nel contesto; usa questo tool solo se hai bisogno di informazioni aggiornate.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_email",
      description:
        "Invia email di conferma ordine al cliente. Parametro: order_id dall'ordine appena creato.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "UUID dell'ordine" },
        },
        required: ["order_id"],
      },
    },
  },
];

// ============================================================
// Tool Implementations
// ============================================================

async function executeSearchProducts(
  args: { query: string; supplier?: string; price_min?: number; price_max?: number },
  supabase: SupabaseClient,
  openaiKey: string,
): Promise<string> {
  // Generate embedding
  const embRes = await fetchWithRetry("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: args.query }),
  });

  if (!embRes.ok) {
    const errText = await embRes.text();
    log("error", "embedding_failed", { status: embRes.status, body: errText });
    return JSON.stringify({ error: "Errore generazione embedding" });
  }

  const embData = await embRes.json();
  const queryEmbedding = embData.data[0].embedding;

  // Resolve supplier name to ID if provided
  let supplierFilter: string | null = null;
  if (args.supplier) {
    const safeSupplier = escapeLike(String(args.supplier));
    const { data: sup } = await supabase
      .from("suppliers")
      .select("id")
      .ilike("name", `%${safeSupplier}%`)
      .limit(1)
      .single();
    supplierFilter = sup?.id ?? null;
  }

  const { data, error } = await supabase.rpc("search_products_hybrid", {
    search_text: args.query,
    query_embedding: JSON.stringify(queryEmbedding),
    supplier_filter: supplierFilter,
    price_min: args.price_min ?? null,
    price_max: args.price_max ?? null,
    fts_weight: 0.4,
    semantic_weight: 0.6,
    result_limit: 20,
  });

  if (error) {
    log("error", "search_failed", { code: error.code, detail: error.message });
    return JSON.stringify({ error: "Ricerca fallita", detail: error.message });
  }

  if (!data || data.length === 0) {
    return JSON.stringify({ results: [], message: `Nessun risultato per: "${args.query}"` });
  }

  // Return only fields the model needs
  // deno-lint-ignore no-explicit-any
  const results = data.map((r: any) => ({
    id: r.id,
    description: r.description,
    supplier_name: r.supplier_name,
    supplier_code: r.supplier_code,
    price: r.price,
    selling_uom: r.selling_uom,
    combined_score: r.combined_score,
  }));

  return JSON.stringify({ results, count: results.length });
}

async function executeReadCart(
  customerId: string,
  sessionId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const { data } = await supabase
    .from("cart_sessions")
    .select("items")
    .eq("customer_id", customerId)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!data || !data.items || (Array.isArray(data.items) && data.items.length === 0)) {
    return JSON.stringify({ items: [], message: "Il carrello è vuoto." });
  }

  return JSON.stringify({ items: data.items });
}

async function executeGetCustomer(
  customerId: string,
  supabase: SupabaseClient,
): Promise<string> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (error || !data) {
    return JSON.stringify({ error: "Cliente non trovato" });
  }

  return JSON.stringify(data);
}

async function executeSendEmail(
  args: { order_id: string },
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const res = await fetch(`${supabaseUrl}/functions/v1/send-order-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ order_id: args.order_id }),
  });

  const data = await res.json();
  if (!res.ok) {
    log("error", "send_email_failed", { status: res.status, data });
    return JSON.stringify({ error: "Invio email fallito", detail: data.error ?? "unknown" });
  }

  return JSON.stringify({ success: true, sent_to: data.sent_to, order_number: data.order_number });
}

// ============================================================
// History Formatting
// ============================================================

function formatHistoryForOpenAI(rows: ChatMessageRow[]): OpenAIMessage[] {
  return rows.map((row) => {
    if (row.role === "assistant" && row.tool_calls) {
      return {
        role: "assistant",
        content: row.content || null,
        tool_calls: row.tool_calls,
      };
    }
    if (row.role === "tool") {
      return {
        role: "tool",
        tool_call_id: row.tool_call_id!,
        content: row.content || "",
      };
    }
    return {
      role: row.role as "user" | "assistant",
      content: row.content || "",
    };
  });
}

// ============================================================
// Tool Execution
// ============================================================

async function executeTool(
  toolName: string,
  // deno-lint-ignore no-explicit-any
  args: any,
  customer: CustomerRecord,
  sessionId: string,
  supabase: SupabaseClient,
  openaiKey: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  switch (toolName) {
    case "search_products":
      return await executeSearchProducts(args, supabase, openaiKey);
    case "read_cart":
      return await executeReadCart(customer.id, sessionId, supabase);
    case "get_customer":
      return await executeGetCustomer(customer.id, supabase);
    case "send_email":
      return await executeSendEmail(args, supabaseUrl, serviceRoleKey);
    default:
      return JSON.stringify({ error: `Tool sconosciuto: ${toolName}` });
  }
}

// ============================================================
// Main Handler
// ============================================================

const MODEL = "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_ROWS = 40;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonError("POST only", 405, req);
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(clientIp)) {
    log("warn", "rate_limited", { ip: clientIp });
    return new Response(
      JSON.stringify({ error: "Troppe richieste. Riprova tra un minuto." }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders(req) } },
    );
  }

  // --- JWT verification ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonError("Missing or invalid Authorization header", 401, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!openaiKey) {
    log("error", "missing_openai_key");
    return jsonError("Server misconfiguration", 500, req);
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return jsonError("Unauthorized", 401, req);
  }

  const t0 = Date.now();

  try {
    // --- Parse and validate input ---
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonError("Request body must be valid JSON", 400, req);
    }

    const { chatInput, sessionId } = body;

    if (typeof chatInput !== "string" || chatInput.trim().length === 0) {
      return jsonError("'chatInput' must be a non-empty string", 400, req);
    }
    if ((chatInput as string).length > 2000) {
      return jsonError("'chatInput' exceeds maximum length of 2000 characters", 400, req);
    }
    if (!sessionId || typeof sessionId !== "string" || (sessionId as string).trim().length === 0) {
      return jsonError("'sessionId' is required", 400, req);
    }

    const trimmedInput = (chatInput as string).trim();
    const trimmedSessionId = (sessionId as string).trim();

    // --- Service role client for DB operations ---
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // --- Customer lookup ---
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, email, contact_person, hotel_name, hotel_address, company_name, vat_number, phone, contact_role")
      .eq("auth_user_id", user.id)
      .single();

    if (customerError || !customer) {
      log("warn", "customer_not_found", { userId: user.id });
      return jsonError("Customer profile not found", 403, req);
    }

    // --- Load chat history ---
    const { data: history } = await supabase
      .from("chat_messages")
      .select("role, content, tool_calls, tool_call_id, tool_name")
      .eq("customer_id", customer.id)
      .eq("session_id", trimmedSessionId)
      .order("created_at", { ascending: true })
      .limit(MAX_HISTORY_ROWS);

    // --- Build messages array ---
    const messages: OpenAIMessage[] = [
      { role: "system", content: buildSystemPrompt(customer as CustomerRecord) },
      ...formatHistoryForOpenAI((history as ChatMessageRow[]) || []),
      { role: "user", content: trimmedInput },
    ];

    // --- Save user message ---
    await supabase.from("chat_messages").insert({
      customer_id: customer.id,
      session_id: trimmedSessionId,
      role: "user",
      content: trimmedInput,
    });

    // --- Tool calling loop ---
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const isLastRound = round === MAX_TOOL_ROUNDS - 1;

      const completionRes = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          tools: TOOLS,
          tool_choice: isLastRound ? "none" : "auto",
          stream: false,
          max_tokens: 4096,
        }),
      });

      if (!completionRes.ok) {
        const errBody = await completionRes.text();
        log("error", "openai_completion_failed", { status: completionRes.status, body: errBody });
        return jsonError("AI service error", 502, req);
      }

      const completionData = await completionRes.json();
      const choice = completionData.choices?.[0];
      if (!choice) {
        log("error", "openai_no_choice", { data: completionData });
        return jsonError("AI service returned no response", 502, req);
      }

      const assistantMsg = choice.message;

      // If model wants to call tools
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        messages.push(assistantMsg);

        // Save assistant tool-calling message
        await supabase.from("chat_messages").insert({
          customer_id: customer.id,
          session_id: trimmedSessionId,
          role: "assistant",
          content: assistantMsg.content || null,
          tool_calls: assistantMsg.tool_calls,
          model: MODEL,
          tokens_prompt: completionData.usage?.prompt_tokens ?? null,
          tokens_completion: completionData.usage?.completion_tokens ?? null,
        });

        // Execute all tool calls in parallel
        const toolResults = await Promise.all(
          // deno-lint-ignore no-explicit-any
          assistantMsg.tool_calls.map(async (tc: any) => {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              // If argument parsing fails, pass empty
            }
            let result: string;
            try {
              result = await executeTool(
                tc.function.name,
                args,
                customer as CustomerRecord,
                trimmedSessionId,
                supabase,
                openaiKey,
                supabaseUrl,
                serviceRoleKey,
              );
            } catch (err) {
              result = JSON.stringify({ error: String(err) });
            }
            return { tool_call_id: tc.id, name: tc.function.name, result };
          }),
        );

        // Add tool results to conversation and save to DB
        for (const tr of toolResults) {
          messages.push({
            role: "tool",
            tool_call_id: tr.tool_call_id,
            content: tr.result,
          });
          await supabase.from("chat_messages").insert({
            customer_id: customer.id,
            session_id: trimmedSessionId,
            role: "tool",
            content: tr.result,
            tool_call_id: tr.tool_call_id,
            tool_name: tr.name,
          });
        }

        log("info", "tool_round", { round, tools: toolResults.map((t) => t.name) });
        continue; // Next round
      }

      // Model returned content — break to streaming
      break;
    }

    // --- Final streaming response ---
    const streamRes = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: TOOLS,
        tool_choice: "none",
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 4096,
      }),
    });

    if (!streamRes.ok) {
      const errBody = await streamRes.text();
      log("error", "openai_stream_failed", { status: streamRes.status, body: errBody });
      return jsonError("AI service error", 502, req);
    }

    let fullContent = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0 };

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const reader = streamRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                  fullContent += delta.content;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ chunk: delta.content })}\n\n`),
                  );
                }
                if (parsed.usage) {
                  usage = parsed.usage;
                }
              } catch {
                // Skip malformed chunks
              }
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          // Save assistant response to DB (fire-and-forget)
          supabase.from("chat_messages").insert({
            customer_id: customer.id,
            session_id: trimmedSessionId,
            role: "assistant",
            content: fullContent,
            model: MODEL,
            tokens_prompt: usage.prompt_tokens || null,
            tokens_completion: usage.completion_tokens || null,
          }).then(({ error: insertErr }) => {
            if (insertErr) log("error", "save_response_failed", { error: insertErr.message });
          });

          log("info", "chat_ok", {
            customerId: customer.id,
            ms: Date.now() - t0,
            tokens: usage.prompt_tokens + usage.completion_tokens,
          });
        } catch (err) {
          log("error", "stream_error", { error: String(err) });
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        ...corsHeaders(req),
      },
    });
  } catch (err) {
    log("error", "unhandled_error", { error: String(err), ms: Date.now() - t0 });
    return jsonError("Internal server error", 500, req);
  }
});
