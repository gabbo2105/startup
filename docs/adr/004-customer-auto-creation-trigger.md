# ADR-004: Customer Auto-Creation via Database Trigger

**Status**: Accepted
**Date**: 2025-03-04

## Context

When a user registers, their business profile data (company name, VAT, hotel info, contact person) is passed as `user_metadata` in the `signUp()` call. This data needs to be stored in a `customers` table that the application and AI agent can query.

## Decision

Use a PostgreSQL trigger on `auth.users` to automatically create a `customers` record on signup:

```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

The `handle_new_user()` function extracts fields from `raw_user_meta_data` and inserts into `customers` with `SECURITY DEFINER` to bypass RLS.

## Alternatives Considered

1. **Client-side INSERT after signup**: User creates their own customer record after authentication. Vulnerable to race conditions, requires extra client-side logic, and user might not complete the second step.
2. **Edge Function webhook on auth event**: Listen to Supabase Auth webhooks. More complex, introduces external dependency, and adds latency.
3. **Supabase Auth hook (pre-signup)**: Newer Supabase feature. More structured but requires Pro plan and is still in beta.

## Consequences

- **Positive**: Atomic — customer record is always created with the auth user
- **Positive**: No client-side coordination needed
- **Positive**: Works regardless of how the user is created (API, Dashboard, etc.)
- **Negative**: `SECURITY DEFINER` function bypasses RLS (necessary but requires careful review)
- **Negative**: If the trigger fails, signup still succeeds but customer record is missing
- **Negative**: Tight coupling between auth.users metadata schema and customers table
