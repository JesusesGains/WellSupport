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

const ALLOWED_ATTRIBUTES = new Set(["src", "alt", "href"]);

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

function cleanResourceValue(value, attribute) {
  const raw = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 2000);

  if (!raw) return "";

  if (attribute === "alt") {
    return raw.slice(0, 500);
  }

  if (
    raw.startsWith("/") ||
    /^[a-z0-9][a-z0-9._~!$&'()*+,;=:@%/?#-]*$/i.test(raw)
  ) {
    return raw;
  }

  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.toString();
    if (attribute === "href" && ["mailto:", "tel:"].includes(url.protocol)) {
      return raw;
    }
  } catch {
    return "";
  }

  return "";
}

function cleanAttributeOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const output = {};
  let totalLength = 0;

  for (const [rawSelector, rawAttributes] of Object.entries(value).slice(0, 80)) {
    const selector = cleanSelector(rawSelector);
    if (
      !selector ||
      !rawAttributes ||
      typeof rawAttributes !== "object" ||
      Array.isArray(rawAttributes)
    ) {
      continue;
    }

    const attributes = {};
    for (const [rawName, rawValue] of Object.entries(rawAttributes)) {
      const name = String(rawName || "").toLowerCase();
      if (!ALLOWED_ATTRIBUTES.has(name) || typeof rawValue !== "string") continue;

      const cleaned = cleanResourceValue(rawValue, name);
      totalLength += cleaned.length;
      if (totalLength > 40000) break;
      attributes[name] = cleaned;
    }

    if (Object.keys(attributes).length) output[selector] = attributes;
    if (totalLength > 40000) break;
  }

  return output;
}

function normalisePagePatch(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const heading = cleanText(input.heading, 300);
  const copy = cleanText(input.copy, 1800);
  const accent = cleanText(input.accent, 16);
  const font = cleanText(input.font, 40);
  const text = cleanTextOverrides(input.text);
  const attributes = cleanAttributeOverrides(input.attributes);

  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) {
    const error = new Error("Invalid accent colour.");
    error.status = 400;
    throw error;
  }

  if (font && !ALLOWED_FONTS.has(font)) {
    const error = new Error("Invalid heading font.");
    error.status = 400;
    throw error;
  }

  return {
    heading,
    copy,
    accent,
    font,
    text,
    attributes,
    supplied: {
      heading: Object.prototype.hasOwnProperty.call(input, "heading"),
      copy: Object.prototype.hasOwnProperty.call(input, "copy"),
      accent: Object.prototype.hasOwnProperty.call(input, "accent"),
      font: Object.prototype.hasOwnProperty.call(input, "font"),
      text: Object.prototype.hasOwnProperty.call(input, "text"),
      attributes: Object.prototype.hasOwnProperty.call(input, "attributes")
    }
  };
}

function applyPagePatch(existing, patch) {
  const config = { ...(existing || {}) };

  if (patch.supplied.heading) {
    if (patch.heading) config.heading = patch.heading;
    else delete config.heading;
  }

  if (patch.supplied.copy) {
    if (patch.copy) config.copy = patch.copy;
    else delete config.copy;
  }

  if (patch.supplied.accent) {
    if (patch.accent && patch.accent.toLowerCase() !== "#304660") {
      config.accent = patch.accent;
    } else {
      delete config.accent;
    }
  }

  if (patch.supplied.font) {
    if (patch.font && patch.font !== "DM Serif Display") config.font = patch.font;
    else delete config.font;
  }

  if (patch.supplied.text) {
    if (Object.keys(patch.text).length) config.text = patch.text;
    else delete config.text;
  }

  if (patch.supplied.attributes) {
    if (Object.keys(patch.attributes).length) config.attributes = patch.attributes;
    else delete config.attributes;
  }

  return config;
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));

  const rawPages =
    input.pages && typeof input.pages === "object" && !Array.isArray(input.pages)
      ? Object.entries(input.pages).slice(0, 25)
      : [[input.pagePath, input]];

  const pagePatches = [];
  try {
    for (const [rawPath, rawPatch] of rawPages) {
      const path = cleanPath(rawPath);
      if (!path) {
        return sessionResponse({ error: "Invalid website page." }, session, 400);
      }
      pagePatches.push([path, normalisePagePatch(rawPatch)]);
    }
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Invalid editor change." },
      session,
      error.status || 400
    );
  }

  if (!pagePatches.length) {
    return sessionResponse({ error: "No website changes supplied." }, session, 400);
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
      version: 2,
      pages: { ...(current.data.pages || {}) },
      ...(current.data.banner ? { banner: current.data.banner } : {})
    };

    for (const [pagePath, patch] of pagePatches) {
      const existing =
        next.pages[pagePath] && typeof next.pages[pagePath] === "object"
          ? next.pages[pagePath]
          : {};

      const config = applyPagePatch(existing, patch);

      if (Object.keys(config).length) next.pages[pagePath] = config;
      else delete next.pages[pagePath];
    }

    const result = await writeOverrides(
      env,
      BETA_BRANCH,
      next,
      current.sha,
      pagePatches.length === 1
        ? `Web Editor: update ${pagePatches[0][0]}`
        : `Web Editor: push ${pagePatches.length} page changes to beta`
    );

    return sessionResponse({
      ok: true,
      branch: BETA_BRANCH,
      commitSha: result.commit?.sha || null,
      pagesUpdated: pagePatches.map(([path]) => path),
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
