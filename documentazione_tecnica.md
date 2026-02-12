# Documentazione Tecnica Completa
## Catalogo Fornitori — Borgo Palace Hotel Sansepolcro

---

## 1. PANORAMICA DEL SISTEMA

Il sistema è un database PostgreSQL ospitato su **Supabase** che contiene il catalogo prodotti di 6 fornitori dell'hotel Borgo Palace di Sansepolcro. È progettato per essere interrogato da un agente AI che aiuta il personale dell'hotel a cercare prodotti, confrontare prezzi e gestire gli ordini.

**Dati di accesso:**

| Parametro | Valore |
|-----------|--------|
| Piattaforma | Supabase |
| Project ID | `wvlqjpmphfhkctupwvvd` |
| Region | `eu-west-1` (Irlanda) |
| API URL | `https://wvlqjpmphfhkctupwvvd.supabase.co` |
| Dashboard | [Link diretto](https://supabase.com/dashboard/project/wvlqjpmphfhkctupwvvd) |
| Database | PostgreSQL 17.6 |

**Numeri:**

| Dato | Valore |
|------|--------|
| Prodotti totali | 9.189 |
| Fornitori | 6 |
| Listino prezzi | 1 (valido dal 05/04/2025) |
| Embeddings generati | 9.189 / 9.189 (100%) |
| Prezzo medio | €15,52 |
| Range prezzi | €0,01 — €713,49 |

---

## 2. SCHEMA DATABASE

### 2.1 Diagramma delle relazioni

```
┌─────────────────┐
│   price_lists    │
│─────────────────│
│ id (PK, uuid)   │◄──────────────┐
│ hotel_name       │               │
│ price_valid_date │               │
│ import_date      │               │
│ source_file      │               │
│ notes            │               │
│ created_at       │               │
└─────────────────┘               │
                                   │ FK: price_list_id
┌─────────────────┐               │
│    suppliers     │               │
│─────────────────│               │
│ id (PK, uuid)   │◄────────┐    │
│ name (UNIQUE)    │         │    │
│ account_number   │         │    │
│ depot            │         │    │
│ telesales        │         │    │
│ created_at       │         │    │
└─────────────────┘         │    │
                             │    │
                    FK:      │    │
                supplier_id  │    │
                             │    │
┌────────────────────────────┴────┴──────────────┐
│                   products                      │
│────────────────────────────────────────────────│
│ id (PK, uuid)                                   │
│ price_list_id (FK → price_lists.id) NOT NULL     │
│ supplier_id (FK → suppliers.id) NOT NULL         │
│ supplier_code (text) NOT NULL                    │
│ description (text) NOT NULL                      │
│ selling_uom (text)                               │
│ pricing_uom (text)                               │
│ price (numeric 10,2)                             │
│ currency (text, default 'EUR')                   │
│ fts_vector (tsvector, GENERATED)   ← ricerca     │
│ embedding (vector 1536)            ← AI search   │
│ created_at (timestamptz)                         │
│                                                  │
│ UNIQUE(price_list_id, supplier_id, supplier_code)│
└──────────────────────────────────────────────────┘
```

### 2.2 Tabella: price_lists

Contiene i metadati di ogni importazione di listino. Oggi c'è un solo record, ma la struttura supporta lo storico: ogni volta che arriva un nuovo Excel con prezzi aggiornati, si crea un nuovo price_list e si importano i prodotti collegati a quello. Così si può confrontare come i prezzi cambiano nel tempo.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Chiave primaria |
| hotel_name | text | NO | — | Nome dell'hotel |
| price_valid_date | date | NO | — | Data di validità del listino |
| import_date | timestamptz | NO | now() | Quando è stato importato |
| source_file | text | SI | — | Nome del file Excel sorgente |
| notes | text | SI | — | Note libere |
| created_at | timestamptz | NO | now() | Timestamp creazione |

**Dato attuale:**
- ID: `00000000-0000-0000-0000-000000000001`
- Hotel: "Sansepolcro Borgo Palace Hotel"
- Data validità: 2025-04-05
- File: `Sansepolcro_Borgo_Palace_Hotel__2025_04_05.xlsx`

### 2.3 Tabella: suppliers

I 6 fornitori dell'hotel. Il campo `name` è UNIQUE — non possono esistere duplicati.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Chiave primaria |
| name | text | NO (UNIQUE) | — | Nome del fornitore |
| account_number | text | SI | — | Codice cliente presso il fornitore |
| depot | text | SI | — | Deposito / filiale di riferimento |
| telesales | text | SI | — | Contatto televendite |
| created_at | timestamptz | NO | now() | Timestamp creazione |

**Dati attuali:**

| ID (uuid) | Nome | Prodotti | Prezzo medio | Tipo merci |
|-----------|------|----------|-------------|------------|
| ...0001 | Bindi | 576 | €20,71 | Pasticceria, gelati, colazione |
| ...0002 | Centrofarc S.p.A. | 481 | €45,65 | Detergenti, cleaning |
| ...0003 | MARR SPA | 2.363 | €10,80 | Alimentari, surgelati |
| ...0004 | DORECA ITALIA S.P.A. | 959 | €16,63 | Bevande, spirits |
| ...0005 | DAC SPA | 4.308 | €12,35 | Vini, bevande, alimentari |
| ...0006 | Forno d'Asolo | 502 | €27,88 | Panificati, cornetteria |

### 2.4 Tabella: products

La tabella principale con 9.189 record. Ogni prodotto è collegato a un fornitore e a un listino prezzi. Ha due colonne speciali per la ricerca:

- **fts_vector**: generata automaticamente da PostgreSQL ogni volta che la `description` cambia. Non va mai popolata manualmente.
- **embedding**: vettore a 1.536 dimensioni generato da OpenAI `text-embedding-3-small`. Va popolato con lo script apposito.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | uuid | NO | gen_random_uuid() | Chiave primaria |
| price_list_id | uuid | NO | — | FK → price_lists.id |
| supplier_id | uuid | NO | — | FK → suppliers.id |
| supplier_code | text | NO | — | Codice articolo del fornitore (es. "640920") |
| description | text | NO | — | Descrizione prodotto (es. "PROSECCO SUP.DOCG TINTORET75cl") |
| selling_uom | text | SI | — | Unità di vendita (es. "CT da 6") |
| pricing_uom | text | SI | — | Unità di prezzo (es. "1 x 1 x 750.00 ml") |
| price | numeric(10,2) | SI | — | Prezzo in EUR |
| currency | text | NO | 'EUR' | Valuta |
| fts_vector | tsvector | SI | GENERATED | Autogenerato: `to_tsvector('italian', description)` |
| embedding | vector(1536) | SI | — | Embedding OpenAI per semantic search |
| created_at | timestamptz | NO | now() | Timestamp creazione |

**Vincolo di unicità:** `UNIQUE(price_list_id, supplier_id, supplier_code)` — lo stesso codice articolo dello stesso fornitore non può apparire due volte nello stesso listino.

**Nota sul campo pricing_uom:** contiene informazioni strutturate con il pattern `{casse} x {pezzi} x {quantità} {unità}`. Esempio: `"1 x 12 x 750.00 ml"` significa 1 cassa da 12 bottiglie da 750ml. In futuro potrebbe essere utile parsarlo in colonne separate.

---

## 3. INDICI

Gli indici accelerano le query. Senza di essi, PostgreSQL dovrebbe scansionare tutti i 9.189 record per ogni ricerca.

| Nome indice | Tabella | Tipo | Colonna/e | A cosa serve |
|-------------|---------|------|-----------|-------------|
| products_pkey | products | B-tree (UNIQUE) | id | Lookup per chiave primaria |
| products_price_list_id_supplier_id_supplier_code_key | products | B-tree (UNIQUE) | price_list_id, supplier_id, supplier_code | Vincolo unicità prodotto |
| idx_products_supplier | products | B-tree | supplier_id | Filtrare per fornitore |
| idx_products_price_list | products | B-tree | price_list_id | Filtrare per listino |
| idx_products_price | products | B-tree | price | Filtrare/ordinare per prezzo |
| idx_products_supplier_code | products | B-tree | supplier_code | Cercare per codice articolo |
| idx_products_description_trgm | products | GIN (trigrammi) | description | Fuzzy search (typo-tolerant) |
| idx_products_fts | products | GIN | fts_vector | Full-text search italiano |
| idx_products_embedding | products | HNSW | embedding | Semantic search (nearest neighbor) |
| suppliers_pkey | suppliers | B-tree (UNIQUE) | id | Lookup fornitore |
| suppliers_name_key | suppliers | B-tree (UNIQUE) | name | Unicità nome fornitore |
| price_lists_pkey | price_lists | B-tree (UNIQUE) | id | Lookup listino |

**Dettaglio indici speciali:**

- **GIN trigrammi** (`idx_products_description_trgm`): spezza ogni parola in sequenze di 3 caratteri. "PROSECCO" diventa "PRO", "ROS", "OSE", "SEC", "ECC", "CCO". Questo permette di trovare corrispondenze anche con errori di battitura.

- **GIN tsvector** (`idx_products_fts`): indice sulla colonna fts_vector che contiene i token italiani della descrizione. PostgreSQL usa il dizionario italiano per stemming (es. "biscotti" → "biscott") e rimozione stopword.

- **HNSW** (`idx_products_embedding`): Hierarchical Navigable Small World — algoritmo per trovare velocemente i vettori più vicini nello spazio a 1.536 dimensioni. Parametri: m=16 (connessioni per nodo), ef_construction=64 (precisione in costruzione). Ottimale per dataset < 100K record.

---

## 4. FUNZIONI DI RICERCA

Tutte le funzioni sono nello schema `public` e sono chiamabili via REST API di Supabase con `/rest/v1/rpc/nome_funzione`. Sono tutte `STABLE` (non modificano dati) e hanno `search_path = public, extensions`.

**Dove trovarle:** Supabase Dashboard → SQL Editor → oppure Database → Functions

### 4.1 search_products_fts — Full-Text Search Italiano

**Cosa fa:** Cerca prodotti per corrispondenza di parole nella descrizione, usando il dizionario italiano di PostgreSQL. Gestisce plurali, articoli e congiunzioni italiane.

**Quando usarla:** Quando l'utente cerca con parole che sa essere presenti nel catalogo. Es: "prosecco", "biscotti", "detersivo".

**Parametri:**

| Parametro | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| search_query | text | — (obbligatorio) | Testo da cercare |
| supplier_filter | uuid | NULL | Filtra per fornitore (NULL = tutti) |
| price_min | numeric | NULL | Prezzo minimo |
| price_max | numeric | NULL | Prezzo massimo |
| result_limit | int | 50 | Max risultati |

**Output restituito:**

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| id | uuid | ID prodotto |
| supplier_name | text | Nome fornitore (dalla JOIN) |
| supplier_code | text | Codice articolo |
| description | text | Descrizione prodotto |
| selling_uom | text | Unità di vendita |
| pricing_uom | text | Unità di prezzo |
| price | numeric | Prezzo |
| rank | real | Punteggio di rilevanza (più alto = più rilevante) |

**Come funziona internamente:**
1. Riceve il testo `search_query`
2. Lo converte in token con `websearch_to_tsquery('italian', ...)` — supporta operatori: `"vino rosso"` cerca entrambe le parole, `"vino OR birra"` cerca l'una o l'altra
3. Confronta i token con la colonna `fts_vector` di ogni prodotto usando l'operatore `@@`
4. L'indice GIN (`idx_products_fts`) rende questo confronto istantaneo
5. Applica i filtri opzionali (fornitore, prezzo)
6. Ordina per `ts_rank` e limita i risultati

**Esempio di chiamata SQL:**
```sql
SELECT * FROM search_products_fts('prosecco', NULL, 5, 20, 10);
-- Cerca "prosecco", tutti i fornitori, prezzo tra 5€ e 20€, max 10 risultati
```

**Esempio di chiamata REST API:**
```
POST /rest/v1/rpc/search_products_fts
{
  "search_query": "prosecco",
  "price_min": 5,
  "price_max": 20,
  "result_limit": 10
}
```

**Limiti:** Non trova nulla se le parole della query non esistono nelle descrizioni. "olio extravergine" non trova nulla perché il catalogo usa "OLIO EVO". Per questo esiste la fuzzy search e la semantic search.

---

### 4.2 search_products_fuzzy — Ricerca con tolleranza errori

**Cosa fa:** Cerca prodotti la cui descrizione è *simile* al testo cercato, anche con errori di battitura, lettere mancanti o abbreviazioni diverse. Usa l'algoritmo dei trigrammi (pg_trgm).

**Quando usarla:** Quando l'utente potrebbe fare typo o non conoscere la grafia esatta. Es: "proseco" (manca una C), "bizcotti" (z al posto di s).

**Parametri:**

| Parametro | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| search_query | text | — (obbligatorio) | Testo da cercare |
| similarity_threshold | real | 0.2 | Soglia minima di similarità (0-1, più alto = più preciso) |
| result_limit | int | 50 | Max risultati |

**Output restituito:** Stessa struttura della FTS, ma con `similarity` (real, 0-1) al posto di `rank`.

**Come funziona internamente:**
1. Spezza sia la query che ogni descrizione in trigrammi (sequenze di 3 caratteri)
2. Calcola quanti trigrammi hanno in comune → `similarity` score da 0 a 1
3. Filtra quelli sopra la soglia
4. L'indice GIN trigrammi (`idx_products_description_trgm`) accelera la ricerca
5. Ordina per similarità decrescente

**Esempio:**
```sql
SELECT * FROM search_products_fuzzy('proseco', 0.15, 5);
-- Trova: "IL ROGGIO PROSECCO" (sim 0.35), "KREVIS PROSECCO DOC 20 CL" (sim 0.26)...
```

**Limiti:** Non capisce il significato, solo la forma delle parole. "bollicine" non trova "prosecco" perché le lettere sono completamente diverse. È più lenta della FTS su grandi dataset perché deve calcolare la similarità per molte righe.

---

### 4.3 search_products_semantic — Ricerca per significato (AI)

**Cosa fa:** Trova prodotti il cui *significato* è vicino alla query, anche se le parole sono completamente diverse. Usa i vettori embedding generati da OpenAI.

**Quando usarla:** Quando la query è concettuale o in linguaggio naturale. Es: "qualcosa per la colazione", "vino per il pesce", "prodotti per pulire il bagno".

**Parametri:**

| Parametro | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| query_embedding | vector(1536) | — (obbligatorio) | Vettore embedding della query (generato da OpenAI) |
| supplier_filter | uuid | NULL | Filtra per fornitore |
| price_min | numeric | NULL | Prezzo minimo |
| price_max | numeric | NULL | Prezzo massimo |
| similarity_threshold | float | 0.5 | Soglia minima (0-1) |
| result_limit | int | 50 | Max risultati |

**Output restituito:** Stessa struttura, con `similarity` (float, 0-1) = distanza coseno invertita.

**Come funziona internamente:**
1. Riceve un vettore a 1.536 dimensioni (NON testo — il testo va prima convertito in vettore chiamando l'API OpenAI)
2. Calcola la distanza coseno (`<=>`) tra il vettore query e l'embedding di ogni prodotto
3. L'indice HNSW (`idx_products_embedding`) trova approssimativamente i vicini più prossimi senza scansionare tutti i 9.189 vettori
4. Filtra per soglia e parametri opzionali
5. Ordina per vicinanza

**ATTENZIONE — Richiede un passaggio extra:** Questa funzione NON accetta testo. L'input è un vettore. Per usarla, bisogna prima convertire la query testuale in un embedding chiamando l'API OpenAI:

```python
# Esempio Python
import openai
response = openai.embeddings.create(model="text-embedding-3-small", input="vino per il pesce")
query_vector = response.data[0].embedding  # lista di 1536 float
```

Poi si passa il vettore alla funzione. Questo è il motivo per cui serve una Edge Function intermediaria: l'agente AI manda il testo, la Edge Function lo converte in vettore e chiama la funzione.

---

### 4.4 search_products_hybrid — Ricerca combinata (FTS + Semantic)

**Cosa fa:** Combina full-text search e semantic search con pesi configurabili. Prende i risultati di entrambi i motori e li fonde in un unico ranking.

**Quando usarla:** Quando vuoi il meglio di entrambi i mondi: precisione delle parole (FTS) + comprensione del significato (semantic). È la funzione raccomandata per l'agente AI.

**Parametri:**

| Parametro | Tipo | Default | Descrizione |
|-----------|------|---------|-------------|
| search_text | text | — (obbligatorio) | Testo della query |
| query_embedding | vector(1536) | NULL | Embedding della query (opzionale) |
| supplier_filter | uuid | NULL | Filtra per fornitore |
| price_min | numeric | NULL | Prezzo minimo |
| price_max | numeric | NULL | Prezzo massimo |
| fts_weight | float | 0.4 | Peso della FTS nel ranking (0-1) |
| semantic_weight | float | 0.6 | Peso della semantic nel ranking (0-1) |
| result_limit | int | 50 | Max risultati |

**Output restituito:**

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| (colonne standard) | ... | id, supplier_name, description, price, ecc. |
| fts_rank | real | Punteggio full-text |
| semantic_similarity | float | Punteggio semantic |
| combined_score | float | Score combinato: `fts_rank × fts_weight + semantic_similarity × semantic_weight` |

**Come funziona internamente:**
1. Esegue la FTS sulla `description` per trovare corrispondenze di parole
2. Se `query_embedding` è fornito, calcola anche la distanza coseno sugli embeddings
3. Unisce i risultati (un prodotto può venire da FTS, da semantic, o da entrambi)
4. Calcola il `combined_score` pesato
5. Ordina per score combinato

**Se non hai l'embedding:** Puoi passare `NULL` come `query_embedding` — in quel caso funziona come una pura FTS (il semantic_similarity sarà 0 per tutti).

---

## 5. SICUREZZA (ROW LEVEL SECURITY)

RLS è abilitato su tutte e 3 le tabelle. Le policy controllano chi può fare cosa.

| Tabella | Policy | Operazione | Condizione | Chi può |
|---------|--------|-----------|------------|---------|
| price_lists | price_lists_read | SELECT | `true` | Tutti (incluso anon) |
| price_lists | price_lists_admin | ALL | `auth.role() = 'authenticated'` | Solo utenti autenticati |
| suppliers | suppliers_read | SELECT | `true` | Tutti |
| suppliers | suppliers_admin | ALL | `auth.role() = 'authenticated'` | Solo utenti autenticati |
| products | products_read | SELECT | `true` | Tutti |
| products | products_admin | ALL | `auth.role() = 'authenticated'` | Solo utenti autenticati |

**In pratica:**
- L'agente AI usa la **anon key** → può solo LEGGERE (SELECT) → sicuro
- L'admin usa la **service_role key** → può fare tutto (bypassa RLS) → solo per import/manutenzione
- La **service_role key** non va MAI esposta nel frontend o nell'agente

---

## 6. EDGE FUNCTIONS

Funzioni serverless che girano su Supabase (runtime Deno/TypeScript). Si trovano in: Dashboard → Edge Functions.

### 6.1 import-products

| Proprietà | Valore |
|-----------|--------|
| Slug | `import-products` |
| URL | `https://wvlqjpmphfhkctupwvvd.supabase.co/functions/v1/import-products` |
| Metodo | POST |
| JWT richiesto | No |
| Stato | ACTIVE |

**Cosa fa:** Riceve un array JSON di prodotti e li inserisce nel database in bulk.

**Quando usarla:** Per importare prodotti senza bisogno di accesso diretto al database.

**Input:**
```json
{
  "products": [
    {
      "price_list_id": "00000000-0000-0000-0000-000000000001",
      "supplier_id": "00000000-0000-0000-0001-000000000003",
      "supplier_code": "640920",
      "description": "PROSECCO SUP.DOCG TINTORET75cl",
      "selling_uom": "CT da 6",
      "pricing_uom": "1 x 1 x 750.00 ml",
      "price": 7.51
    }
  ]
}
```

**Output:** `{ "inserted": 500, "total_sent": 500 }`

### 6.2 generate-embeddings

| Proprietà | Valore |
|-----------|--------|
| Slug | `generate-embeddings` |
| URL | `https://wvlqjpmphfhkctupwvvd.supabase.co/functions/v1/generate-embeddings` |
| Metodo | POST |
| JWT richiesto | No |
| Stato | ACTIVE |

**Cosa fa:** Prende fino a 100 prodotti senza embedding, chiama OpenAI per generare i vettori, e li salva nel database. Va chiamata ripetutamente finché tutti i prodotti hanno l'embedding.

**Input:**
```json
{
  "openai_api_key": "sk-...",
  "limit": 100
}
```

**Output:** `{ "processed": 100, "remaining": 8500, "message": "Call again to continue" }`

**Testo inviato a OpenAI per ogni prodotto:** `"{supplier_code} {description}"` — es: `"640920 PROSECCO SUP.DOCG TINTORET75cl ( CT da 6 PZ. )"`

---

## 7. MIGRATIONS APPLICATE

Le migrations sono le modifiche incrementali allo schema del database. Vengono eseguite in ordine e sono irreversibili.

| # | Versione | Nome | Cosa fa |
|---|----------|------|---------|
| 1 | 20260210145610 | create_base_tables | Crea le 3 tabelle, indici B-tree e trigrammi, estensione pg_trgm |
| 2 | 20260210145626 | add_fulltext_search_italian | Aggiunge colonna fts_vector (GENERATED), indice GIN, funzioni FTS e fuzzy |
| 3 | 20260210145650 | add_vector_search | Aggiunge estensione pgvector, colonna embedding, indice HNSW, funzioni semantic e hybrid |
| 4 | 20260210145701 | add_rls_policies | Abilita RLS, crea policy read/admin su tutte le tabelle |
| 5 | 20260210150459 | fix_security_warnings | Fix search_path sulle funzioni, sposta estensioni nello schema extensions |
| 6 | 20260212112522 | fix_vector_schema | Riscrive le funzioni semantic e hybrid in plpgsql con search_path corretto |
| 7 | 20260212112609 | fix_all_search_functions | Riscrive FTS e fuzzy in plpgsql con search_path = public, extensions |

---

## 8. ESTENSIONI POSTGRESQL

| Estensione | Schema | Versione | Scopo |
|-----------|--------|----------|-------|
| pg_trgm | extensions | — | Trigrammi per fuzzy search |
| vector (pgvector) | extensions | — | Vettori e operatori per semantic search |

**Nota:** Le estensioni sono nello schema `extensions` (non `public`). Per questo tutte le funzioni hanno `SET search_path = public, extensions` — altrimenti non trovano gli operatori `<=>` (cosine distance) e `similarity()`.

---

## 9. SCRIPTS LOCALI

### 9.1 import_products.py

**Dove:** `scripts/import_products.py` nel repo GitHub

**Cosa fa:** Importa i prodotti nel database via REST API di Supabase, in batch da 500.

**Due modalità:**
1. **Da JSON** (default): legge `all_products.json` — non servono dipendenze extra oltre `requests`
2. **Da Excel**: parsa il file .xlsx originale — serve anche `pandas` e `openpyxl`

**Uso:**
```bash
pip install requests
export SUPABASE_SERVICE_KEY="eyJ..."
python import_products.py                              # da JSON
python import_products.py --from-excel file.xlsx       # da Excel
python import_products.py --dry-run                    # solo parsing, no insert
```

### 9.2 generate_embeddings.py

**Dove:** `scripts/generate_embeddings.py`

**Cosa fa:** Chiama la Edge Function `generate-embeddings` in loop finché tutti i prodotti hanno il loro embedding.

**Uso:**
```bash
pip install requests
export OPENAI_API_KEY="sk-..."
python generate_embeddings.py
```

**Costo:** ~$0.02 per 9.189 prodotti con text-embedding-3-small.

---

## 10. FILE NEL REPOSITORY GITHUB

```
startup/
├── README.md                                  ← Overview e quick start
├── .env.example                               ← Template variabili d'ambiente
├── .gitignore                                 ← Esclude .env, xlsx, json, __pycache__
│
├── supabase/migrations/
│   ├── 001_create_base_tables.sql             ← Tabelle + indici base
│   ├── 002_add_fulltext_search.sql            ← FTS italiano + fuzzy
│   ├── 003_add_vector_search.sql              ← pgvector + semantic + hybrid
│   ├── 004_add_rls_policies.sql               ← Sicurezza
│   └── 005_seed_data.sql                      ← Fornitori e price list iniziali
│
├── scripts/
│   └── import_products.py                     ← Import JSON/Excel → Supabase
│
├── edge-functions/
│   ├── import-products/index.ts               ← Bulk insert via API
│   └── search/index.ts                        ← Endpoint ricerca (da completare)
│
└── data/
    ├── .gitkeep
    └── all_products.json                      ← 9.189 prodotti pre-parsati
```

---

## 11. COME INTERROGARE IL DATABASE

### Via REST API (con anon key)

```bash
# Full-text search
curl -X POST 'https://wvlqjpmphfhkctupwvvd.supabase.co/rest/v1/rpc/search_products_fts' \
  -H 'apikey: TUA_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"search_query": "prosecco", "result_limit": 10}'

# Fuzzy search
curl -X POST '.../rpc/search_products_fuzzy' \
  -d '{"search_query": "proseco", "similarity_threshold": 0.15}'

# Query diretta su tabella
curl 'https://wvlqjpmphfhkctupwvvd.supabase.co/rest/v1/products?description=ilike.*prosecco*&limit=10' \
  -H 'apikey: TUA_ANON_KEY'

# Lista fornitori
curl 'https://wvlqjpmphfhkctupwvvd.supabase.co/rest/v1/suppliers' \
  -H 'apikey: TUA_ANON_KEY'
```

### Via MCP (per agenti AI che supportano Supabase MCP)

L'agente può connettersi direttamente ed eseguire query SQL:
```sql
SELECT * FROM search_products_fts('vino rosso', NULL, NULL, 20, 10);
```

---

## 12. PROSSIMI PASSI

| # | Task | Stato | Priorità |
|---|------|-------|----------|
| 1 | Schema database | ✅ Completato | — |
| 2 | Import 9.189 prodotti | ✅ Completato | — |
| 3 | Embeddings (9.189/9.189) | ✅ Completato | — |
| 4 | Fix funzioni ricerca | ✅ Completato | — |
| 5 | Edge Function search unificata | ⬜ Da fare | Alta |
| 6 | Collegare agente AI | ⬜ Da fare | Alta |
| 7 | Test con query reali | ⬜ Da fare | Media |
| 8 | Aggiornamento prezzi (nuovo Excel) | ⬜ Futuro | Bassa |
