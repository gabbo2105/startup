# 🏨 Catalogo Fornitori - Borgo Palace Hotel Sansepolcro

## Database Supabase + AI Search Agent

### 📋 TODO LIST

| # | Task | Stato | Note |
|---|------|-------|------|
| 1 | ✅ Design schema DB | ✅ Completato | 3 tabelle: `suppliers`, `products`, `price_lists` |
| 2 | ✅ Migration: tabelle base | ✅ Completato | Con indici trigram per fuzzy search |
| 3 | ✅ Migration: full-text search IT | ✅ Completato | tsvector generato + funzioni `search_products_fts`, `search_products_fuzzy` |
| 4 | ✅ Migration: vector search | ✅ Completato | pgvector + HNSW index + `search_products_semantic`, `search_products_hybrid` |
| 5 | ✅ Migration: RLS policies | ✅ Completato | Read-only per anon, full per authenticated |
| 6 | ⏳ ETL: import dati Excel | **DA FARE** | Script Python pronto → eseguire con service key |
| 7 | ⬜ Generare embeddings | Da fare | Richiede OpenAI API o altro provider |
| 8 | ⬜ Edge Function: search API | Da fare | Endpoint unico per l'agente AI |
| 9 | ⬜ Test con query reali | Da fare | Verificare search quality |
| 10 | ⬜ Documentazione GitHub | Parziale | Questo README + struttura sotto |

---

### 🚀 Quick Start: Importare i Dati

```bash
# 1. Installa dipendenza
pip install requests

# 2. Configura variabili d'ambiente
export SUPABASE_URL="https://wvlqjpmphfhkctupwvvd.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-role-key-here"
# ⚠️ Prendi la service_role key da: Supabase Dashboard > Settings > API

# 3. Lancia l'import (usa il JSON pre-generato in data/)
cd scripts
python import_products.py --json-file ../data/all_products.json

# Alternativa: import da Excel (richiede: pip install pandas openpyxl)
python import_products.py --from-excel ../data/Sansepolcro_Borgo_Palace_Hotel__2025_04_05.xlsx
```

---

### 📊 Schema Database

```
price_lists
├── id (uuid, PK)
├── hotel_name (text)
├── price_valid_date (date) → "2025-04-05"
├── source_file (text)
└── created_at

suppliers (6 record)
├── id (uuid, PK)
├── name (text, UNIQUE) → "MARR SPA", "Bindi"...
├── account_number (text)
├── depot (text)
└── created_at

products (9.189 record)
├── id (uuid, PK)
├── price_list_id (FK → price_lists)
├── supplier_id (FK → suppliers)
├── supplier_code (text) → "13350"
├── description (text) → "CHARDONNAY TASCA D'ALMERITA CL75"
├── selling_uom (text) → "CT da 6"
├── pricing_uom (text) → "1 x 1 x 750.00 ml"
├── price (numeric) → 33.52
├── fts_vector (tsvector, GENERATED) → full-text search italiano
├── embedding (vector(1536)) → per semantic search
└── created_at
```

**Fornitori importati:**
| Fornitore | Prodotti | Tipo |
|-----------|----------|------|
| DAC SPA | 4.308 | Vini, bevande, alimentari |
| MARR SPA | 2.363 | Alimentari, surgelati |
| DORECA ITALIA S.P.A. | 959 | Bevande, spirits |
| Bindi | 576 | Pasticceria, gelati, colazione |
| Forno d'Asolo | 502 | Panificati, cornetteria |
| Centrofarc S.p.A. | 481 | Detergenti, cleaning |

---

### 🔍 Come Funziona la Ricerca

Il database supporta **3 modalità di ricerca**, combinabili:

#### 1. Full-Text Search (Italiano)
```sql
SELECT * FROM search_products_fts('biscotti burro');
-- Trova: "BISCOTTI FROLLINI AL BURRO", "BISCOTTI CANTUCCI"...
```

#### 2. Fuzzy Search (per errori di battitura)
```sql
SELECT * FROM search_products_fuzzy('proseco', 0.15);
-- Trova: "PROSECCO..." anche con typo
```

#### 3. Semantic Search (con embeddings AI)
```sql
SELECT * FROM search_products_semantic(
  '[0.1, 0.2, ...]'::vector,  -- embedding della query
  NULL,  -- no supplier filter
  NULL, NULL,  -- no price filter
  0.5,   -- similarity threshold
  20     -- limit
);
```

#### 4. Hybrid Search (combina FTS + Semantic)
```sql
SELECT * FROM search_products_hybrid(
  'prodotti per colazione',     -- testo
  '[...]'::vector,              -- embedding
  NULL,                         -- supplier filter
  0, 50,                        -- price range
  0.4, 0.6,                     -- weights (fts, semantic)
  30                            -- limit
);
```

---

### 🤖 Connessione con Agente AI

L'agente AI può connettersi tramite:

1. **Supabase REST API** (più semplice)
   ```
   GET /rest/v1/rpc/search_products_fts?search_query=vino+rosso&result_limit=20
   ```

2. **Edge Function** (raccomandato per hybrid search)
   - L'agente invia la query in linguaggio naturale
   - L'Edge Function genera l'embedding, chiama la hybrid search
   - Ritorna risultati ranked

3. **MCP Server Supabase** (se l'agente supporta MCP)
   - Connessione diretta al DB via MCP
   - L'agente può fare query SQL direttamente

---

### 📁 Struttura Progetto

```
startup/
├── README.md
├── .env.example
├── .gitignore
│
├── supabase/
│   └── migrations/
│       ├── 001_create_base_tables.sql
│       ├── 002_add_fulltext_search.sql
│       ├── 003_add_vector_search.sql
│       ├── 004_add_rls_policies.sql
│       └── 005_seed_data.sql
│
├── scripts/
│   └── import_products.py         ← Script import JSON/Excel → Supabase
│
├── edge-functions/
│   ├── import-products/
│   │   └── index.ts
│   └── search/
│       └── index.ts               ← Endpoint ricerca per l'agente AI
│
└── data/
    ├── .gitkeep
    └── all_products.json          ← 9.189 prodotti pre-parsati
```

---

### 🛡️ Best Practices

#### Sicurezza
- ✅ RLS abilitato su tutte le tabelle
- ✅ Read-only per utenti anonimi (l'agente AI)
- ✅ Write solo per utenti autenticati (admin)
- ⚠️ **MAI** esporre la `service_role` key nel frontend o nell'agente
- 💡 Usa la `anon` key per l'agente AI (read-only è sufficiente)

#### Performance
- ✅ Indice GIN trigram per fuzzy search
- ✅ Indice GIN per full-text search
- ✅ Indice HNSW per vector search (~9K rows, perfetto)
- ✅ Indici B-tree su supplier_id, price, supplier_code

#### Data Quality
- Il campo `pricing_uom` contiene info strutturate: `"1 x 12 x 750.00 ml"`
  - Pattern: `{casse} x {pezzi_per_cassa} x {peso/volume_unitario} {unità}`
  - Potrebbe essere utile parsarli in colonne separate per filtri avanzati

#### Aggiornamento Prezzi
- Ogni import crea un nuovo `price_list` con data validità
- I prodotti sono legati al price_list → storico prezzi automatico
- Per aggiornare: caricare il nuovo Excel e rieseguire lo script

---

### 🔑 Credenziali Progetto

| Parametro | Valore |
|-----------|--------|
| Project ID | `wvlqjpmphfhkctupwvvd` |
| Region | `eu-west-1` |
| API URL | `https://wvlqjpmphfhkctupwvvd.supabase.co` |
| Anon Key | `eyJhbGciOi...` (vedi dashboard) |
| Dashboard | [Supabase Dashboard](https://supabase.com/dashboard/project/wvlqjpmphfhkctupwvvd) |

---

### 📝 Prossimi Passi

1. **Eseguire l'import** → `python import_products.py` (serve la service key)
2. **Generare embeddings** → Script con OpenAI `text-embedding-3-small`
3. **Creare Edge Function search** → Endpoint unificato per l'agente
4. **Configurare l'agente AI** → Collegamento via REST API o MCP
5. **Testare** → Query tipo: "vini rossi sotto 15€", "prodotti per colazione", "detergenti"
