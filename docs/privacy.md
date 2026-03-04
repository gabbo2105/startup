# Privacy & Data Protection

## Overview

Hotel Supply Pro processes personal data of hotel procurement staff to provide AI-powered product search across supplier catalogs. This document describes data flows, retention policies, and compliance considerations.

## Data Collected

### User Account Data
| Field | Purpose | Storage | Retention |
|-------|---------|---------|-----------|
| Email | Authentication | Supabase Auth (`auth.users`) | Until account deletion |
| Password | Authentication | Supabase Auth (bcrypt hash) | Until account deletion |
| Company name | Business identification | `customers` table | Until account deletion |
| VAT number | Business identification | `customers` table | Until account deletion |
| Hotel name | Context for AI agent | `customers` table | Until account deletion |
| Hotel address | Contact info | `customers` table | Until account deletion |
| Contact person | User identification | `customers` table | Until account deletion |
| Contact role | Business context | `customers` table | Until account deletion |
| Phone | Contact info | `customers` table | Until account deletion |

### Usage Data
| Data | Purpose | Storage | Retention |
|------|---------|---------|-----------|
| Search queries | Search functionality | Not persisted (edge function memory only) | Request duration |
| Chat messages | AI agent interaction | n8n workflow memory (session-scoped) | Session duration |
| Session IDs | Chat continuity | Client-generated UUID | Browser session |
| IP addresses | Rate limiting | Edge function memory (in-memory Map) | Until cold start / 1 min window |

## Third-Party Data Processors

### 1. Supabase (Infrastructure)
- **Role**: Data processor (hosting, auth, database)
- **Data processed**: All user data, product catalog
- **Location**: EU (eu-west-1, Ireland)
- **Compliance**: SOC 2 Type II, GDPR compliant
- **DPA**: Available at https://supabase.com/legal/dpa

### 2. OpenAI (Embedding Generation)
- **Role**: Data processor (text-to-vector conversion)
- **Data processed**: Search query text only (no PII)
- **What is NOT sent**: User identity, session data, customer information
- **Data retention**: OpenAI API does not retain data for training (as per API terms)
- **DPA**: Available at https://openai.com/policies/data-processing-addendum

### 3. n8n (AI Agent Orchestration)
- **Role**: Data processor (chat workflow execution)
- **Data processed**: Chat messages, customer name, hotel name, company name
- **Hosting**: Self-hosted or n8n Cloud (depending on deployment)
- **Note**: Customer identity is sent server-side via chat-proxy (never from client)
- **DPA**: Required if using n8n Cloud; self-hosted keeps data within your infrastructure

### 4. GitHub (CI/CD)
- **Role**: Data processor (code hosting, deployment pipeline)
- **Data processed**: Source code only (no user data)
- **DPA**: Available via GitHub Enterprise agreement

## Data Flow Diagram (Privacy Focus)

```
User (Browser)
  |
  | email, password, profile data
  v
Supabase Auth (EU) -----> customers table (EU)
  |                              |
  | JWT (no PII in payload)      | contact_person, hotel_name
  v                              | (read by chat-proxy only)
Edge Function: search            v
  |                        Edge Function: chat-proxy
  | query text only              |
  v                              | verified identity + chatInput
OpenAI API                       v
  (no PII sent)            n8n Webhook
                             (customer name + message)
```

## GDPR Compliance Measures

### Lawful Basis
- **Contractual necessity** (Art. 6(1)(b)): Processing user data is necessary to provide the procurement search service
- **Legitimate interest** (Art. 6(1)(f)): Rate limiting and logging for security purposes

### Data Subject Rights

| Right | Implementation |
|-------|---------------|
| **Access** (Art. 15) | User can view their profile in the app; admin can export via Supabase Dashboard |
| **Rectification** (Art. 16) | User can update their profile (customers table, own record via RLS) |
| **Erasure** (Art. 17) | Delete auth.users record triggers CASCADE delete of customers record |
| **Portability** (Art. 20) | Export customer data via Supabase API or Dashboard |
| **Restriction** (Art. 18) | Pause account via Supabase Auth (disable user) |
| **Objection** (Art. 21) | Contact data controller to opt out |

### Data Minimization
- Search queries are not logged or persisted
- Chat sessions are ephemeral (session-scoped in n8n)
- IP addresses are stored only in-memory for rate limiting (not persisted)
- OpenAI receives only the search query text, never user identity

### Security Measures
- All data encrypted in transit (TLS 1.2+)
- Database encrypted at rest (Supabase managed)
- Passwords hashed with bcrypt (Supabase Auth)
- Row Level Security enforces data isolation between customers
- JWT verification on all API endpoints
- Service role key never exposed to client
- n8n webhook URL hidden behind server-side proxy

## Recommendations (TODO)

1. **Cookie consent banner**: Add to index.html if analytics/tracking are added
2. **Privacy policy page**: Create a user-facing privacy policy linked from registration form
3. **DPA with n8n**: If using n8n Cloud, execute a Data Processing Agreement
4. **Data retention automation**: Implement scheduled cleanup of inactive accounts
5. **Audit logging**: Log admin actions (data exports, user management) for compliance
6. **Breach notification**: Define incident response procedure (Art. 33/34 GDPR)
