# ADR-002: Server-Side Chat Proxy for n8n

**Status**: Accepted
**Date**: 2025-03-04

## Context

The AI chat agent runs as an n8n workflow triggered via webhook. Initially, the frontend called the n8n webhook URL directly, which created several security issues:

1. **URL exposure**: The n8n webhook URL was hardcoded in client-side JavaScript, allowing anyone to call it directly
2. **Identity spoofing**: Customer identity (name, hotel, company) was sent from the client, where it could be tampered with
3. **No authentication**: The n8n webhook had no JWT verification, allowing unauthenticated access

## Decision

Create a server-side Edge Function (`chat-proxy`) that:

1. Verifies the caller's JWT via Supabase Auth
2. Looks up the real customer identity from the `customers` table using the verified `auth_user_id`
3. Forwards the request to n8n with server-verified identity fields
4. Passes through the n8n response (including streaming NDJSON)

The n8n webhook URL is stored as an Edge Function secret (`N8N_WEBHOOK_URL`), never exposed to the client.

## Alternatives Considered

1. **n8n authentication header**: Add a shared secret to n8n webhook. Solves URL abuse but not identity spoofing — the client still provides its own identity.
2. **JWT verification in n8n**: Forward JWT to n8n and verify there. Complex to set up in n8n, creates tight coupling with Supabase Auth.
3. **Supabase Database Webhooks**: Trigger n8n via database changes instead of direct HTTP. Adds latency and doesn't fit the real-time chat pattern.

## Consequences

- **Positive**: n8n webhook URL is completely hidden from clients
- **Positive**: Customer identity is always server-verified, preventing spoofing
- **Positive**: Single authentication layer (Supabase JWT) for all endpoints
- **Positive**: Chat-proxy can add rate limiting, logging, and input validation
- **Negative**: Adds ~50ms latency per chat message (Edge Function overhead)
- **Negative**: Additional Edge Function to deploy and maintain
