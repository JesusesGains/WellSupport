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
- Marks the first staff open with “<staff display name> has joined your chat”.
- Visitor chats use ephemeral tokens rather than visitor Supabase Auth users.
- Uses the same Well College Global visual tokens as the website support widget.
- Contains no service-role/secret key.

## Cloudflare Pages

Use:

- Build command: `npm run build`
- Build output directory: `dist`

No Supabase key or staff Auth token is emitted into the browser build. The Pages Functions under `functions/api/staff/` are the backend-for-frontend security boundary and read their Supabase configuration from Cloudflare environment variables.


### Website analytics

The dashboard uses **Cloudflare Web Analytics / RUM as the source of truth for traffic metrics**. The authenticated `/api/staff/analytics` Pages Function queries Cloudflare's GraphQL Analytics API server-side, so the Cloudflare analytics token never reaches browser JavaScript.

Cloudflare supplies:

- visits
- page views
- pages per visit
- top pages
- countries
- referrers
- devices
- browsers
- operating systems
- daily traffic

The existing first-party Supabase analytics table remains for engagement data Cloudflare does not represent as application events, including:

- link/button clicks
- page-exit engagement duration
- UTM campaign attribution

Cloudflare Web Analytics must be enabled for the production website so `rumPageloadEventsAdaptiveGroups` receives browser RUM events. The API filters to `wellcollegeglobal.com` (or `CLOUDFLARE_ANALYTICS_HOST`) and excludes rows Cloudflare classifies as bots. The 90-day dashboard range is queried in smaller windows and merged server-side.

If the Cloudflare token/configuration is missing or Cloudflare is temporarily unavailable, the dashboard falls back to the existing first-party traffic summary rather than failing completely.

Configure the **WellSupport** Cloudflare Pages project with:

- `SUPABASE_URL` — Text
- `SUPABASE_PUBLISHABLE_KEY` — Text
- `CLOUDFLARE_ACCOUNT_ID` — Text; the Cloudflare account that owns the Well College Global Web Analytics site
- `CLOUDFLARE_ANALYTICS_TOKEN` — **Secret**; a Cloudflare API token scoped to that account with **Account Analytics: Read**
- `CLOUDFLARE_ANALYTICS_HOST` — Optional text; defaults to `wellcollegeglobal.com`
- `WELLWEBSITE_GITHUB_TOKEN` — **Secret, production environment only**

These values are available only to the server-side Pages Functions. The Supabase publishable key is not privileged; every data request still carries the verified staff JWT and remains constrained by RLS. No Supabase service-role/secret key is used.

The Web Editor uses `WELLWEBSITE_GITHUB_TOKEN` server-side to read/write only `JesusesGains/WellWebsite`. Use a fine-grained GitHub personal access token restricted to that one repository with **Contents: Read and write**. Do not expose it to browser code, commit it to either repository, or add it to Cloudflare preview environments. The production dashboard is the only environment that should receive this token.

Web Editor branch workflow:

1. `main` is production and powers `wellwebsite.pages.dev` / the public website.
2. `beta-main` is staging and powers `beta-main.wellwebsite.pages.dev`.
3. Staff edit and publish only to `beta-main`.
4. Staff review the Beta Preview.
5. The explicit Promote action merges `beta-main → main` and then fast-forwards `beta-main` to the resulting production commit.

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

Provide `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the local Pages Functions environment, then run:

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
