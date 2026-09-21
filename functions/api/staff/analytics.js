import {
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const DEFAULT_ANALYTICS_HOST = "wellcollegeglobal.com";
const MAX_CLOUDFLARE_WINDOW_DAYS = 30;

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

async function loadCloudflareSummary(env, days) {
  const config = cloudflareConfig(env);
  if (!config) return null;

  let pageViews = 0;
  let visits = 0;
  const daily = new Map();
  const pages = new Map();
  const countries = new Map();
  const referrers = new Map();
  const devices = new Map();
  const browsers = new Map();
  const operatingSystems = new Map();

  for (const window of analyticsWindows(days)) {
    const data = await cloudflareGraphql(config, {
      accountTag: config.accountId,
      host: config.host,
      start: window.start,
      end: window.end
    });

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
    cloudflareConfigured: Boolean(cloudflareConfig(arguments[4] || {})),
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

  const [customResult, cloudflareResult] = await Promise.allSettled([
    restJson(
      "/rest/v1/rpc/site_analytics_summary",
      session,
      {
        method: "POST",
        body: { p_days: days }
      }
    ),
    loadCloudflareSummary(env, days)
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
