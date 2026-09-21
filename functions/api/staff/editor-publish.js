import {
  assertSameOrigin,
  requireStaff,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  compareBranches,
  readOverrides,
  writeOverrides
} from "./_github.js";

const ALLOWED_FONTS = new Set([
  "DM Serif Display",
  "DM Sans",
  "System Sans"
]);

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function cleanPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) return null;
  if (path.length > 240) return null;
  return path === "/index.html" ? "/" : path;
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));
  const pagePath = cleanPath(input.pagePath);
  const heading = cleanText(input.heading, 300);
  const copy = cleanText(input.copy, 1800);
  const accent = cleanText(input.accent, 16);
  const font = cleanText(input.font, 40);

  if (!pagePath) {
    return sessionResponse({ error: "Invalid website page." }, session, 400);
  }

  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) {
    return sessionResponse({ error: "Invalid accent colour." }, session, 400);
  }

  if (font && !ALLOWED_FONTS.has(font)) {
    return sessionResponse({ error: "Invalid heading font." }, session, 400);
  }

  try {
    const comparison = await compareBranches(env);

    if (comparison.behindBy > 0) {
      return sessionResponse(
        {
          error: "beta-main is behind production. Sync beta with main before publishing.",
          code: "beta_behind"
        },
        session,
        409
      );
    }

    const current = await readOverrides(env, BETA_BRANCH);
    const next = {
      version: 1,
      pages: { ...(current.data.pages || {}) }
    };

    const config = {};
    if (heading) config.heading = heading;
    if (copy) config.copy = copy;
    if (accent && accent.toLowerCase() !== "#304660") config.accent = accent;
    if (font && font !== "DM Serif Display") config.font = font;

    if (Object.keys(config).length) {
      next.pages[pagePath] = config;
    } else {
      delete next.pages[pagePath];
    }

    const result = await writeOverrides(
      env,
      BETA_BRANCH,
      next,
      current.sha,
      `Web Editor: update ${pagePath}`
    );

    return sessionResponse({
      ok: true,
      branch: BETA_BRANCH,
      commitSha: result.commit?.sha || null,
      overrides: next
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to publish Web Editor changes." },
      session,
      error.status || 500
    );
  }
}
