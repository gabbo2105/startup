# Architecture

## System Overview

Hotel Supply Pro is a B2B product search platform for hotel procurement. It combines full-text search (Italian), fuzzy matching, and AI-powered semantic search to help hotel buyers find products across multiple suppliers.

```
                                    TRUST BOUNDARY
                                    ============
  Browser (index.html)                  |         Supabase Platform
  =====================                 |         ==================
                                        |
  +--------------+   JWT + query        |    +-------------------+
  |  Auth UI     |--------------------->|--->| Edge Function:    |
  |  (login/     |                      |    | search            |
  |   register)  |                      |    +--------+----------+
  +--------------+                      |             |
        |                               |             | 1. Validate JWT
        | Supabase Auth                 |             | 2. Generate embedding (OpenAI)
        v                               |             | 3. Resolve supplier (ILIKE)
  +--------------+   JWT + chatInput    |             | 4. Call search_products_hybrid
  |  Chat UI     |--------------------->|--->+-------------------+
  |  (streaming) |                      |    | Edge Function:    |
  +--------------+                      |    | chat-proxy        |
                                        |    +--------+----------+
                                        |             |
                                        |             | 1. Validate JWT
                                        |             | 2. Lookup customer from DB
                                        |             | 3. Forward to n8n (server-side)
                                        |             v
                                        |    +-------------------+
                                        |    | n8n Workflow       |
                                        |    | (AI Agent +        |
                                        |    |  GPT-4.1-mini)     |
                                        |    +-------------------+
                                        |
  External APIs                         |    PostgreSQL (Supabase)
  =============                         |    =====================
                                        |
  +-------------------+                 |    +-------------------+
  | OpenAI API        |<----------------|----| products          |
  | text-embedding-   |  embedding req  |    | (9,189 rows)      |
  | 3-small (1536d)   |                 |    | - fts_vector (GIN)|
  +-------------------+                 |    | - embedding (HNSW)|
                                        |    +-------------------+
                                        |    | suppliers (6)     |
                                        |    +-------------------+
                                        |    | price_lists       |
                                        |    +-------------------+
                                        |    | customers         |
                                        |    | (RLS: own record) |
                                        |    +-------------------+
                                        |    | auth.users        |
                                        |    | (Supabase Auth)   |
                                        |    +-------------------+
```

## Data Flow: Search Query

```
User types query
      |
      v
[Browser] --POST /functions/v1/search--> [Edge Function: search]
      |                                         |
      |                                    Validate JWT (anon client)
      |                                         |
      |                                    +---------+---------+
      |                                    |                   |
      |                               (parallel)          (parallel)
      |                                    |                   |
      |                            OpenAI embedding     Supplier ILIKE
      |                            (fetchWithRetry)     lookup (optional)
      |                                    |                   |
      |                                    +---------+---------+
      |                                         |
      |                                    search_products_hybrid RPC
      |                                         |
      |                                    +----+----+
      |                                    |         |
      |                                 fts_hits  semantic_hits
      |                                 (GIN idx) (HNSW idx)
      |                                    |         |
      |                                    FULL OUTER JOIN
      |                                         |
      |                                    Min-max normalize FTS
      |                                    Apply weights
      |                                    ORDER BY combined_score
      |                                         |
      v                                         v
[Browser] <------- JSON response --------- [Results]
```

## Data Flow: Chat

```
User types message
      |
      v
[Browser] --POST /functions/v1/chat-proxy--> [Edge Function: chat-proxy]
      |                                              |
      |                                         Validate JWT
      |                                              |
      |                                         Lookup customer from DB
      |                                         (server-verified identity)
      |                                              |
      |                                         POST to n8n webhook
      |                                         (with verified identity)
      |                                              |
      |                                              v
      |                                         [n8n Workflow]
      |                                              |
      |                                         AI Agent processes query
      |                                         Calls search Edge Function
      |                                         Formats response
      |                                              |
      v                                              v
[Browser] <------ NDJSON stream ------------ [n8n Response]
```

## Data Flow: User Registration

```
User fills registration form
      |
      v
[Browser] --signUp(email, password, metadata)--> [Supabase Auth]
      |                                                |
      |                                           Creates auth.users row
      |                                                |
      |                                           Trigger: on_auth_user_created
      |                                                |
      |                                           handle_new_user()
      |                                           (SECURITY DEFINER)
      |                                                |
      |                                           INSERT INTO customers
      |                                           (from raw_user_meta_data)
      |                                                |
      v                                                v
[Browser] <-- session + JWT ------------------- [Auth complete]
```

## Component Responsibilities

| Component | Role | Trust Level |
|-----------|------|-------------|
| `index.html` | SPA frontend (auth, chat, search UI) | Untrusted (client) |
| `index.ts` (search) | Hybrid search orchestrator | Trusted (server) |
| `chat_proxy.ts` | n8n proxy with identity verification | Trusted (server) |
| `search_products_hybrid` | SQL scoring engine | Trusted (database) |
| `handle_new_user` | Auto-create customer on signup | Trusted (SECURITY DEFINER) |
| n8n workflow | AI agent with GPT-4.1-mini | Semi-trusted (external) |
| OpenAI API | Embedding generation | External service |

## Security Model

### Authentication
- Supabase Auth (email/password) issues JWTs
- All Edge Functions verify JWT before processing
- Anon key is used client-side (safe to expose, only enables RLS-gated reads)

### Authorization (RLS)
- **products, suppliers, price_lists**: Read by all, write by `app_metadata.role = 'admin'` only
- **customers**: Row-level isolation (own record only), admin override

### Trust Boundaries
- Client-provided identity is **never trusted** - the chat-proxy resolves identity server-side
- Service role key is only used server-side in Edge Functions
- n8n webhook URL is stored in environment, never exposed to client
- OpenAI API key is stored in Edge Function secrets

### Input Validation
- Query length capped at 500 chars (search), 2000 chars (chat)
- ILIKE patterns escaped to prevent pattern injection
- Rate limiting: 30 req/min per IP on search endpoint
- HTML output escaped via `esc()` to prevent XSS

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS SPA, Supabase JS SDK v2 |
| Edge Functions | Deno (TypeScript), Supabase Edge Runtime |
| Database | PostgreSQL 15+ (Supabase) |
| Full-text search | tsvector + GIN index (Italian config) |
| Fuzzy search | pg_trgm extension |
| Vector search | pgvector + HNSW index (cosine distance) |
| Embeddings | OpenAI text-embedding-3-small (1536d) |
| AI Agent | n8n workflow + GPT-4.1-mini |
| Auth | Supabase Auth (email/password) |
| CI/CD | GitHub Actions + Supabase CLI |

## Deployment

```
GitHub (main branch)
      |
      | push
      v
GitHub Actions CI/CD
      |
      +-- Lint (deno lint)
      +-- Format check (deno fmt --check)
      +-- Tests (deno test)
      |
      | all pass
      v
supabase functions deploy search
supabase functions deploy chat-proxy
      |
      v
Supabase Edge Runtime (Deno)
```

Database migrations are applied manually via Supabase Dashboard SQL editor or `supabase db push`.
