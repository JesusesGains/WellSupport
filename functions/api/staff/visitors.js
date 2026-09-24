import {
  requireStaff,
  sessionResponse
} from "./_utils.js";

const ACTIVE_WINDOW_MS = 75_000;
const MAX_VISITORS = 250;

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  if (!session.db?.prepare) {
    return sessionResponse(
      { error: "Well Support D1 is unavailable." },
      session,
      503
    );
  }

  const since = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();

  try {
    await session.db
      .prepare("DELETE FROM site_active_visitors WHERE last_seen < ?")
      .bind(staleCutoff)
      .run();

    const result = await session.db
      .prepare(
        `SELECT
          session_id,
          last_seen,
          page_path,
          page_title,
          client_ip,
          country_code,
          country,
          region,
          city,
          timezone,
          device_type,
          viewport_width
        FROM site_active_visitors
        WHERE last_seen >= ?
        ORDER BY last_seen DESC
        LIMIT ?`
      )
      .bind(since, MAX_VISITORS)
      .all();

    const visitors = (result.results || []).map((row) => ({
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
    }));

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
