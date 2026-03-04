# ADR-003: RLS Admin Role via app_metadata

**Status**: Accepted
**Date**: 2025-03-04

## Context

The original RLS policies granted all authenticated users full INSERT/UPDATE/DELETE access to the product catalog:

```sql
CREATE POLICY "products_admin" ON products
  FOR ALL USING (auth.role() = 'authenticated');
```

This meant any registered buyer could delete the entire catalog.

## Decision

Restrict write operations to users with `app_metadata.role = 'admin'`:

```sql
CREATE POLICY "products_admin_write" ON products
  FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

Admin role is granted via:
```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
WHERE id = '<user-uuid>';
```

## Alternatives Considered

1. **Supabase custom claims via hook**: More structured but requires Supabase Pro plan and hook configuration.
2. **Separate admin table**: Join-based check in RLS policy. More flexible but adds complexity and potential performance impact on every query.
3. **Service role bypass only**: Remove write policies entirely, require service role key for all writes. Simpler but prevents admin UI features.

## Consequences

- **Positive**: Simple, built-in Supabase Auth mechanism
- **Positive**: `app_metadata` is included in JWT, no additional DB queries per request
- **Positive**: Cannot be modified by the user (unlike `user_metadata`)
- **Negative**: Admin role must be granted via SQL or Dashboard (no self-service)
- **Negative**: JWT must be refreshed after role change (user must re-login)
