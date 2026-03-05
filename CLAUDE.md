# Hotel Supply Pro

Piattaforma B2B per approvvigionamento F&B alberghiero ("Amazon per hotel").
Stage: prototipo/demo. Obiettivo: demo convincente per investitori.
Fondatore singolo + Claude Code.

## Stack Attuale

- **Frontend**: SPA monolitica `index.html` (~1015 righe, vanilla JS) — da migrare a Next.js
- **Backend**: Supabase (PostgreSQL 17, Auth, Edge Functions Deno/TS, pgvector, RLS)
- **AI Agent**: n8n cloud con GPT-4-turbo — da eliminare, sostituire con Edge Function diretta
- **Progetto Supabase**: `wvlqjpmphfhkctupwvvd` (eu-west-1)
- **n8n workflow**: `GFngvxCBWNVXu5BCBWnzx` (da dismettere)

## Piano "Revolution" (vedi `docs/revolution.md` per dettagli)

### Decisioni chiave
1. **Eliminare n8n** → Edge Function `ai-chat` con OpenAI tool calling diretto
2. **Tenere Supabase** — scelta giusta per stage e team
3. **Migrare a Next.js App Router** + shadcn/ui + Tailwind, deploy su Vercel
4. **Resend** al posto di Gmail/n8n per email

### Roadmap
- **Fase 0** (2-3gg): Fix sicurezza urgenti (XSS, RLS, prezzi server-side)
- **Fase 1** (1 sett): Eliminare n8n, ordini server-side, Resend
- **Fase 2** (2-3 sett): Migrazione Next.js + catalogo sfogliabile
- **Fase 2.5** (1-1.5 sett): Admin panel (dashboard, catalogo, ordini, utenti, analytics)
- **Fase 3** (1 sett): Polish per demo investitori

## Asset Chiave da Preservare

- `search_products_hybrid` RPC (FTS italiano + pgvector semantic + fuzzy) — il core IP
- System prompt AI agent (in `docs/revolution.md` e nel workflow n8n) — domain knowledge
- Pattern Edge Functions: rate limiting, logging strutturato, retry, streaming (`index.ts`)
- CI/CD GitHub Actions, 65 unit test, 4 ADR

## File Principali

| File | Ruolo |
|------|-------|
| `index.html` | Frontend SPA (da decomporre in Next.js) |
| `index.ts` | Edge Function search (pattern di riferimento) |
| `chat_proxy.ts` | Edge Function chat proxy (base per `ai-chat`) |
| `0*.sql` | 11 migration files (schema DB) |
| `docs/revolution.md` | Piano strategico dettagliato |
| `docs/adr/` | 4 Architecture Decision Records |

## Convenzioni

- Lingua app: Italiano
- Valuta: EUR
- DB naming: snake_case
- Edge Functions: TypeScript strict, Deno runtime
- RLS: `(select auth.uid())` pattern (NON `auth.uid()` diretto)
- Admin role: `app_metadata.role = 'admin'` (ADR-003)
