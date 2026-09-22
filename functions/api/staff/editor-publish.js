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

function cleanSelector(value) {
  const selector = String(value || "").trim();
  if (!selector || selector.length > 500) return "";
  if (!/^[#a-z0-9_.>:\\()\-\s]+$/i.test(selector)) return "";
  return selector;
}

function cleanTextOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const output = {};
  let totalLength = 0;

  for (const [rawSelector, rawText] of Object.entries(value).slice(0, 120)) {
    const selector = cleanSelector(rawSelector);
    if (!selector || typeof rawText !== "string") continue;

    const text = rawText
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .slice(0, 4000);

    totalLength += text.length;
    if (totalLength > 50000) break;
    output[selector] = text;
  }

  return output;
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
  const textOverrides = cleanTextOverrides(input.text);

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

    const existing =
      next.pages[pagePath] && typeof next.pages[pagePath] === "object"
        ? next.pages[pagePath]
        : {};
    const config = { ...existing };

    if (Object.prototype.hasOwnProperty.call(input, "heading")) {
      if (heading) config.heading = heading;
      else delete config.heading;
    }

    if (Object.prototype.hasOwnProperty.call(input, "copy")) {
      if (copy) config.copy = copy;
      else delete config.copy;
    }

    if (Object.prototype.hasOwnProperty.call(input, "accent")) {
      if (accent && accent.toLowerCase() !== "#304660") config.accent = accent;
      else delete config.accent;
    }

    if (Object.prototype.hasOwnProperty.call(input, "font")) {
      if (font && font !== "DM Serif Display") config.font = font;
      else delete config.font;
    }

    if (Object.prototype.hasOwnProperty.call(input, "text")) {
      if (Object.keys(textOverrides).length) config.text = textOverrides;
      else delete config.text;
    }

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
