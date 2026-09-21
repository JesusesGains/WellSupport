# Well Support

Private staff dashboard for the Well College Global website support chat.

## What it does

- Email/password sign-in only.
- No signup flow.
- A valid Supabase user is **not enough** to enter the dashboard: the user must also exist as an active row in `public.support_agents`.
- Reads `support_conversations` and `support_messages` through Supabase RLS.
- Receives new website chats and messages through Supabase Realtime.
- Sends staff replies as `sender_type = 'agent'` using the signed-in staff UUID.
- Allows staff to close and reopen conversations.
- Uses the same Well College Global visual tokens as the website support widget.
- Contains no service-role/secret key.

## Cloudflare Pages

Use:

- Build command: `npm run build`
- Build output directory: `dist`

The dashboard is preconfigured to the live **Well Website** Supabase project (`fmlrtcofnbqdotpvuaem`). These optional Cloudflare build variables can override the defaults:

```
VITE_SUPPORT_SUPABASE_URL=https://fmlrtcofnbqdotpvuaem.supabase.co
VITE_SUPPORT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_my0myBoo-Kdu4tMCOsdKiQ_l0uuIHpR
```

The publishable key is expected to be public browser configuration. Never add a Supabase secret/service-role key to this repository or to browser-accessible Cloudflare variables.

## Staff access

Create staff accounts in Supabase Authentication using an admin-controlled flow. Do not expose public signup for the support dashboard.

After the auth user exists, grant dashboard access by inserting its UUID into the support allowlist:

```sql
insert into public.support_agents (user_id, display_name, active)
values ('STAFF_AUTH_USER_UUID', 'Staff name', true);
```

To revoke dashboard access without deleting the auth account:

```sql
update public.support_agents
set active = false
where user_id = 'STAFF_AUTH_USER_UUID';
```

RLS in the WellWebsite `supabase/support_chat.sql` file is the security boundary. The dashboard performs an additional UI guard immediately after sign-in, but unauthorized users must still be denied by RLS.

## Shared backend contract

This dashboard expects the schema currently defined in:

`JesusesGains/WellWebsite/supabase/support_chat.sql`

Required tables:

- `public.support_agents`
- `public.support_conversations`
- `public.support_messages`

Realtime must include:

- `public.support_conversations`
- `public.support_messages`

The website and this dashboard point to the same **Well Website** Supabase project (`fmlrtcofnbqdotpvuaem`).

## Local preview

Set the two environment variables, then run:

```bash
npm run dev
```

The development server builds the static site and serves it at `http://localhost:5173`.

## Security notes

- No signup UI exists.
- No service-role key is used.
- Dynamic message and visitor content is rendered with `textContent`, not injected as HTML.
- Cloudflare security headers deny framing and limit browser network access to Supabase plus the pinned Supabase browser SDK CDN.
- The Supabase SDK URL is pinned to `@supabase/supabase-js@2.116.0`.
