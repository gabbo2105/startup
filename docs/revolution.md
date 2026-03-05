# Revolution Plan — Hotel Supply Pro

Piano strategico per trasformare il prototipo in una demo investitori convincente.

---

## Contesto

Hotel Supply Pro e un prototipo/demo di piattaforma B2B per l'approvvigionamento F&B alberghiero ("Amazon per hotel"). Fondatore singolo + Claude Code, obiettivo: demo convincente per investitori. Revenue model da definire.

**Stato attuale**: SPA monolitica (1 file HTML, 1015 righe) + Supabase (Auth, PostgreSQL con pgvector, Edge Functions) + n8n cloud (AI agent GPT-4-turbo). ~9.000 prodotti reali da 6 fornitori italiani. 4 utenti registrati, nessun utente reale.

**Punti di forza da preservare**: hybrid search (FTS italiano + semantic + fuzzy), sistema di embedding, chat-proxy con identity verification server-side, CI/CD con GitHub Actions, 65 unit test.

---

## Decisioni Architetturali

### 1. Eliminare n8n — SI

n8n aggiunge costo, latenza (~500ms per hop), espone la service role key di Supabase in 4 nodi HTTP, non supporta streaming (enableStreaming: false), e un black box non versionabile in git.

**Sostituzione**: una Edge Function `ai-chat` che chiama direttamente OpenAI Chat Completions API con tool calling. Il system prompt e i tool esistenti si portano pari pari:
- `search_products` -> chiamata diretta alla RPC `search_products_hybrid` (stesso processo Deno, zero latency)
- `read_cart` -> query Supabase diretta
- `get_customer` -> query Supabase diretta (gia nel chat-proxy attuale)
- `send_email` -> Resend API (free tier 100 email/giorno) al posto di Gmail OAuth
- `calculator` -> GPT lo fa nativamente

**Benefici**: -500ms latenza, streaming vero, tutto in git, nessuna chiave esposta in terze parti, costo n8n cloud eliminato.

### 2. Tenere Supabase — SI

Supabase e la scelta giusta: PostgreSQL 17 con pgvector, pg_trgm, FTS italiano, Auth con JWT, Edge Functions, RLS, free tier generoso. Le alternative (Firebase, self-hosted) richiedono piu lavoro e non offrono vantaggi per questo stage.

### 3. Frontend: Next.js App Router + shadcn/ui + Tailwind

Il file HTML monolitico diventa un'app Next.js con:
- Server Components per catalogo (SSR, SEO-ready)
- Client Components per chat e carrello (interattivi)
- shadcn/ui per componenti accessibili out-of-the-box (risolve tutti i problemi WCAG)
- Tailwind con i colori esistenti (primary: `#d4802a`, dark mode preservato)
- Deploy su Vercel (free tier, zero DevOps)

### 4. Email: Resend al posto di Gmail/n8n

Free tier (100/giorno), API semplice, React Email per template, nessun OAuth.

---

## Sicurezza — Fix Prioritizzati

### P0: Prima di qualsiasi demo (1 giorno)

| # | Fix | File/Azione |
|---|-----|-------------|
| S1 | **Ruotare la service role key esposta** in n8n | Dashboard Supabase -> Settings -> API -> Rotate |
| S2 | **Aggiungere DOMPurify** a tutte le chiamate `marked.parse()` | `index.html:661,713,717` |
| S3 | **Validazione prezzi server-side** per ordini | Nuova Edge Function `create-order` o RPC |
| S4 | **Fix RLS policies aperte** (orders, order_items, cart_sessions con `WITH CHECK (true)`) | Nuova migration SQL |
| S5 | **Hashare o droppare** tabella `operator_passwords` | Migration SQL |
| S6 | **Abilitare leaked password protection** | Dashboard Supabase Auth |

### P1: Prima della demo investitori (settimana 1)

| # | Fix | File/Azione |
|---|-----|-------------|
| S7 | Fix 11 RLS policies con InitPlan (`auth.uid()` -> `(select auth.uid())`) | Migration SQL |
| S8 | Pinnare versioni CDN + aggiungere SRI hash | `index.html` script tags |
| S9 | Rate limiting su endpoint chat | Edge Function `ai-chat` |
| S10 | CORS restrittivo (da `*` a dominio specifico) | Edge Functions |

---

## UX/UI — Redesign per Demo Investitori

### Struttura pagine

```
/                    -> Landing page (value prop, CTA "Richiedi Demo")
/login               -> Auth (login/registrazione)
/catalog             -> Catalogo prodotti con categorie, filtri, barra di ricerca
/catalog/[category]  -> Pagina categoria
/product/[id]        -> Dettaglio prodotto con confronto fornitori
/cart                -> Carrello (pagina mobile, sidebar desktop)
/orders              -> Storico ordini
/orders/[id]         -> Dettaglio ordine
/chat                -> AI assistant (pagina mobile, pannello laterale desktop)
/account             -> Impostazioni profilo

# Admin Panel (protetto da role check)
/admin               -> Dashboard overview (KPI, ordini recenti, utenti attivi)
/admin/catalog       -> Gestione catalogo (CRUD prodotti, import listini)
/admin/suppliers     -> Gestione fornitori
/admin/categories    -> Gestione categorie
/admin/orders        -> Tutti gli ordini (filtra per stato, hotel, fornitore)
/admin/orders/[id]   -> Dettaglio ordine admin (cambia stato, note)
/admin/users         -> Utenti registrati e hotel
/admin/analytics     -> Analytics (ordini per periodo, top prodotti, top fornitori)
```

### Catalogo prodotti (pagina chiave per investitori)

I 9.189 prodotti attualmente non hanno categorie. Serve:
1. Creare tabella `categories` (~15-20 categorie: Bevande, Vini, Latticini, Carne, Pesce, etc.)
2. Script batch con GPT-4o-mini per classificare ogni prodotto (~$2 una tantum)
3. Aggiungere `category_id` a `products`
4. UI: griglia prodotti, filtri (fornitore, prezzo, categoria), ordinamento, barra di ricerca

### AI Chat

- Desktop: pannello collassabile a destra (stile Intercom)
- Mobile: pagina dedicata da tab bar
- Streaming vero (eliminando n8n)
- Contextual: sa cosa stai guardando nel catalogo

### Confronto fornitori

Pagina prodotto mostra prodotti simili da fornitori diversi affiancati (tabella comparativa prezzo/formato/fornitore).

### Admin Panel

Dashboard di gestione piattaforma, accessibile solo a utenti con `app_metadata.role = 'admin'` (pattern gia in uso, ADR-003). Protetto sia lato routing (middleware Next.js) che lato dati (RLS policies esistenti).

**Dashboard overview** (`/admin`):
- KPI cards: totale ordini, valore ordini, utenti registrati, prodotti a catalogo
- Grafico ordini ultimi 30 giorni
- Ordini recenti con stato
- Query SQL aggregate via `execute_sql` o viste materializzate

**Gestione catalogo** (`/admin/catalog`):
- Tabella prodotti con ricerca, filtri, paginazione (DataTable shadcn/ui)
- Import listini da Excel (drag & drop -> parse client-side -> upsert via Edge Function `import-products` esistente)
- Edit inline: modifica prezzo, descrizione, categoria
- Bulk actions: assegna categoria, disabilita prodotti
- Trigger ri-generazione embeddings dopo modifica

**Gestione fornitori** (`/admin/suppliers`):
- Lista fornitori con conteggio prodotti
- Aggiungi/modifica fornitore
- Visualizza listini associati

**Gestione ordini** (`/admin/orders`):
- Tutti gli ordini con filtri (stato, data, hotel, fornitore)
- Cambia stato ordine (pending -> confirmed -> shipped -> delivered)
- Esporta ordini CSV
- Dettaglio ordine con items, totali, dati cliente

**Gestione utenti** (`/admin/users`):
- Lista utenti con hotel, data registrazione, ultimo accesso
- Attiva/disattiva utente (`is_active` su customers)
- Visualizza ordini dell'utente

**Analytics** (`/admin/analytics`):
- Ordini per periodo (giorno/settimana/mese)
- Top 10 prodotti ordinati
- Top fornitori per valore ordini
- Valore medio ordine
- Implementato con query aggregate Supabase, grafici con Recharts (gia incluso in shadcn/ui charts)

---

## Evoluzione Data Model (multi-tenant)

### Fase 1 (per la demo): Shared Catalog, Per-Hotel Context

```sql
-- Nuova tabella
CREATE TABLE hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  billing_company text,
  billing_vat text,
  created_at timestamptz DEFAULT now()
);

-- Collegare customers a hotels
ALTER TABLE customers ADD COLUMN hotel_id uuid REFERENCES hotels(id);
```

Mostra che il modello supporta multi-tenancy senza costruire l'intera piattaforma.

### Fase 2 (post-investimento): Supplier-Hotel Relationships

```sql
-- Quali fornitori servono quali hotel
CREATE TABLE hotel_suppliers (
  hotel_id uuid REFERENCES hotels(id),
  supplier_id uuid REFERENCES suppliers(id),
  PRIMARY KEY (hotel_id, supplier_id),
  created_at timestamptz DEFAULT now()
);
```

Ogni hotel vede solo i fornitori contrattualizzati. Prezzi hotel-specifici possibili.

### Fase 3 (scale): True Marketplace

- Portale self-service fornitori per gestione catalogo
- Prezzi dinamici, sconti volume, promozioni
- Gestione gruppi hotel (catene alberghiere)
- Analytics dashboard per hotel e fornitori

---

## Roadmap per Fase

### Fase 0: Security Emergency (2-3 giorni)
Fix S1-S6 sulla codebase attuale (index.html). Nessun cambio architetturale.

### Fase 1: Eliminare n8n (1 settimana)
- Creare Edge Function `ai-chat` con OpenAI tool calling + streaming
- Creare Edge Function `create-order` con validazione prezzi server-side
- Configurare Resend per email
- Aggiornare frontend per chiamare nuovi endpoint
- Disattivare workflow n8n

### Fase 2: Migrazione Next.js + Catalogo (2-3 settimane)
- **Settimana 1**: Init Next.js, auth (con middleware role-check per admin), design system, categorizzazione prodotti, deploy Vercel
- **Settimana 2**: Catalogo sfogliabile, dettaglio prodotto, carrello, checkout con validazione server-side
- **Settimana 3**: Chat AI panel, storico ordini, landing page, polish responsive

### Fase 2.5: Admin Panel (1-1.5 settimane)
- **Giorni 1-3**: Layout admin (sidebar nav), dashboard overview con KPI, gestione ordini (lista + cambia stato)
- **Giorni 4-5**: Gestione catalogo (DataTable prodotti, edit inline, import Excel)
- **Giorni 6-7**: Gestione utenti/hotel, fornitori, analytics base (grafici Recharts)

### Fase 3: Demo Polish (1 settimana)
- Seed dati per 2-3 hotel demo (mostra multi-tenant)
- Script di demo guidato (include walkthrough admin panel)
- Empty/error/loading states professionali
- Analytics (Vercel Analytics o PostHog free)
- Review sicurezza finale

### Fase 4: Post-investimento (outline)
- Portale self-service fornitori
- Gestione gruppi hotel (catene)
- Sync inventario real-time
- App mobile (React Native)
- Analytics avanzati, recommendation engine
- Integrazione PMS hotel

---

## Stack Tecnologico Finale

| Layer | Attuale | Raccomandato |
|-------|---------|--------------|
| Frontend | Vanilla JS, 1 file HTML | Next.js 14+ App Router + shadcn/ui + Tailwind |
| Deploy frontend | (non chiaro) | Vercel (free tier) |
| Backend/DB | Supabase | Supabase (invariato) |
| AI | n8n + GPT-4-turbo | OpenAI API diretto da Edge Function (GPT-4o-mini) |
| Email | Gmail via n8n OAuth | Resend (free tier) |
| Search | Hybrid FTS + pgvector | Invariato (asset chiave) |
| Monitoring | Nessuno | Vercel Analytics + Sentry free |

**Costo mensile stimato (fase demo)**: ~$5-15/mese (solo OpenAI API usage)

---

## File Critici

- `index.html` — da decomporre in componenti Next.js; contiene tutta la logica UI/cart/chat
- `chat_proxy.ts` — base per la nuova `ai-chat` Edge Function; pattern JWT + customer lookup da riusare
- `index.ts` — pattern di riferimento (rate limiting, logging strutturato, retry, streaming)
- `010_fix_hybrid_scoring.sql` — la RPC `search_products_hybrid` e il core IP, da preservare
- `009_fix_rls_policies.sql` — pattern RLS da estendere per fix sicurezza

## Verifica

1. **Sicurezza**: Dopo fix P0, runnare `get_advisors` (security + performance) su Supabase — zero WARN critici
2. **n8n elimination**: Chat funzionante con streaming, ordini con prezzi validati server-side, email ricevuta
3. **Next.js**: Catalogo navigabile, ricerca funzionante, chat con streaming, ordine end-to-end, responsive su mobile
4. **Admin Panel**: Login come admin -> dashboard KPI corretti -> gestione ordini (cambia stato) -> import prodotti -> visualizza utenti -> analytics con grafici
5. **Demo**: Walkthrough completo: browse catalogo -> ricerca AI -> confronto fornitori -> aggiungi a carrello -> ordine -> email conferma -> admin vede ordine e cambia stato

---

## Cosa Dire agli Investitori

1. **"Abbiamo una piattaforma AI-powered con 9.000+ prodotti reali da 6 fornitori italiani."** — vero oggi.
2. **"La ricerca ibrida combina full-text, fuzzy e semantic AI search — capisce query in linguaggio naturale italiano."** — il vero moat tecnologico.
3. **"La piattaforma supporta sia navigazione catalogo tradizionale che procurement assistito da AI."** — Fase 2 lo realizza.
4. **"L'architettura e multi-tenant dal giorno uno — ogni hotel vede i propri fornitori e prezzi."** — Fase 1 data model lo abilita.
5. **"Costruito su PostgreSQL, Next.js e Supabase — infrastruttura scalabile con costo operativo minimo."** — nessuna dipendenza esotica.

## Revenue Model (da definire)

Opzioni supportate dall'architettura:
1. **Transaction fee** (2-5% per ordine) — naturale per marketplace, server-side order creation lo rende banale
2. **SaaS subscription per hotel** (tiered per volume ordini) — il modello multi-tenant lo supporta
3. **Supplier listing fee** — richiede portale self-service fornitori (Fase 4)
4. **Ibrido** (raccomandato): gratuito per hotel, fee transazionale + placement premium per fornitori — allineato con marketplace B2B food come Choco e Rekki
