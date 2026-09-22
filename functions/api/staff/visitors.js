import {
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

const ACTIVE_WINDOW_MS = 75_000;
const MAX_VISITORS = 250;

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const since = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const query = new URLSearchParams({
    select: [
      "session_id",
      "last_seen",
      "page_path",
      "page_title",
      "client_ip",
      "country_code",
      "country",
      "region",
      "city",
      "timezone",
      "device_type",
      "viewport_width"
    ].join(","),
    last_seen: `gte.${since}`,
    order: "last_seen.desc",
    limit: String(MAX_VISITORS)
  });

  try {
    const rows = await restJson(
      `/rest/v1/site_active_visitors?${query.toString()}`,
      session
    );

    const visitors = Array.isArray(rows)
      ? rows.map((row) => ({
          sessionId: row.session_id,
          lastSeen: row.last_seen,
          pagePath: row.page_path || "/",
          pageTitle: row.page_title || "",
          ip: row.client_ip || "",
          countryCode: row.country_code || "",
          country: row.country || row.country_code || "Unknown",
          region: row.region || "",
          city: row.city || "",
          timezone: row.timezone || "",
          device: row.device_type || "unknown",
          viewportWidth: Number(row.viewport_width || 0)
        }))
      : [];

    return sessionResponse({
      visitors,
      activeWindowMs: ACTIVE_WINDOW_MS,
      generatedAt: new Date().toISOString()
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to load active visitors." },
      session,
      error.status || 500
    );
  }
}
