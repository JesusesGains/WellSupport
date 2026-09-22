import {
  assertSameOrigin,
  requireStaff,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  compareBranches,
  commitFiles,
  readOverrides,
  readTextFile
} from "./_github.js";

const ALLOWED_FONTS = new Set(["DM Serif Display", "DM Sans", "System Sans"]);
const ALLOWED_ATTRIBUTES = new Set(["src", "alt", "href"]);
const ALLOWED_STYLES = new Set([
  "backgroundColor",
  "color",
  "minHeight",
  "paddingTop",
  "paddingBottom",
  "borderRadius"
]);
const HEADER_KEYS = ["qualifications", "short-courses", "about", "testimonials", "more"];
const SHORT_COURSE_GROUPS = [
  "Nutrition & health",
  "Holistic health",
  "Psychology & coaching",
  "Business"
];
const NAVIGATION_PATH = "src/data/navigation.js";
const LAYOUT_PATH = "src/data/editorLayout.json";
const MAX_ASSET_BYTES = 6 * 1024 * 1024;
const MAX_ASSET_TOTAL_BYTES = 20 * 1024 * 1024;

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
  if (attribute === "alt") return raw.slice(0, 500);

  if (
    raw.startsWith("/") ||
    /^[a-z0-9][a-z0-9._~!$&'()*+,;=:@%/?#-]*$/i.test(raw)
  ) {
    return raw;
  }

  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.toString();
    if (attribute === "href" && ["mailto:", "tel:"].includes(url.protocol)) return raw;
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
    if (!selector || !rawAttributes || typeof rawAttributes !== "object" || Array.isArray(rawAttributes)) {
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

function cleanStyleValue(name, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (name === "backgroundColor" || name === "color") {
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : "";
  }

  if (["minHeight", "paddingTop", "paddingBottom", "borderRadius"].includes(name)) {
    const match = raw.match(/^(\d{1,4})px$/i);
    if (!match) return "";
    const number = Math.max(0, Math.min(1600, Number(match[1])));
    return `${number}px`;
  }

  return "";
}

function cleanStyleOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const output = {};

  for (const [rawSelector, rawStyles] of Object.entries(value).slice(0, 80)) {
    const selector = cleanSelector(rawSelector);
    if (
      !selector ||
      !rawStyles ||
      typeof rawStyles !== "object" ||
      Array.isArray(rawStyles)
    ) {
      continue;
    }

    const styles = {};
    for (const [rawName, rawValue] of Object.entries(rawStyles)) {
      const name = String(rawName || "");
      if (!ALLOWED_STYLES.has(name)) continue;
      const cleaned = cleanStyleValue(name, rawValue);
      if (cleaned) styles[name] = cleaned;
    }

    if (Object.keys(styles).length) output[selector] = styles;
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
  const styles = cleanStyleOverrides(input.styles);

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
    heading, copy, accent, font, text, attributes, styles,
    supplied: {
      heading: Object.prototype.hasOwnProperty.call(input, "heading"),
      copy: Object.prototype.hasOwnProperty.call(input, "copy"),
      accent: Object.prototype.hasOwnProperty.call(input, "accent"),
      font: Object.prototype.hasOwnProperty.call(input, "font"),
      text: Object.prototype.hasOwnProperty.call(input, "text"),
      attributes: Object.prototype.hasOwnProperty.call(input, "attributes"),
      styles: Object.prototype.hasOwnProperty.call(input, "styles")
    }
  };
}

function applyPagePatch(existing, patch) {
  const config = { ...(existing || {}) };
  if (patch.supplied.heading) patch.heading ? config.heading = patch.heading : delete config.heading;
  if (patch.supplied.copy) patch.copy ? config.copy = patch.copy : delete config.copy;
  if (patch.supplied.accent) {
    if (patch.accent && patch.accent.toLowerCase() !== "#304660") config.accent = patch.accent;
    else delete config.accent;
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
  if (patch.supplied.styles) {
    if (Object.keys(patch.styles).length) config.styles = patch.styles;
    else delete config.styles;
  }
  return config;
}

function cleanBanner(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const intervalMs = Math.max(3200, Math.min(12000, Number(input.intervalMs || 5200)));
  const items = [];

  for (const [index, item] of (Array.isArray(input.items) ? input.items : []).slice(0, 10).entries()) {
    if (!item || typeof item !== "object") continue;
    const message = cleanText(item.message, 150);
    if (!message) continue;

    const cleanColour = (value, fallback) => {
      const colour = cleanText(value, 16);
      return /^#[0-9a-f]{6}$/i.test(colour) ? colour.toUpperCase() : fallback;
    };
    const cleanDate = (value) => {
      const raw = cleanText(value, 40);
      if (!raw) return "";
      const time = Date.parse(raw);
      return Number.isFinite(time) ? new Date(time).toISOString() : "";
    };
    const cleanHref = (value) => {
      const href = cleanText(value, 400);
      if (!href) return "";
      if (href.startsWith("/") || /^[a-z0-9][a-z0-9._/-]*\.html(?:[?#].*)?$/i.test(href)) return href;
      try {
        const url = new URL(href);
        return url.protocol === "https:" ? url.toString() : "";
      } catch {
        return "";
      }
    };

    const startsAt = cleanDate(item.startsAt);
    const endsAt = cleanDate(item.endsAt);
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) continue;

    items.push({
      id: cleanText(item.id, 80) || `banner-${index + 1}`,
      message,
      cta: cleanText(item.cta, 80),
      href: cleanHref(item.href),
      background: cleanColour(item.background, "#304660"),
      foreground: cleanColour(item.foreground, "#FFFEFA"),
      startsAt,
      endsAt,
      enabled: item.enabled !== false
    });
  }

  return { intervalMs, items };
}

function exactOrder(value, allowed, label) {
  if (!Array.isArray(value) || !Array.isArray(allowed) || value.length !== allowed.length) {
    const error = new Error(`Invalid ${label} order.`);
    error.status = 400;
    throw error;
  }

  const clean = value.map((item) => String(item || ""));
  const unique = new Set(clean);
  if (unique.size !== allowed.length || allowed.some((item) => !unique.has(String(item)))) {
    const error = new Error(`Invalid ${label} order.`);
    error.status = 400;
    throw error;
  }
  return clean;
}

function replaceExportedStringArray(source, exportName, values) {
  const expression = new RegExp(
    `export\\s+const\\s+${exportName}\\s*=\\s*\\[([\\s\\S]*?)\\];`
  );
  if (!expression.test(source)) {
    const error = new Error(`Website navigation source is missing ${exportName}.`);
    error.status = 409;
    throw error;
  }
  return source.replace(
    expression,
    [
      `export const ${exportName} = [`,
      ...values.map((item) => `  ${JSON.stringify(item)},`),
      "];"
    ].join("\n")
  );
}

function cleanAssets(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  let total = 0;

  for (const asset of value.slice(0, 12)) {
    if (!asset || typeof asset !== "object") continue;
    const path = String(asset.path || "").trim();
    const content = String(asset.contentBase64 || "").replace(/\s+/g, "");
    const size = Math.max(0, Number(asset.size || 0));

    if (!/^assets\/uploads\/[a-z0-9][a-z0-9._/-]{0,220}$/i.test(path)) {
      const error = new Error("Invalid uploaded asset path.");
      error.status = 400;
      throw error;
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
      const error = new Error("Invalid uploaded asset data.");
      error.status = 400;
      throw error;
    }
    if (size > MAX_ASSET_BYTES) {
      const error = new Error("Each uploaded asset must be 6 MB or smaller.");
      error.status = 413;
      throw error;
    }
    total += size;
    if (total > MAX_ASSET_TOTAL_BYTES) {
      const error = new Error("Draft asset uploads exceed the 20 MB publish limit.");
      error.status = 413;
      throw error;
    }

    output.push({ path, content, size });
  }

  return output;
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
      : [];

  const pagePatches = [];
  try {
    for (const [rawPath, rawPatch] of rawPages) {
      const path = cleanPath(rawPath);
      if (!path) return sessionResponse({ error: "Invalid website page." }, session, 400);
      pagePatches.push([path, normalisePagePatch(rawPatch)]);
    }
  } catch (error) {
    return sessionResponse({ error: error.message || "Invalid editor change." }, session, error.status || 400);
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

    const [current, navigationFile, layoutFile] = await Promise.all([
      readOverrides(env, BETA_BRANCH),
      readTextFile(env, BETA_BRANCH, NAVIGATION_PATH),
      readTextFile(env, BETA_BRANCH, LAYOUT_PATH)
    ]);

    const nextOverrides = {
      version: 2,
      pages: { ...(current.data.pages || {}) },
      ...(current.data.banner ? { banner: current.data.banner } : {})
    };

    for (const [pagePath, patch] of pagePatches) {
      const existing =
        nextOverrides.pages[pagePath] && typeof nextOverrides.pages[pagePath] === "object"
          ? nextOverrides.pages[pagePath]
          : {};
      const config = applyPagePatch(existing, patch);
      if (Object.keys(config).length) nextOverrides.pages[pagePath] = config;
      else delete nextOverrides.pages[pagePath];
    }

    const hasBannerChange = Object.prototype.hasOwnProperty.call(input, "banner");
    if (hasBannerChange) {
      nextOverrides.banner = cleanBanner(input.banner) || { intervalMs: 5200, items: [] };
    }

    let nextNavigation = navigationFile.content;
    let navigationResult = null;
    if (input.navigation && typeof input.navigation === "object") {
      const headerOrder = exactOrder(input.navigation.headerOrder, HEADER_KEYS, "header");
      const shortCourseGroupOrder = exactOrder(
        input.navigation.shortCourseGroupOrder,
        SHORT_COURSE_GROUPS,
        "Short Courses dropdown"
      );
      nextNavigation = replaceExportedStringArray(nextNavigation, "headerNavigationOrder", headerOrder);
      nextNavigation = replaceExportedStringArray(nextNavigation, "shortCourseGroupOrder", shortCourseGroupOrder);
      navigationResult = { headerOrder, shortCourseGroupOrder };
    }

    let currentLayout;
    try {
      currentLayout = JSON.parse(layoutFile.content);
    } catch {
      const error = new Error("Website layout source is invalid JSON.");
      error.status = 409;
      throw error;
    }

    const nextLayout = { ...currentLayout };
    const rawLayoutOrders =
      input.layoutOrders && typeof input.layoutOrders === "object" && !Array.isArray(input.layoutOrders)
        ? input.layoutOrders
        : null;

    if (rawLayoutOrders) {
      for (const [scope, rawOrder] of Object.entries(rawLayoutOrders)) {
        if (!Object.prototype.hasOwnProperty.call(currentLayout, scope)) continue;
        nextLayout[scope] = exactOrder(rawOrder, currentLayout[scope], `${scope} layout`);
      }
    }

    const assets = cleanAssets(input.assets);
    const hasPageChanges = pagePatches.length > 0;
    const hasNavigationChange = Boolean(navigationResult);
    const hasLayoutChange = Boolean(rawLayoutOrders && Object.keys(rawLayoutOrders).length);
    const hasAssets = assets.length > 0;

    if (!hasPageChanges && !hasBannerChange && !hasNavigationChange && !hasLayoutChange && !hasAssets) {
      return sessionResponse({ error: "No website changes supplied." }, session, 400);
    }

    const files = [];

    if (hasPageChanges || hasBannerChange) {
      files.push({
        path: "editor-overrides.json",
        content: `${JSON.stringify(nextOverrides, null, 2)}\n`
      });
    }

    if (hasNavigationChange) {
      files.push({
        path: NAVIGATION_PATH,
        content: nextNavigation.endsWith("\n") ? nextNavigation : `${nextNavigation}\n`
      });
    }

    if (hasLayoutChange) {
      files.push({
        path: LAYOUT_PATH,
        content: `${JSON.stringify(nextLayout, null, 2)}\n`
      });
    }

    for (const asset of assets) {
      files.push({
        path: asset.path,
        content: asset.content,
        encoding: "base64"
      });
    }

    const result = await commitFiles(
      env,
      BETA_BRANCH,
      files,
      "Web Editor: publish staged preview changes"
    );

    return sessionResponse({
      ok: true,
      branch: BETA_BRANCH,
      commitSha: result.sha,
      pagesUpdated: pagePatches.map(([path]) => path),
      overrides: nextOverrides,
      navigation: navigationResult,
      layoutOrders: nextLayout,
      assets: assets.map((asset) => ({ path: asset.path, url: `/${asset.path}` }))
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to publish Web Editor changes." },
      session,
      error.status || 500
    );
  }
}
