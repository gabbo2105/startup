# Hotel Supply Pro

AI-powered product search for hotel procurement. Combines Italian full-text search, fuzzy matching, and semantic vector search across 9,189 products from 6 suppliers.

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your Supabase and OpenAI credentials

# 2. Apply database migrations (in order)
# Run each .sql file in Supabase Dashboard > SQL Editor:
# 001_create_base_tables.sql through 011_create_customers_table.sql

# 3. Import product data
pip install requests
python import_products.py --json-file all_products.json

# 4. Generate embeddings
python generate_embeddings.py

# 5. Deploy Edge Functions
supabase functions deploy search --project-ref $SUPABASE_PROJECT_REF
supabase functions deploy chat-proxy --project-ref $SUPABASE_PROJECT_REF
```

## Project Structure

```
startup/
├── index.html                  # SPA frontend (auth + chat + search UI)
├── index.ts                    # Edge Function: hybrid search
├── chat_proxy.ts               # Edge Function: n8n chat proxy
├── deno.json                   # Deno config + tasks
│
├── 001_create_base_tables.sql  # Schema: suppliers, products, price_lists
├── 002_add_fulltext_search.sql # FTS: tsvector (Italian) + search functions
├── 003_add_vector_search.sql   # pgvector: embeddings + HNSW index
├── 004_add_rls_policies.sql    # RLS: read-only for all
├── 005_seed_data.sql           # Seed data
├── 006_fix_vector_schema.sql   # Vector schema fixes
├── 007_fix_all_search_functions.sql
├── 008_optimize_hybrid_search.sql  # UNION-based hybrid search (perf fix)
├── 009_fix_rls_policies.sql    # Admin-only write policies
├── 010_fix_hybrid_scoring.sql  # Min-max FTS normalization + similarity threshold
├── 011_create_customers_table.sql  # Customer profiles + auto-creation trigger
│
├── import_products.py          # ETL: JSON/Excel → Supabase
├── generate_embeddings.py      # Generate OpenAI embeddings for all products
│
├── tests/
│   ├── helpers.ts              # Extracted pure functions for testing
│   ├── search_test.ts          # 27 tests (search edge function)
│   ├── chat_proxy_test.ts      # 18 tests (chat proxy)
│   └── xss_test.ts             # 20 tests (XSS prevention)
│
├── docs/
│   ├── api.md                  # API reference (Edge Functions + RPC)
│   ├── architecture.md         # System architecture + data flows
│   ├── privacy.md              # GDPR + data protection
│   └── adr/                    # Architecture Decision Records
│
├── .github/workflows/ci.yml   # CI/CD: lint, test, deploy
├── .env.example                # Environment variable template
└── .gitignore
```

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `SUPABASE_URL` | Edge Functions (auto), Python scripts | Project API URL |
| `SUPABASE_ANON_KEY` | Edge Functions (auto) | Anon key (client-safe, RLS-gated) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions (auto), Python scripts | Service role key (server-only) |
| `OPENAI_API_KEY` | Edge Function secrets | OpenAI API key for embeddings |
| `N8N_WEBHOOK_URL` | Edge Function secrets | n8n chat webhook URL |

Set Edge Function secrets via:
```bash
supabase secrets set OPENAI_API_KEY=sk-... N8N_WEBHOOK_URL=https://...
```

## Development

```bash
# Install Deno (v2+)
# https://deno.land/manual/getting_started/installation

# Run tests
deno task test

# Lint
deno task lint

# Format
deno task fmt

# Format check (CI)
deno task fmt:check
```

## Database Schema

| Table | Rows | Description |
|-------|------|-------------|
| `products` | 9,189 | Product catalog with FTS vector + embedding |
| `suppliers` | 6 | DAC, MARR, DORECA, Bindi, Forno d'Asolo, Centrofarc |
| `price_lists` | 1+ | Import metadata with validity dates |
| `customers` | * | Customer profiles (auto-created on signup) |

### Search Indexes

- **GIN** on `fts_vector` — Italian full-text search
- **HNSW** on `embedding` — Vector cosine similarity (m=16, ef_construction=64)
- **GIN** on `description` — Trigram fuzzy matching
- **B-tree** on `supplier_id`, `price`, `supplier_code`

### RLS Policies

- **products, suppliers, price_lists**: Read by all, write by admin only (`app_metadata.role = 'admin'`)
- **customers**: Row-level isolation (own record), admin override

## API Endpoints

See [docs/api.md](docs/api.md) for complete API reference.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/functions/v1/search` | POST | JWT | Hybrid product search |
| `/functions/v1/chat-proxy` | POST | JWT | AI chat via n8n |

## Architecture

See [docs/architecture.md](docs/architecture.md) for diagrams and data flows.

**Key design decisions:**
- Hybrid search combines FTS + vector similarity with min-max normalization
- n8n webhook URL hidden behind server-side proxy (never exposed to client)
- Customer identity resolved server-side from JWT (never trusted from client)
- OpenAI embeddings generated via `text-embedding-3-small` (1536 dimensions)
- Rate limiting: 30 req/min per IP on search endpoint

## Documentation

- [API Reference](docs/api.md) — Edge Function endpoints, RPC functions, error codes
- [Architecture](docs/architecture.md) — System design, data flows, security model
- [Privacy & GDPR](docs/privacy.md) — Data processing, third-party processors, compliance
- [ADRs](docs/adr/) — Architecture Decision Records

## Grant Admin Access

```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
WHERE email = 'admin@example.com';
```
