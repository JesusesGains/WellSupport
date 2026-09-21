const SUPABASE_URL = "https://fmlrtcofnbqdotpvuaem.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_my0myBoo-Kdu4tMCOsdKiQ_l0uuIHpR";

const ACCESS_COOKIE = "__Host-well_support_access";
const REFRESH_COOKIE = "__Host-well_support_refresh";

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
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
    cookies.set(key, decodeURIComponent(value));
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

async function supabaseFetch(path, {
  accessToken,
  method = "GET",
  body,
  headers: extraHeaders = {}
} = {}) {
  const headers = new Headers({
    apikey: SUPABASE_PUBLISHABLE_KEY,
    ...extraHeaders
  });

  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  if (
    body !== undefined &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof Uint8Array) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${SUPABASE_URL}${path}`, {
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

async function authUser(accessToken) {
  if (!accessToken) return null;
  const response = await supabaseFetch("/auth/v1/user", { accessToken });
  if (!response.ok) return null;
  return readJson(response);
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return null;

  const response = await supabaseFetch("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: refreshToken }
  });

  if (!response.ok) return null;
  return readJson(response);
}

async function staffAgent(accessToken, userId) {
  const query = new URLSearchParams({
    select: "user_id,display_name,avatar_url,active",
    user_id: `eq.${userId}`,
    active: "eq.true",
    limit: "1"
  });

  const response = await supabaseFetch(
    `/rest/v1/support_agents?${query.toString()}`,
    { accessToken }
  );

  if (!response.ok) return null;
  const rows = await readJson(response);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function supportSessionIsActive(accessToken) {
  const response = await supabaseFetch(
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

export async function revokeCurrentSession(request) {
  const cookies = parseCookies(request);
  const accessToken = cookies.get(ACCESS_COOKIE) || "";

  if (!accessToken) return;

  try {
    await supabaseFetch("/auth/v1/logout?scope=local", {
      accessToken,
      method: "POST"
    });
  } catch {
    // Cookies are cleared even if the upstream revoke request is unavailable.
  }
}

export async function requireStaff(request) {
  const cookies = parseCookies(request);
  let accessToken = cookies.get(ACCESS_COOKIE) || "";
  const refreshToken = cookies.get(REFRESH_COOKIE) || "";
  let user = await authUser(accessToken);
  let cookieHeaders = [];

  if (!user && refreshToken) {
    const refreshed = await refreshSession(refreshToken);

    if (refreshed?.access_token && refreshed?.refresh_token) {
      accessToken = refreshed.access_token;
      user = refreshed.user || await authUser(accessToken);
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

  if (!await supportSessionIsActive(accessToken)) {
    return {
      response: withCookies(
        json({ error: "This staff session is no longer active." }, 401),
        clearSessionCookies()
      )
    };
  }

  const agent = await staffAgent(accessToken, user.id);

  if (!agent?.active) {
    return {
      response: withCookies(
        json({ error: "This account does not have Well Support access." }, 403),
        clearSessionCookies()
      )
    };
  }

  return { accessToken, user, agent, cookieHeaders };
}

export async function loginStaff(email, password) {
  const response = await supabaseFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password }
  });

  const payload = await readJson(response);

  if (!response.ok || !payload?.access_token || !payload?.user) {
    return {
      response: json(
        { error: payload?.msg || payload?.message || "Invalid email or password." },
        response.status === 429 ? 429 : 401
      )
    };
  }

  if (payload.user.is_anonymous) {
    return {
      response: json({ error: "This account is not permitted to access support." }, 403)
    };
  }

  const agent = await staffAgent(payload.access_token, payload.user.id);

  if (!agent?.active) {
    return {
      response: json({ error: "This account does not have Well Support access." }, 403)
    };
  }

  return {
    user: payload.user,
    agent,
    cookies: authCookies(payload)
  };
}

export async function restJson(path, session, options = {}) {
  const response = await supabaseFetch(path, {
    ...options,
    accessToken: session.accessToken
  });
  const payload = await readJson(response);

  if (!response.ok) {
    const error = new Error(
      payload?.message || payload?.error_description || payload?.error || "Support request failed."
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function sessionResponse(data, session, status = 200) {
  return withCookies(json(data, status), session?.cookieHeaders || []);
}

export async function uploadAvatar(session, file) {
  if (!file) throw new Error("Profile photo is missing.");

  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowed.has(file.type)) throw new Error("Use a JPG, PNG, WebP, or GIF profile photo.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile photos must be 5 MB or smaller.");

  const path = `${session.user.id}/profile`;
  const bytes = await file.arrayBuffer();

  const response = await supabaseFetch(
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
    throw new Error(payload?.message || payload?.error || "Profile photo upload failed.");
  }

  return `${SUPABASE_URL}/storage/v1/object/public/support-avatars/${path}?v=${Date.now()}`;
}

export async function deleteAvatar(session) {
  const response = await supabaseFetch(
    `/storage/v1/object/support-avatars/${encodeURIComponent(session.user.id)}/profile`,
    {
      accessToken: session.accessToken,
      method: "DELETE"
    }
  );

  if (!response.ok && response.status !== 404) {
    const payload = await readJson(response);
    throw new Error(payload?.message || payload?.error || "Profile photo removal failed.");
  }
}
