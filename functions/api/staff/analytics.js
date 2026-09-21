import {
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") || 30);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;

  try {
    const summary = await restJson(
      "/rest/v1/rpc/site_analytics_summary",
      session,
      {
        method: "POST",
        body: { p_days: days }
      }
    );

    return sessionResponse({
      summary: summary || {
        days,
        metrics: {
          visitors: 0,
          pageViews: 0,
          clicks: 0,
          exits: 0,
          avgDurationMs: 0
        },
        topPages: [],
        topClicks: [],
        exitPages: [],
        locations: [],
        devices: [],
        referrers: [],
        campaigns: [],
        daily: []
      }
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to load website analytics." },
      session,
      error.status || 500
    );
  }
}
