# Well Support

Private staff dashboard for the Well College Global website support chat.

## What it does

- Email/password sign-in only.
- No signup flow.
- A valid Supabase user is **not enough** to enter the dashboard: the user must also exist as an active row in `public.support_agents`.
- Staff authentication is handled by same-origin Cloudflare Pages Functions; Supabase access/refresh tokens are stored only in Secure, HttpOnly, SameSite=Strict cookies.
- The browser does not receive a Supabase publishable key or Auth token.
- Every protected server request validates the Supabase Auth session and re-checks the active `support_agents` allowlist.
- Reads and writes `support_conversations` / `support_messages` server-side using the staff JWT so Supabase RLS remains an additional authorization boundary.
- Polls the same-origin staff API for near-realtime website chats without exposing Supabase Realtime credentials to browser JavaScript.
- Sends staff replies as `sender_type = 'agent'` using the verified signed-in staff UUID.
- Closing a chat permanently deletes that conversation and its cascade-deleted messages.
- Shows temporary visitor city/region/country, IP, timezone and browser language above the thread while that metadata is available.
- Marks the first staff open with “A staff member joined your conversation”.
- Visitor chats use ephemeral tokens rather than visitor Supabase Auth users.
- Uses the same Well College Global visual tokens as the website support widget.
- Contains no service-role/secret key.

## Cloudflare Pages

Use:

- Build command: `npm run build`
- Build output directory: `dist`

No Supabase key or staff Auth token is emitted into the browser build. The Pages Functions under `functions/api/staff/` are the backend-for-frontend security boundary and use the Supabase publishable project key only server-side together with the staff JWT. The publishable key is not a privileged secret; no service-role/secret key is used.

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
- The browser does not receive Supabase API keys or Auth tokens.
- Staff access/refresh tokens are Secure, HttpOnly, SameSite=Strict cookies.
- Every staff API endpoint checks same-origin mutation headers and validates active staff authorization server-side.
- No service-role/secret key is used.
- Dynamic message and visitor content is rendered with `textContent`, not injected as HTML.
- CSP allows scripts only from the dashboard origin, denies framing of the dashboard, denies objects/media/workers, and limits browser network calls to same-origin.
- Supabase RLS remains enabled as defense in depth even though the browser no longer talks directly to the Data API.


## Search and crawler policy

Well Support is an internal staff dashboard, not a marketing surface.

- `robots.txt` denies all crawlers.
- The page sends `noindex, nofollow, noarchive, nosnippet, noimageindex` directives.
- Global responses send matching `X-Robots-Tag` headers.
- `Content-Signal` opts out of search indexing, AI training, AI input, and reuse.
- The build security scan fails if the deny-all crawler controls are removed.
- No sitemap, canonical SEO metadata, structured SEO data, or public discovery metadata is published for this dashboard.

These directives prevent compliant search/AI crawlers from indexing the dashboard. Authentication and server-side authorization remain the security boundary; robots directives are not treated as access control.
