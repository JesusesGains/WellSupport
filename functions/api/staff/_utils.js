const ACCESS_COOKIE = "__Host-well_support_access";
const REFRESH_COOKIE = "__Host-well_support_refresh";

function supabaseConfig(env) {
  const url = String(env?.SUPABASE_URL || env?.url || "").replace(/\/$/, "");
  const publishableKey = String(
    env?.SUPABASE_PUBLISHABLE_KEY || env?.publishableKey || ""
  );

  if (!url || !publishableKey) {
    const error = new Error("Well Support backend is not configured.");
    error.status = 503;
    throw error;
  }

  return { url, publishableKey };
}

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai",
    "Content-Signal": "search=no, ai-train=no, ai-input=no, use=no",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders
  });

  return new Response(JSON.stringify(data), { status, headers });
}

export function assertSameOrigin(request) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return null;
  }

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  const marker = request.headers.get("X-Well-Support-Request");

  if (origin && origin !== url.origin) {
    return json({ error: "Cross-origin request blocked." }, 403);
  }

  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return json({ error: "Cross-site request blocked." }, 403);
  }

  if (marker !== "1") {
    return json({ error: "Request verification failed." }, 403);
  }

  return null;
}

function parseCookies(request) {
  const raw = request.headers.get("Cookie") || "";
  const cookies = new Map();

  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookie values.
    }
  }

  return cookies;
}

function sessionCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookies() {
  return [
    sessionCookie(ACCESS_COOKIE, "", 0),
    sessionCookie(REFRESH_COOKIE, "", 0)
  ];
}

function authCookies(session) {
  const accessAge = Math.max(60, Number(session?.expires_in || 3600) - 30);

  return [
    sessionCookie(ACCESS_COOKIE, session.access_token, accessAge),
    sessionCookie(REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 30)
  ];
}

export function withCookies(response, cookies = []) {
  if (!cookies.length) return response;

  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function supabaseFetch(env, path, {
  accessToken,
  method = "GET",
  body,
  headers: extraHeaders = {}
} = {}) {
  const { url, publishableKey } = supabaseConfig(env);
  const headers = new Headers({
    apikey: publishableKey,
    ...extraHeaders
  });

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  if (
    body !== undefined &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof Uint8Array) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${url}${path}`, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : body instanceof ArrayBuffer || body instanceof Uint8Array
          ? body
          : typeof body === "string"
            ? body
            : JSON.stringify(body)
  });
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function authUser(env, accessToken) {
  if (!accessToken) return null;

  const response = await supabaseFetch(env, "/auth/v1/user", { accessToken });
  if (!response.ok) return null;

  return readJson(response);
}

async function refreshSession(env, refreshToken) {
  if (!refreshToken) return null;

  const response = await supabaseFetch(
    env,
    "/auth/v1/token?grant_type=refresh_token",
    {
      method: "POST",
      body: { refresh_token: refreshToken }
    }
  );

  if (!response.ok) return null;
  return readJson(response);
}

const STAFF_ROLE_PERMISSIONS = Object.freeze({
  support: ["support"],
  editor: ["support", "editor"],
  publisher: ["support", "editor", "publish"],
  admin: ["support", "editor", "publish", "admin"]
});

function normaliseStaffRole(value, fallback = "support") {
  const role = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STAFF_ROLE_PERMISSIONS, role)
    ? role
    : fallback;
}

function decorateStaffAgent(agent, fallbackRole = "support") {
  if (!agent) return null;
  const role = normaliseStaffRole(agent.role, fallbackRole);
  return {
    ...agent,
    role,
    permissions: [...STAFF_ROLE_PERMISSIONS[role]]
  };
}

async function staffAgent(env, accessToken, userId) {
  const makeQuery = (select) => new URLSearchParams({
    select,
    user_id: `eq.${userId}`,
    active: "eq.true",
    limit: "1"
  });

  // Prefer the role-aware schema. During the migration window only, fall back
  // to the legacy schema and preserve the old capability set so beta remains
  // operable until support_agents.role has been applied in Supabase.
  let response = await supabaseFetch(
    env,
    `/rest/v1/support_agents?${makeQuery("user_id,display_name,avatar_url,active,role").toString()}`,
    { accessToken }
  );

  let legacyRoleFallback = false;
  if (!response.ok && [400, 404].includes(response.status)) {
    legacyRoleFallback = true;
    response = await supabaseFetch(
      env,
      `/rest/v1/support_agents?${makeQuery("user_id,display_name,avatar_url,active").toString()}`,
      { accessToken }
    );
  }

  if (!response.ok) return null;

  const rows = await readJson(response);
  const agent = Array.isArray(rows) ? rows[0] || null : null;
  return decorateStaffAgent(agent, legacyRoleFallback ? "admin" : "support");
}

export function hasStaffPermission(session, permission) {
  return Boolean(
    session?.agent?.active &&
    Array.isArray(session.agent.permissions) &&
    session.agent.permissions.includes(String(permission || ""))
  );
}

export function requireStaffPermission(session, permission) {
  if (hasStaffPermission(session, permission)) return null;
  return sessionResponse(
    {
      error: "Your Well Support role does not allow this action.",
      code: "insufficient_role",
      requiredPermission: String(permission || "")
    },
    session,
    403
  );
}

async function supportSessionIsActive(env, accessToken) {
  const response = await supabaseFetch(
    env,
    "/rest/v1/rpc/verify_support_session",
    {
      accessToken,
      method: "POST",
      body: {}
    }
  );

  if (!response.ok) return false;
  return (await readJson(response)) === true;
}

export async function revokeCurrentSession(env, request) {
  const cookies = parseCookies(request);
  let accessToken = cookies.get(ACCESS_COOKIE) || "";
  const refreshToken = cookies.get(REFRESH_COOKIE) || "";

  try {
    if (!await authUser(env, accessToken) && refreshToken) {
      const refreshed = await refreshSession(env, refreshToken);
      accessToken = refreshed?.access_token || accessToken;
    }

    if (accessToken) {
      await supabaseFetch(env, "/auth/v1/logout?scope=local", {
        accessToken,
        method: "POST"
      });
    }
  } catch {
    // Cookies are cleared regardless; RLS also verifies auth.sessions.
  }
}

export async function requireStaff(env, request) {
  let config;

  try {
    config = supabaseConfig(env);
  } catch (error) {
    return {
      response: json(
        { error: "Well Support is temporarily unavailable." },
        error.status || 503
      )
    };
  }

  const cookies = parseCookies(request);
  let accessToken = cookies.get(ACCESS_COOKIE) || "";
  const refreshToken = cookies.get(REFRESH_COOKIE) || "";
  let user = await authUser(config, accessToken);
  let cookieHeaders = [];

  if (!user && refreshToken) {
    const refreshed = await refreshSession(config, refreshToken);

    if (refreshed?.access_token && refreshed?.refresh_token) {
      accessToken = refreshed.access_token;
      user = refreshed.user || await authUser(config, accessToken);
      cookieHeaders = authCookies(refreshed);
    }
  }

  if (!user || user.is_anonymous) {
    return {
      response: withCookies(
        json({ error: "Authentication required." }, 401),
        clearSessionCookies()
      )
    };
  }

  if (!await supportSessionIsActive(config, accessToken)) {
    return {
      response: withCookies(
        json({ error: "This staff session is no longer active." }, 401),
        clearSessionCookies()
      )
    };
  }

  const agent = await staffAgent(config, accessToken, user.id);

  if (!agent?.active) {
    return {
      response: withCookies(
        json({ error: "This account does not have Well Support access." }, 403),
        clearSessionCookies()
      )
    };
  }

  return {
    accessToken,
    user,
    agent,
    cookieHeaders,
    config
  };
}

export async function loginStaff(env, email, password) {
  let config;

  try {
    config = supabaseConfig(env);
  } catch (error) {
    return {
      response: json(
        { error: "Well Support is temporarily unavailable." },
        error.status || 503
      )
    };
  }

  const response = await supabaseFetch(
    config,
    "/auth/v1/token?grant_type=password",
    {
      method: "POST",
      body: { email, password }
    }
  );

  const payload = await readJson(response);

  if (!response.ok || !payload?.access_token || !payload?.user) {
    const rateLimited = response.status === 429;

    return {
      response: json(
        {
          error: rateLimited
            ? "Too many sign-in attempts. Try again later."
            : "Invalid email or password."
        },
        rateLimited ? 429 : 401
      )
    };
  }

  if (payload.user.is_anonymous) {
    await supabaseFetch(config, "/auth/v1/logout?scope=local", {
      accessToken: payload.access_token,
      method: "POST"
    }).catch(() => {});

    return {
      response: json(
        { error: "This account is not permitted to access support." },
        403
      )
    };
  }

  const agent = await staffAgent(
    config,
    payload.access_token,
    payload.user.id
  );

  if (!agent?.active) {
    await supabaseFetch(config, "/auth/v1/logout?scope=local", {
      accessToken: payload.access_token,
      method: "POST"
    }).catch(() => {});

    return {
      response: json(
        { error: "This account does not have Well Support access." },
        403
      )
    };
  }

  if (!await supportSessionIsActive(config, payload.access_token)) {
    await supabaseFetch(config, "/auth/v1/logout?scope=local", {
      accessToken: payload.access_token,
      method: "POST"
    }).catch(() => {});

    return {
      response: json(
        { error: "This staff session could not be verified." },
        401
      )
    };
  }

  return {
    user: payload.user,
    agent,
    cookies: authCookies(payload),
    config
  };
}

export async function recordEditorAudit(session, action, details = {}) {
  if (!session?.user?.id || !action) return false;

  try {
    await restJson("/rest/v1/support_editor_audit", session, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        actor_user_id: session.user.id,
        actor_display_name: String(session.agent?.display_name || "").slice(0, 120),
        action: String(action).slice(0, 80),
        details:
          details && typeof details === "object" && !Array.isArray(details)
            ? details
            : {}
      }
    });
    return true;
  } catch {
    // Audit storage is additive and must never turn a successful GitHub action
    // into a failed user action while the database migration is rolling out.
    return false;
  }
}

export async function restJson(path, session, options = {}) {
  const response = await supabaseFetch(session.config, path, {
    ...options,
    accessToken: session.accessToken
  });

  const payload = await readJson(response);

  if (!response.ok) {
    const error = new Error(
      payload?.message ||
      payload?.error_description ||
      payload?.error ||
      "Support request failed."
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function sessionResponse(data, session, status = 200) {
  return withCookies(
    json(data, status),
    session?.cookieHeaders || []
  );
}

function validImageSignature(bytes, mimeType) {
  const data = new Uint8Array(bytes);

  if (mimeType === "image/jpeg") {
    return (
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff
    );
  }

  if (mimeType === "image/png") {
    const signature = [
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a
    ];

    return (
      data.length >= signature.length &&
      signature.every((byte, index) => data[index] === byte)
    );
  }

  if (mimeType === "image/webp") {
    return (
      data.length >= 12 &&
      String.fromCharCode(...data.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...data.slice(8, 12)) === "WEBP"
    );
  }

  return false;
}

export function supportAvatarPrefix(session) {
  return (
    `${session.config.url}/storage/v1/object/public/support-avatars/` +
    `${session.user.id}/profile`
  );
}

export async function uploadAvatar(session, file) {
  if (!file) throw new Error("Profile photo is missing.");

  const allowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
  ]);

  if (!allowed.has(file.type)) {
    throw new Error("Use a JPG, PNG, or WebP profile photo.");
  }

  if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
    throw new Error("Profile photos must be 5 MB or smaller.");
  }

  const path = `${session.user.id}/profile`;
  const bytes = await file.arrayBuffer();

  if (!validImageSignature(bytes, file.type)) {
    throw new Error("The selected file is not a valid image.");
  }

  const response = await supabaseFetch(
    session.config,
    `/storage/v1/object/support-avatars/${encodeURIComponent(session.user.id)}/profile`,
    {
      accessToken: session.accessToken,
      method: "POST",
      body: bytes,
      headers: {
        "Content-Type": file.type,
        "x-upsert": "true",
        "Cache-Control": "3600"
      }
    }
  );

  if (!response.ok) {
    const payload = await readJson(response);
    throw new Error(
      payload?.message ||
      payload?.error ||
      "Profile photo upload failed."
    );
  }

  return `${session.config.url}/storage/v1/object/public/support-avatars/${path}?v=${Date.now()}`;
}

export async function deleteAvatar(session) {
  const response = await supabaseFetch(
    session.config,
    `/storage/v1/object/support-avatars/${encodeURIComponent(session.user.id)}/profile`,
    {
      accessToken: session.accessToken,
      method: "DELETE"
    }
  );

  if (!response.ok && response.status !== 404) {
    const payload = await readJson(response);
    throw new Error(
      payload?.message ||
      payload?.error ||
      "Profile photo removal failed."
    );
  }
}
