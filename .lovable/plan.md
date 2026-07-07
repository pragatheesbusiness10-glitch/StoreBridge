# StoreBridge — MVP Build Plan

Agency-style SaaS to collect product submissions from clients and publish them to Shopify or WooCommerce. Slate + Emerald visual identity, left sidebar layout, shadcn/ui + Tailwind.

## Scope for this build (MVP)

The spec is large; I'll ship a working end-to-end MVP now and mark advanced items as follow-ups.

**In this build**
1. Lovable Cloud + Auth (email/password + Google), invite-only signups
2. Roles: `super_admin`, `agency_admin`, `client` (separate `user_roles` table + `has_role()` RPC)
3. Full schema: `profiles`, `clients`, `client_members`, `products`, `product_images`, `store_integrations`, `import_logs` — all RLS-locked with `GRANT`s
4. AES-GCM encryption for store credentials using a generated `INTEGRATION_ENCRYPTION_KEY` (server-only)
5. Sidebar shell with role-aware nav; dashboards for client & admin
6. Add Product form (all fields), multi-image upload to Supabase Storage, drag-reorder, delete
7. Product list with search / status / client / platform filters, bulk select
8. Product review page: edit, approve, reject (with notes), publish
9. Store integration settings (Shopify + Woo) with test-connection
10. Publishing via TanStack **server functions** (not Supabase Edge Functions — this stack uses server fns; same security model, secrets stay server-side) — `publishToShopify`, `publishToWooCommerce`, `testShopifyConnection`, `testWooConnection`, `generateExport` (CSV Shopify / CSV Woo / JSON)
11. Import/export logs page
12. Toast notifications, loading/empty/error states, Zod validation
13. Auth pages: `/auth` (sign in), `/accept-invite` (set password from invite token)
14. Client management page (super/agency admin can create clients + invite users)

**Follow-ups after MVP**
- Bulk CSV upload + column mapper (large feature; ship after core flow is stable)
- Image ZIP export
- Advanced dashboard charts
- Multi-agency isolation UI polish

## Tech notes (technical section)

- **Server layer:** This template is TanStack Start. Per project rules, app-internal server logic uses `createServerFn` with `requireSupabaseAuth`, not Supabase Edge Functions. The user's "Edge Functions" naming maps to server functions — same guarantee: secrets and API keys never reach the browser.
- **Encryption:** `INTEGRATION_ENCRYPTION_KEY` generated via `generate_secret` (64 chars). AES-256-GCM helper in `src/lib/crypto.server.ts`. Ciphertext stored as `{iv, ct, tag}` base64 in dedicated columns.
- **Storage:** bucket `product-images`, path `clients/{client_id}/products/{product_id}/{uuid}.ext`, RLS: client role can write to own client folder, admins full access, public read (needed for Shopify/Woo image ingestion).
- **First user:** invite-only. I'll seed via SQL: whoever first signs in becomes super_admin (one-time bootstrap trigger that self-disables once a super_admin exists).
- **Google OAuth:** wired through Lovable broker (`lovable.auth.signInWithOAuth("google")`) + `configure_social_auth`.

## Route map

```text
/auth                          public sign-in
/accept-invite                 public, set password
/_authenticated/
  index                        redirects by role
  dashboard                    client OR admin dashboard (role-aware)
  products                     list + filters + bulk
  products/new                 add product form
  products/$id                 edit / review (admin can approve/publish)
  integrations                 store integration settings
  logs                         import/export logs
  admin/clients                client management (admin only)
  admin/exports                bulk export (admin only)
```

## Database (all with GRANTs + RLS)

- `profiles(id=user_id, full_name, email, company_name, created_at)` — self read/update; admin read all
- `app_role` enum + `user_roles(user_id, role)` + `has_role()` SECURITY DEFINER
- `clients(id, agency_id, client_name, primary_contact_user_id, status, created_at)`
- `client_members(client_id, user_id)` — many-to-many, drives client RLS
- `products(...)` full spec; RLS: client sees own, admins see all in agency
- `product_images(product_id, image_url, sort_order, alt_text)`
- `store_integrations(client_id, platform, store_url, enc_access_token, enc_consumer_key, enc_consumer_secret, api_version, is_active)`
- `import_logs(...)` — write-only from server fns; admins read

## Deliverables checklist

- [ ] Enable Cloud, generate encryption key, configure Google
- [ ] Migration: enum, tables, GRANTs, RLS, bootstrap trigger, storage bucket + policies
- [ ] Design tokens (Slate + Emerald) in `src/styles.css`
- [ ] Auth attacher + `_authenticated` layout (managed) + role redirect
- [ ] Sidebar + shell + shared UI (StatCard, StatusBadge, EmptyState, DataTable)
- [ ] Client dashboard + Admin dashboard
- [ ] Add / Edit product with image uploader
- [ ] Product list + review flow (approve/reject/publish)
- [ ] Integrations page + test connection
- [ ] Server fns: publish (Shopify/Woo), test connection, generate CSV/JSON export
- [ ] Logs page
- [ ] Client management + invite

I'll build this in one continuous pass, verifying build + a quick Playwright smoke test at the end. Follow-ups (bulk CSV mapper, image ZIP) I'll call out when the MVP is done so you can prioritize.