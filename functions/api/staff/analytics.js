import {
  requireStaff,
  sessionResponse
} from "./_utils.js";

const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const DEFAULT_ANALYTICS_HOST = "wellcollegeglobal.com";
const MAX_CLOUDFLARE_WINDOW_DAYS = 30;
const CLOUDFLARE_CACHE_TTL_MS = 60 * 1000;

// Cloudflare traffic is account-wide (not per staff member), so a short
// isolate-level cache lets every signed-in dashboard share one GraphQL fetch
// per range instead of re-querying Cloudflare on each poll. Concurrent
// requests for the same range share the same in-flight promise.
const cloudflareSummaryCache = new Map();

function emptyCustomSummary(days) {
  return {
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
  };
}

function resultRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function loadD1Summary(db, days) {
  if (!db?.prepare) {
    const error = new Error("Well Support D1 is unavailable.");
    error.status = 503;
    throw error;
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [
    metrics,
    topPagesResult,
    topClicksResult,
    exitPagesResult,
    locationsResult,
    devicesResult,
    referrersResult,
    campaignsResult,
    dailyResult
  ] = await Promise.all([
    db.prepare(
      `SELECT
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
        COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS visitors,
        SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
        SUM(CASE WHEN event_type = 'exit' THEN 1 ELSE 0 END) AS exits,
        COALESCE(ROUND(AVG(CASE WHEN event_type = 'exit' AND duration_ms IS NOT NULL THEN duration_ms END)), 0) AS avg_duration_ms
      FROM site_analytics_events
      WHERE occurred_at >= ?`
    ).bind(since).first(),

    db.prepare(
      `SELECT page_path AS path, COUNT(*) AS views
       FROM site_analytics_events
       WHERE occurred_at >= ? AND event_type = 'page_view'
       GROUP BY page_path
       ORDER BY views DESC, page_path ASC
       LIMIT 12`
    ).bind(since).all(),

    db.prepare(
      `SELECT
         COALESCE(NULLIF(target_text, ''), NULLIF(target_href, ''), 'Unlabelled control') AS label,
         target_href AS href,
         target_kind AS kind,
         is_external AS external,
         COUNT(*) AS clicks
       FROM site_analytics_events
       WHERE occurred_at >= ? AND event_type = 'click'
       GROUP BY label, target_href, target_kind, is_external
       ORDER BY clicks DESC, label ASC
       LIMIT 15`
    ).bind(since).all(),

    db.prepare(
      `SELECT
         page_path AS path,
         COUNT(*) AS exits,
         COALESCE(ROUND(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END)), 0) AS avg_duration_ms
       FROM site_analytics_events
       WHERE occurred_at >= ? AND event_type = 'exit'
       GROUP BY page_path
       ORDER BY exits DESC, page_path ASC
       LIMIT 12`
    ).bind(since).all(),

    db.prepare(
      `SELECT
         COALESCE(city, 'Unknown') AS city,
         COALESCE(region, '') AS region,
         COALESCE(country, country_code, 'Unknown') AS country,
         COUNT(DISTINCT session_id) AS visitors
       FROM site_analytics_events
       WHERE occurred_at >= ? AND event_type = 'page_view'
       GROUP BY city, region, country
       ORDER BY visitors DESC, country ASC, city ASC
       LIMIT 12`
    ).bind(since).all(),

    db.prepare(
      `SELECT device_type AS device, COUNT(DISTINCT session_id) AS visitors
       FROM site_analytics_events
       WHERE occurred_at >= ? AND event_type = 'page_view'
       GROUP BY device_type
       ORDER BY visitors DESC`
    ).bind(since).all(),

    db.prepare(
      `SELECT referrer_host AS host, COUNT(DISTINCT session_id) AS visitors
       FROM site_analytics_events
       WHERE occurred_at >= ?
         AND event_type = 'page_view'
         AND referrer_host IS NOT NULL
         AND referrer_host <> ''
       GROUP BY referrer_host
       ORDER BY visitors DESC, host ASC
       LIMIT 12`
    ).bind(since).all(),

    db.prepare(
      `SELECT
         COALESCE(utm_source, 'direct') AS source,
         COALESCE(utm_medium, '') AS medium,
         COALESCE(utm_campaign, '') AS campaign,
         COUNT(DISTINCT session_id) AS visitors
       FROM site_analytics_events
       WHERE occurred_at >= ?
         AND event_type = 'page_view'
         AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
       GROUP BY source, medium, campaign
       ORDER BY visitors DESC, campaign ASC
       LIMIT 12`
    ).bind(since).all(),

    db.prepare(
      `SELECT
         substr(occurred_at, 1, 10) AS date,
         COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN session_id END) AS visitors,
         SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS views
       FROM site_analytics_events
       WHERE occurred_at >= ?
       GROUP BY substr(occurred_at, 1, 10)
       ORDER BY date ASC`
    ).bind(since).all()
  ]);

  return {
    days,
    generatedAt: new Date().toISOString(),
    metrics: {
      visitors: Number(metrics?.visitors || 0),
      pageViews: Number(metrics?.page_views || 0),
      clicks: Number(metrics?.clicks || 0),
      exits: Number(metrics?.exits || 0),
      avgDurationMs: Number(metrics?.avg_duration_ms || 0)
    },
    topPages: resultRows(topPagesResult).map((row) => ({
      path: row.path,
      views: Number(row.views || 0)
    })),
    topClicks: resultRows(topClicksResult).map((row) => ({
      label: row.label,
      href: row.href || "",
      kind: row.kind || "",
      external: Number(row.external || 0) === 1,
      clicks: Number(row.clicks || 0)
    })),
    exitPages: resultRows(exitPagesResult).map((row) => ({
      path: row.path,
      exits: Number(row.exits || 0),
      avgDurationMs: Number(row.avg_duration_ms || 0)
    })),
    locations: resultRows(locationsResult).map((row) => ({
      city: row.city || "Unknown",
      region: row.region || "",
      country: row.country || "Unknown",
      visitors: Number(row.visitors || 0)
    })),
    devices: resultRows(devicesResult).map((row) => ({
      device: row.device || "unknown",
      visitors: Number(row.visitors || 0)
    })),
    referrers: resultRows(referrersResult).map((row) => ({
      host: row.host || "",
      visitors: Number(row.visitors || 0)
    })),
    campaigns: resultRows(campaignsResult).map((row) => ({
      source: row.source || "direct",
      medium: row.medium || "",
      campaign: row.campaign || "",
      visitors: Number(row.visitors || 0)
    })),
    daily: resultRows(dailyResult).map((row) => ({
      date: row.date,
      visitors: Number(row.visitors || 0),
      views: Number(row.views || 0)
    }))
  };
}

function cloudflareConfig(env) {
  const accountId = String(
    env?.CLOUDFLARE_ACCOUNT_ID ||
    env?.CF_ACCOUNT_ID ||
    ""
  ).trim();
  const apiToken = String(
    env?.CLOUDFLARE_ANALYTICS_TOKEN ||
    env?.CLOUDFLARE_API_TOKEN ||
    ""
  ).trim();
  const host = String(
    env?.CLOUDFLARE_ANALYTICS_HOST ||
    DEFAULT_ANALYTICS_HOST
  ).trim().toLowerCase();

  if (!accountId || !apiToken || !host) return null;
  return { accountId, apiToken, host };
}

function iso(value) {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function analyticsWindows(days) {
  const windows = [];
  const end = new Date();

  for (let remaining = days; remaining > 0;) {
    const span = Math.min(remaining, MAX_CLOUDFLARE_WINDOW_DAYS);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - span);

    windows.unshift({
      start: iso(start),
      end: iso(end)
    });

    end.setTime(start.getTime());
    remaining -= span;
  }

  return windows;
}

const CLOUDFLARE_QUERY = `
  query WellWebsiteAnalytics(
    $accountTag: string!
    $host: string!
    $start: Time!
    $end: Time!
  ) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        overview: rumPageloadEventsAdaptiveGroups(
          limit: 1
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
        }

        daily: rumPageloadEventsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
          dimensions { date }
        }

        topPages: rumPageloadEventsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
          dimensions { requestPath }
        }

        countries: rumPageloadEventsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
          dimensions { countryName }
        }

        referrers: rumPageloadEventsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
          dimensions { refererHost }
        }

        devices: rumPageloadEventsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
          dimensions { deviceType }
        }

        browsers: rumPageloadEventsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
          dimensions { userAgentBrowser }
        }

        operatingSystems: rumPageloadEventsAdaptiveGroups(
          limit: 5000
          filter: {
            datetime_geq: $start
            datetime_lt: $end
            requestHost: $host
            bot: 0
          }
        ) {
          count
          sum { visits }
          dimensions { userAgentOS }
        }
      }
    }
  }
`;

async function cloudflareGraphql(config, variables) {
  const response = await fetch(CLOUDFLARE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: CLOUDFLARE_QUERY,
      variables
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // handled below
  }

  if (!response.ok) {
    const error = new Error("Cloudflare Analytics request failed.");
    error.status = response.status;
    throw error;
  }

  if (payload?.errors?.length) {
    const error = new Error(
      payload.errors
        .map((item) => String(item?.message || "Cloudflare GraphQL error"))
        .join("; ")
    );
    error.status = 502;
    throw error;
  }

  return payload?.data?.viewer?.accounts?.[0] || null;
}

function addToMap(map, key, values) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return;

  const current = map.get(cleanKey) || {
    views: 0,
    visits: 0
  };

  current.views += Number(values?.views || 0);
  current.visits += Number(values?.visits || 0);
  map.set(cleanKey, current);
}

function topRows(map, mapper, limit = 12) {
  return [...map.entries()]
    .map(([key, value]) => mapper(key, value))
    .sort((a, b) =>
      Number(b.views ?? b.visitors ?? b.visits ?? 0) -
      Number(a.views ?? a.visitors ?? a.visits ?? 0)
    )
    .slice(0, limit);
}

async function loadCloudflareSummary(env, days, { fresh = false } = {}) {
  const config = cloudflareConfig(env);
  if (!config) return null;

  const key = `${config.accountId}:${config.host}:${days}`;
  const cached = cloudflareSummaryCache.get(key);
  if (cached && !fresh && Date.now() - cached.at < CLOUDFLARE_CACHE_TTL_MS) {
    return cached.promise;
  }

  const promise = fetchCloudflareSummary(config, days);
  cloudflareSummaryCache.set(key, { at: Date.now(), promise });
  // Failures are never cached; the next request retries immediately.
  promise.catch(() => {
    if (cloudflareSummaryCache.get(key)?.promise === promise) {
      cloudflareSummaryCache.delete(key);
    }
  });
  return promise;
}

async function fetchCloudflareSummary(config, days) {
  let pageViews = 0;
  let visits = 0;
  const daily = new Map();
  const pages = new Map();
  const countries = new Map();
  const referrers = new Map();
  const devices = new Map();
  const browsers = new Map();
  const operatingSystems = new Map();

  // The windows are independent, so the 90-day range queries them in parallel.
  const windows = await Promise.all(
    analyticsWindows(days).map((window) =>
      cloudflareGraphql(config, {
        accountTag: config.accountId,
        host: config.host,
        start: window.start,
        end: window.end
      })
    )
  );

  for (const data of windows) {
    const overview = data?.overview?.[0];
    pageViews += Number(overview?.count || 0);
    visits += Number(overview?.sum?.visits || 0);

    for (const row of data?.daily || []) {
      addToMap(daily, row?.dimensions?.date, {
        views: row?.count,
        visits: row?.sum?.visits
      });
    }

    for (const row of data?.topPages || []) {
      addToMap(pages, row?.dimensions?.requestPath || "/", {
        views: row?.count,
        visits: row?.sum?.visits
      });
    }

    for (const row of data?.countries || []) {
      addToMap(countries, row?.dimensions?.countryName || "Unknown", {
        views: row?.count,
        visits: row?.sum?.visits
      });
    }

    for (const row of data?.referrers || []) {
      const host = row?.dimensions?.refererHost;
      if (!host || host === config.host) continue;
      addToMap(referrers, host, {
        views: row?.count,
        visits: row?.sum?.visits
      });
    }

    for (const row of data?.devices || []) {
      addToMap(devices, row?.dimensions?.deviceType || "unknown", {
        views: row?.count,
        visits: row?.sum?.visits
      });
    }

    for (const row of data?.browsers || []) {
      addToMap(browsers, row?.dimensions?.userAgentBrowser || "Unknown", {
        views: row?.count,
        visits: row?.sum?.visits
      });
    }

    for (const row of data?.operatingSystems || []) {
      addToMap(
        operatingSystems,
        row?.dimensions?.userAgentOS || "Unknown",
        {
          views: row?.count,
          visits: row?.sum?.visits
        }
      );
    }
  }

  return {
    host: config.host,
    metrics: {
      visits,
      pageViews,
      pagesPerVisit: visits > 0 ? pageViews / visits : 0
    },
    topPages: topRows(
      pages,
      (path, values) => ({
        path,
        views: values.views,
        visits: values.visits
      })
    ),
    locations: topRows(
      countries,
      (country, values) => ({
        city: "",
        region: "",
        country,
        visitors: values.visits,
        views: values.views
      })
    ),
    referrers: topRows(
      referrers,
      (host, values) => ({
        host,
        visitors: values.visits,
        views: values.views
      })
    ),
    devices: topRows(
      devices,
      (device, values) => ({
        device,
        visitors: values.visits,
        views: values.views
      })
    ),
    browsers: topRows(
      browsers,
      (browser, values) => ({
        browser,
        visitors: values.visits,
        views: values.views
      })
    ),
    operatingSystems: topRows(
      operatingSystems,
      (os, values) => ({
        os,
        visitors: values.visits,
        views: values.views
      })
    ),
    daily: [...daily.entries()]
      .map(([date, values]) => ({
        date,
        visitors: values.visits,
        visits: values.visits,
        views: values.views
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  };
}

function mergeSummaries(days, custom, cloudflare, cloudflareError) {
  const traffic = cloudflare || {
    metrics: {
      visits: custom.metrics?.visitors || 0,
      pageViews: custom.metrics?.pageViews || 0,
      pagesPerVisit:
        Number(custom.metrics?.visitors || 0) > 0
          ? Number(custom.metrics?.pageViews || 0) /
            Number(custom.metrics?.visitors || 1)
          : 0
    },
    topPages: custom.topPages || [],
    locations: custom.locations || [],
    referrers: custom.referrers || [],
    devices: custom.devices || [],
    browsers: [],
    operatingSystems: [],
    daily: custom.daily || []
  };

  return {
    days,
    generatedAt: new Date().toISOString(),
    trafficSource: cloudflare ? "cloudflare" : "first_party_fallback",
    cloudflareConfigured: false,
    cloudflareError: cloudflareError || null,
    metrics: {
      visits: Number(traffic.metrics?.visits || 0),
      visitors: Number(traffic.metrics?.visits || 0),
      pageViews: Number(traffic.metrics?.pageViews || 0),
      pagesPerVisit: Number(traffic.metrics?.pagesPerVisit || 0),
      clicks: Number(custom.metrics?.clicks || 0),
      exits: Number(custom.metrics?.exits || 0),
      avgDurationMs: Number(custom.metrics?.avgDurationMs || 0)
    },
    topPages: traffic.topPages || [],
    topClicks: custom.topClicks || [],
    exitPages: custom.exitPages || [],
    locations: traffic.locations || [],
    devices: traffic.devices || [],
    referrers: traffic.referrers || [],
    browsers: traffic.browsers || [],
    operatingSystems: traffic.operatingSystems || [],
    campaigns: custom.campaigns || [],
    daily: traffic.daily || []
  };
}

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") || 30);
  const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
  const fresh = url.searchParams.get("fresh") === "1";

  const [customResult, cloudflareResult] = await Promise.allSettled([
    loadD1Summary(session.db, days),
    loadCloudflareSummary(env, days, { fresh })
  ]);

  const custom =
    customResult.status === "fulfilled" && customResult.value
      ? customResult.value
      : emptyCustomSummary(days);

  let cloudflare = null;
  let cloudflareError = null;

  if (cloudflareResult.status === "fulfilled") {
    cloudflare = cloudflareResult.value;
  } else {
    cloudflareError =
      cloudflareResult.reason?.message ||
      "Cloudflare Analytics is temporarily unavailable.";
  }

  if (
    customResult.status === "rejected" &&
    !cloudflare
  ) {
    return sessionResponse(
      {
        error:
          customResult.reason?.message ||
          cloudflareError ||
          "Unable to load website analytics."
      },
      session,
      customResult.reason?.status || 500
    );
  }

  const summary = mergeSummaries(
    days,
    custom,
    cloudflare,
    cloudflareError
  );

  summary.cloudflareConfigured = Boolean(cloudflareConfig(env));

  return sessionResponse({ summary }, session);
}
