# API Reference

## Edge Functions

All Edge Functions are deployed at `https://<project-ref>.supabase.co/functions/v1/`.

### Authentication

All endpoints require a valid Supabase JWT in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Obtain a token via `supabase.auth.signInWithPassword()` or `supabase.auth.signUp()`.

---

## POST `/functions/v1/search`

Hybrid product search combining full-text search (Italian) with semantic vector similarity.

### Request

```json
{
  "query": "prodotti per la colazione",
  "supplier": "MARR SPA",
  "price_min": 5,
  "price_max": 50,
  "limit": 20,
  "fts_weight": 0.4,
  "semantic_weight": 0.6,
  "stream": false
}
```

| Field             | Type    | Required | Default | Description                                      |
|-------------------|---------|----------|---------|--------------------------------------------------|
| `query`           | string  | Yes      | -       | Natural language search query (max 500 chars)    |
| `supplier`        | string  | No       | null    | Filter by supplier name (fuzzy ILIKE match)      |
| `price_min`       | number  | No       | null    | Minimum price filter (EUR)                       |
| `price_max`       | number  | No       | null    | Maximum price filter (EUR)                       |
| `limit`           | integer | No       | 20      | Max results to return (1-100)                    |
| `fts_weight`      | float   | No       | 0.4     | Weight for full-text search score (0.0-1.0)      |
| `semantic_weight` | float   | No       | 0.6     | Weight for semantic similarity score (0.0-1.0)   |
| `stream`          | boolean | No       | false   | Enable NDJSON streaming response                 |

### Response (standard)

```json
{
  "query": "prodotti per la colazione",
  "count": 15,
  "results": [
    {
      "id": "uuid",
      "supplier_name": "Bindi",
      "supplier_code": "12345",
      "description": "CORNETTO CLASSICO VUOTO 90GR",
      "selling_uom": "CT da 44",
      "pricing_uom": "1 x 44 x 90.00 g",
      "price": 28.50,
      "fts_rank": 0.075,
      "semantic_similarity": 0.82,
      "combined_score": 0.72
    }
  ]
}
```

### Response (streaming, `stream: true`)

Content-Type: `application/x-ndjson`

Each line is a JSON object separated by `\n`:

```jsonl
{"type":"metadata","query":"prodotti per la colazione","count":15}
{"type":"result","data":{"id":"uuid","supplier_name":"Bindi",...}}
{"type":"result","data":{"id":"uuid","supplier_name":"MARR SPA",...}}
{"type":"done","count":15}
```

### Error Responses

| Status | Body                                                  | Cause                        |
|--------|-------------------------------------------------------|------------------------------|
| 400    | `{"error":"Provide a non-empty string 'query' field"}`| Missing or empty query       |
| 400    | `{"error":"'query' must be 500 characters or fewer"}` | Query too long               |
| 400    | `{"error":"'price_min' must be a number"}`            | Invalid price filter         |
| 401    | `{"error":"Unauthorized"}`                            | Missing/invalid JWT          |
| 405    | `{"error":"POST only"}`                               | Wrong HTTP method            |
| 429    | `{"error":"Too many requests. Try again later."}`     | Rate limit exceeded (30/min) |
| 500    | `{"error":"Server misconfiguration"}`                 | Missing OPENAI_API_KEY       |
| 502    | `{"error":"Failed to generate embedding"}`            | OpenAI API failure           |

### Rate Limiting

30 requests per minute per IP address. Returns `429` with `Retry-After: 60` header when exceeded.

### How It Works

1. Validates JWT via Supabase Auth
2. Generates embedding via OpenAI `text-embedding-3-small` (1536 dimensions)
3. Optionally resolves supplier name to UUID via ILIKE match
4. Calls `search_products_hybrid` RPC with both text query and embedding
5. Returns ranked results with combined FTS + semantic scores

---

## POST `/functions/v1/chat-proxy`

Server-side proxy for the n8n AI chat agent. Verifies identity server-side and forwards to n8n webhook.

### Request

```json
{
  "chatInput": "Che prosecco avete?",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "stream": true
}
```

| Field       | Type    | Required | Default | Description                                    |
|-------------|---------|----------|---------|------------------------------------------------|
| `chatInput` | string  | Yes      | -       | User message (max 2000 chars)                  |
| `sessionId` | string  | Yes      | -       | Chat session identifier                        |
| `stream`    | boolean | No       | false   | Request streaming response from n8n            |

### Response

The response format depends on the n8n workflow configuration. The proxy passes through the upstream response as-is.

- **Streaming**: `Content-Type: application/x-ndjson` or `text/event-stream`
- **Standard**: `Content-Type: application/json`

### Error Responses

| Status | Body                                                          | Cause                          |
|--------|---------------------------------------------------------------|--------------------------------|
| 400    | `{"error":"Request body must be valid JSON"}`                 | Malformed JSON body            |
| 400    | `{"error":"'chatInput' must be a non-empty string"}`          | Missing/empty chatInput        |
| 400    | `{"error":"'chatInput' exceeds the maximum length of 2000 characters"}` | Message too long     |
| 400    | `{"error":"'sessionId' is required"}`                         | Missing sessionId              |
| 401    | `{"error":"Missing or invalid Authorization header"}`         | No Bearer token                |
| 401    | `{"error":"Unauthorized"}`                                    | Invalid JWT                    |
| 403    | `{"error":"Customer profile not found"}`                      | No customer record for user    |
| 405    | `{"error":"POST only"}`                                       | Wrong HTTP method              |
| 500    | `{"error":"Server configuration error"}`                      | Missing env vars               |
| 500    | `{"error":"Upstream service not configured"}`                 | Missing N8N_WEBHOOK_URL        |
| 502    | `{"error":"Failed to reach upstream service"}`                | n8n unreachable                |
| 502    | `{"error":"Upstream service returned an error"}`              | n8n returned non-2xx           |

### Identity Resolution

The proxy **never trusts client-provided identity**. It:
1. Verifies the JWT to get the authenticated `user.id`
2. Looks up the customer record from `customers` table using `auth_user_id`
3. Sends server-verified `customerId`, `customerName`, `hotelName`, `companyName` to n8n

---

## Database RPC Functions

These functions are called internally by the Edge Functions but can also be invoked directly via `supabase.rpc()`.

### `search_products_hybrid`

Combined full-text + semantic vector search with min-max normalization.

```sql
search_products_hybrid(
  search_text text,
  query_embedding vector(1536) DEFAULT NULL,
  supplier_filter uuid DEFAULT NULL,
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  fts_weight float DEFAULT 0.4,
  semantic_weight float DEFAULT 0.6,
  result_limit int DEFAULT 50
)
```

**Returns**: `TABLE(id, supplier_name, supplier_code, description, selling_uom, pricing_uom, price, fts_rank, semantic_similarity, combined_score)`

**Scoring**: FTS rank is normalized to 0-1 via `rank / MAX(rank)` window function before combining with cosine similarity. A 0.3 similarity threshold filters low-relevance semantic matches.

### `search_products_fts`

Italian full-text search using `websearch_to_tsquery('italian', ...)`.

```sql
search_products_fts(
  search_query text,
  supplier_filter uuid DEFAULT NULL,
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  result_limit int DEFAULT 50
)
```

**Returns**: `TABLE(id, supplier_name, supplier_code, description, selling_uom, pricing_uom, price, rank)`

### `search_products_semantic`

Pure vector similarity search using pgvector cosine distance.

```sql
search_products_semantic(
  query_embedding vector(1536),
  supplier_filter uuid DEFAULT NULL,
  price_min numeric DEFAULT NULL,
  price_max numeric DEFAULT NULL,
  similarity_threshold float DEFAULT 0.5,
  result_limit int DEFAULT 50
)
```

**Returns**: `TABLE(id, supplier_name, supplier_code, description, selling_uom, pricing_uom, price, similarity)`

### `search_products_fuzzy`

Trigram-based fuzzy search for typo tolerance.

```sql
search_products_fuzzy(
  search_query text,
  similarity_threshold real DEFAULT 0.2,
  result_limit int DEFAULT 50
)
```

**Returns**: `TABLE(id, supplier_name, supplier_code, description, selling_uom, pricing_uom, price, similarity)`

---

## Database Schema

### Tables

| Table        | Description                           | RLS  |
|--------------|---------------------------------------|------|
| `products`   | 9,189 supplier products with prices   | Read: all, Write: admin only |
| `suppliers`  | 6 supplier companies                  | Read: all, Write: admin only |
| `price_lists`| Import metadata with validity dates   | Read: all, Write: admin only |
| `customers`  | Customer profiles linked to auth      | Own record + admin           |

### Key Indexes

| Index                           | Type | Column/Expression          |
|---------------------------------|------|----------------------------|
| `idx_products_fts`              | GIN  | `fts_vector`               |
| `idx_products_embedding`        | HNSW | `embedding vector_cosine_ops` (m=16, ef_construction=64) |
| `idx_products_description_trgm` | GIN  | `description gin_trgm_ops` |
| `idx_products_supplier`         | B-tree | `supplier_id`            |
| `idx_products_price`            | B-tree | `price`                  |

### Extensions

| Extension  | Purpose                          |
|------------|----------------------------------|
| `pgvector` | Vector embeddings + HNSW search  |
| `pg_trgm`  | Trigram similarity for fuzzy search |
