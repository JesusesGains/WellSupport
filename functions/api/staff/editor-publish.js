import {
  assertSameOrigin,
  requireStaff,
  requireStaffPermission,
  recordEditorAudit,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  compareBranches,
  commitFiles,
  readBase64File,
  readOverrides,
  readTextFile
} from "./_github.js";

const ALLOWED_FONTS = new Set(["DM Serif Display", "DM Sans", "System Sans"]);
const ALLOWED_ATTRIBUTES = new Set(["src", "alt", "href"]);
const ALLOWED_STYLES = new Set([
  "backgroundColor",
  "color",
  "minHeight",
  "width",
  "height",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "gap",
  "borderRadius",
  "borderWidth",
  "borderColor",
  "borderStyle",
  "boxShadow",
  "opacity",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "display",
  "justifyContent",
  "alignItems",
  "flexDirection",
  "objectFit"
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
const MAX_HTML_CHARS = 350000;
const MAX_CSS_CHARS = 650000;

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

  if (["backgroundColor", "color", "borderColor"].includes(name)) {
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : "";
  }

  if (
    [
      "minHeight",
      "width",
      "height",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "gap",
      "borderRadius",
      "borderWidth",
      "fontSize"
    ].includes(name)
  ) {
    const match = raw.match(/^(\d{1,4})px$/i);
    if (!match) return "";
    const maximum =
      name === "width" || name === "height"
        ? 5000
        : name.startsWith("padding") || name.startsWith("margin") || name === "gap"
          ? 800
          : name === "fontSize"
            ? 240
            : name === "borderWidth"
              ? 40
              : 1600;
    const number = Math.max(0, Math.min(maximum, Number(match[1])));
    return `${number}px`;
  }

  if (name === "objectFit") {
    return ["cover", "contain", "fill", "scale-down", "none"].includes(raw)
      ? raw
      : "";
  }

  if (name === "letterSpacing") {
    const match = raw.match(/^(-?\d{1,3}(?:\.\d+)?)px$/i);
    if (!match) return "";
    const number = Math.max(-20, Math.min(80, Number(match[1])));
    return `${number}px`;
  }

  if (name === "opacity") {
    const number = Number(raw);
    return Number.isFinite(number) ? String(Math.max(0, Math.min(1, number))) : "";
  }

  if (name === "fontWeight") {
    const number = Math.round(Number(raw) / 100) * 100;
    return Number.isFinite(number) ? String(Math.max(100, Math.min(900, number))) : "";
  }

  if (name === "lineHeight") {
    const number = Number(raw);
    return Number.isFinite(number) ? String(Math.max(.7, Math.min(4, number))) : "";
  }

  if (name === "textAlign") {
    return ["left", "center", "right", "justify"].includes(raw) ? raw : "";
  }

  if (name === "display") {
    return ["block", "inline", "inline-block", "flex", "grid", "none"].includes(raw) ? raw : "";
  }

  if (name === "justifyContent" || name === "alignItems") {
    return ["flex-start", "center", "flex-end", "space-between", "space-around", "stretch"].includes(raw)
      ? raw
      : "";
  }

  if (name === "flexDirection") {
    return ["row", "column", "row-reverse", "column-reverse"].includes(raw) ? raw : "";
  }

  if (name === "borderStyle") {
    return ["none", "solid", "dashed", "dotted"].includes(raw) ? raw : "";
  }

  if (name === "boxShadow") {
    if (raw.length > 140 || /[;{}<>]|url\s*\(/i.test(raw)) return "";
    return raw;
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

function cleanResponsiveStyleOverrides(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  return {
    tablet: cleanStyleOverrides(input.tablet),
    mobile: cleanStyleOverrides(input.mobile)
  };
}

function cleanOrderOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const output = {};
  for (const [rawParent, rawChildren] of Object.entries(value).slice(0, 30)) {
    const parent = cleanSelector(rawParent);
    if (!parent || !Array.isArray(rawChildren)) continue;

    const children = rawChildren
      .slice(0, 40)
      .map((child) => cleanSelector(child))
      .filter(Boolean);

    if (children.length > 1 && new Set(children).size === children.length) {
      output[parent] = children;
    }
  }

  return output;
}

function cleanElementOverrides(value) {
  if (!Array.isArray(value)) return [];

  const cleanColour = (value, fallback) => {
    const colour = cleanText(value, 16);
    return /^#[0-9a-f]{6}$/i.test(colour) ? colour.toUpperCase() : fallback;
  };
  const cleanFont = (value) => {
    const font = cleanText(value, 80);
    return ["DM Sans", "DM Serif Display", "System Sans"].includes(font)
      ? font
      : "DM Sans";
  };

  return value
    .slice(0, 60)
    .filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      return ["text", "image", "button", "section"].includes(String(item.type || ""));
    })
    .map((item, index) => {
      const type = String(item.type || "text");
      const base = {
        id: cleanText(item.id, 80) || `${type}-${index + 1}`,
        type,
        x: Math.max(0, Math.min(10000, Number(item.x || 0))),
        y: Math.max(0, Math.min(50000, Number(item.y || 0))),
        width: Math.max(40, Math.min(5000, Number(item.width || (type === "section" ? 960 : 240)))),
        minHeight: Math.max(24, Math.min(4000, Number(item.minHeight || (type === "section" ? 240 : 60))))
      };

      if (type === "image") {
        return {
          ...base,
          src: cleanResourceValue(item.src, "src"),
          alt: cleanResourceValue(item.alt, "alt"),
          objectFit: ["cover", "contain", "fill", "scale-down", "none"].includes(String(item.objectFit || ""))
            ? String(item.objectFit)
            : "cover",
          borderRadius: Math.max(0, Math.min(400, Number(item.borderRadius || 0)))
        };
      }

      if (type === "button") {
        return {
          ...base,
          text: cleanText(item.text, 240) || "Button",
          href: cleanResourceValue(item.href, "href") || "#",
          fontFamily: cleanFont(item.fontFamily),
          fontSize: Math.max(8, Math.min(120, Number(item.fontSize || 16))),
          fontWeight: Math.max(300, Math.min(900, Number(item.fontWeight || 700))),
          color: cleanColour(item.color, "#FFFFFF"),
          backgroundColor: cleanColour(item.backgroundColor, "#304660"),
          borderRadius: Math.max(0, Math.min(240, Number(item.borderRadius || 10))),
          paddingX: Math.max(0, Math.min(160, Number(item.paddingX || 20))),
          paddingY: Math.max(0, Math.min(120, Number(item.paddingY || 12)))
        };
      }

      if (type === "section") {
        return {
          ...base,
          backgroundColor: cleanColour(item.backgroundColor, "#FFFEFA"),
          borderRadius: Math.max(0, Math.min(400, Number(item.borderRadius || 0)))
        };
      }

      const colour = cleanText(item.color, 16);
      return {
        ...base,
        type: "text",
        text: cleanText(item.text, 4000) || "Text",
        fontFamily: cleanFont(item.fontFamily),
        fontSize: Math.max(8, Math.min(120, Number(item.fontSize || 24))),
        fontWeight: Math.max(300, Math.min(900, Number(item.fontWeight || 500))),
        lineHeight: Math.max(.8, Math.min(2.5, Number(item.lineHeight || 1.2))),
        letterSpacing: Math.max(-4, Math.min(20, Number(item.letterSpacing || 0))),
        color: /^#[0-9a-f]{6}$/i.test(colour) ? colour.toUpperCase() : "#304660",
        textAlign: ["left", "center", "right"].includes(String(item.textAlign || ""))
          ? String(item.textAlign)
          : "left"
      };
    });
}

function cleanSeo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const robotsAllowed = new Set(["", "index,follow", "index,nofollow", "noindex,follow", "noindex,nofollow"]);
  const robots = cleanText(value.robots, 40).toLowerCase();
  return {
    title: cleanText(value.title, 180),
    description: cleanText(value.description, 320),
    ogTitle: cleanText(value.ogTitle, 180),
    ogDescription: cleanText(value.ogDescription, 320),
    ogImage: cleanResourceValue(value.ogImage, "src"),
    canonical: cleanResourceValue(value.canonical, "href"),
    robots: robotsAllowed.has(robots) ? robots : ""
  };
}

function escapeHtmlText(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function replaceOrInsertHeadTag(html, expression, tag) {
  const source = String(html || "");
  if (expression.test(source)) return source.replace(expression, tag);
  return /<\/head\s*>/i.test(source) ? source.replace(/<\/head\s*>/i, `  ${tag}\n</head>`) : source;
}

function applySeoToHtml(html, seo) {
  let next = String(html || "");
  if (!next || !/<head\b/i.test(next)) return next;
  const title = escapeHtmlText(seo.title);
  if (title) {
    next = replaceOrInsertHeadTag(next, /<title\b[^>]*>[\s\S]*?<\/title\s*>/i, `<title>${title}</title>`);
  }
  const upsertMeta = (attribute, name, content) => {
    if (!content) return;
    const safe = escapeHtmlAttribute(content);
    const safeName = String(name || "").replace(/[^a-z0-9:._-]/gi, "");
    const expression = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["\']${safeName}["\'])[^>]*>`, "i");
    next = replaceOrInsertHeadTag(next, expression, `<meta ${attribute}="${escapeHtmlAttribute(name)}" content="${safe}">`);
  };
  upsertMeta("name", "description", seo.description);
  upsertMeta("property", "og:title", seo.ogTitle || seo.title);
  upsertMeta("property", "og:description", seo.ogDescription || seo.description);
  upsertMeta("property", "og:image", seo.ogImage);
  upsertMeta("name", "robots", seo.robots);
  if (seo.canonical) {
    next = replaceOrInsertHeadTag(
      next,
      /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i,
      `<link rel="canonical" href="${escapeHtmlAttribute(seo.canonical)}">`
    );
  }
  return next;
}

function validateSourceFile(path, content) {
  const source = String(content || "");
  if (path.toLowerCase().endsWith(".html")) {
    const lower = source.toLowerCase();
    const required = ["<html", "<head", "<body", "</body", "</html"];
    if (required.some((token) => !lower.includes(token))) {
      const error = new Error(`HTML source for ${path} is missing a required document element.`);
      error.status = 400;
      throw error;
    }
    const openScript = (source.match(/<script\b/gi) || []).length;
    const closeScript = (source.match(/<\/script\s*>/gi) || []).length;
    if (openScript !== closeScript) {
      const error = new Error(`HTML source for ${path} has an unclosed script element.`);
      error.status = 400;
      throw error;
    }
    return;
  }
  if (path.toLowerCase().endsWith(".css")) {
    let depth = 0;
    let quote = "";
    let comment = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (comment) {
        if (char === "*" && next === "/") { comment = false; index += 1; }
        continue;
      }
      if (!quote && char === "/" && next === "*") { comment = true; index += 1; continue; }
      if (quote) {
        if (char === "\\") { index += 1; continue; }
        if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth < 0) break;
    }
    if (depth !== 0 || quote || comment) {
      const error = new Error(`CSS source for ${path} has unbalanced braces, quotes, or comments.`);
      error.status = 400;
      throw error;
    }
  }
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
  const responsiveStyles = cleanResponsiveStyleOverrides(input.responsiveStyles);
  const seo = cleanSeo(input.seo);
  const order = cleanOrderOverrides(input.order);
  const elements = cleanElementOverrides(input.elements);

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
    heading, copy, accent, font, text, attributes, styles, responsiveStyles, seo, order, elements,
    supplied: {
      heading: Object.prototype.hasOwnProperty.call(input, "heading"),
      copy: Object.prototype.hasOwnProperty.call(input, "copy"),
      accent: Object.prototype.hasOwnProperty.call(input, "accent"),
      font: Object.prototype.hasOwnProperty.call(input, "font"),
      text: Object.prototype.hasOwnProperty.call(input, "text"),
      attributes: Object.prototype.hasOwnProperty.call(input, "attributes"),
      styles: Object.prototype.hasOwnProperty.call(input, "styles"),
      responsiveStyles: Object.prototype.hasOwnProperty.call(input, "responsiveStyles"),
      seo: Object.prototype.hasOwnProperty.call(input, "seo"),
      order: Object.prototype.hasOwnProperty.call(input, "order"),
      elements: Object.prototype.hasOwnProperty.call(input, "elements")
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
  if (patch.supplied.responsiveStyles) {
    const hasResponsive =
      Object.keys(patch.responsiveStyles.tablet || {}).length ||
      Object.keys(patch.responsiveStyles.mobile || {}).length;
    if (hasResponsive) config.responsiveStyles = patch.responsiveStyles;
    else delete config.responsiveStyles;
  }
  if (patch.supplied.seo) {
    if (Object.values(patch.seo).some(Boolean)) config.seo = patch.seo;
    else delete config.seo;
  }
  if (patch.supplied.order) {
    if (Object.keys(patch.order).length) config.order = patch.order;
    else delete config.order;
  }
  if (patch.supplied.elements) {
    if (patch.elements.length) config.elements = patch.elements;
    else delete config.elements;
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

function validAssetSignature(bytes, extension) {
  const data = new Uint8Array(bytes);
  const ext = String(extension || "").toLowerCase();

  if (ext === "jpg" || ext === "jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (ext === "png") {
    const signature = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    return data.length >= signature.length &&
      signature.every((byte, index) => data[index] === byte);
  }
  if (ext === "webp") {
    return data.length >= 12 &&
      String.fromCharCode(...data.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...data.slice(8, 12)) === "WEBP";
  }
  return false;
}

function decodeAssetBase64(content) {
  try {
    const binary = atob(content);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function cleanAssets(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  let total = 0;

  for (const asset of value.slice(0, 12)) {
    if (!asset || typeof asset !== "object") continue;
    const path = String(asset.path || "").trim();
    const content = String(asset.contentBase64 || "").replace(/\s+/g, "");

    const match = path.match(
      /^assets\/uploads\/([a-z0-9][a-z0-9._-]{0,160})\.(png|jpe?g|webp)$/i
    );
    if (!match || path.includes("..")) {
      const error = new Error("Uploaded assets must be JPG, PNG, or WebP images with a safe filename.");
      error.status = 400;
      throw error;
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
      const error = new Error("Invalid uploaded asset data.");
      error.status = 400;
      throw error;
    }

    const bytes = decodeAssetBase64(content);
    if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_ASSET_BYTES) {
      const error = new Error("Each uploaded asset must be a valid image no larger than 6 MB.");
      error.status = 413;
      throw error;
    }
    if (!validAssetSignature(bytes, match[2])) {
      const error = new Error("Uploaded image contents do not match the file type.");
      error.status = 400;
      throw error;
    }

    total += bytes.byteLength;
    if (total > MAX_ASSET_TOTAL_BYTES) {
      const error = new Error("Draft asset uploads exceed the 20 MB publish limit.");
      error.status = 413;
      throw error;
    }

    output.push({ path, content, size: bytes.byteLength });
  }

  return output;
}


function cleanSourceFiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const output = [];
  let total = 0;

  for (const [rawPath, rawDraft] of Object.entries(value).slice(0, 24)) {
    const path = String(rawPath || "").trim().replace(/^\/+/, "");
    if (
      !path ||
      path.length > 240 ||
      path.includes("..") ||
      !/^[a-z0-9][a-z0-9._/-]*\.(?:html|css)$/i.test(path) ||
      !rawDraft ||
      typeof rawDraft !== "object" ||
      Array.isArray(rawDraft)
    ) {
      continue;
    }

    const kind = path.toLowerCase().endsWith(".css") ? "css" : "html";
    const content = String(rawDraft.content ?? "");
    const max = kind === "css" ? MAX_CSS_CHARS : MAX_HTML_CHARS;
    if (!content.trim() || content.length > max || content.includes("\0")) {
      const error = new Error(`${kind.toUpperCase()} source for ${path} is empty, invalid, or too large.`);
      error.status = 400;
      throw error;
    }

    total += content.length;
    if (total > 1_050_000) {
      const error = new Error("Saved source drafts exceed the publish limit.");
      error.status = 413;
      throw error;
    }

    validateSourceFile(path, content);
    output.push({
      path,
      kind,
      content,
      originalSha: /^[0-9a-f]{40}$/i.test(String(rawDraft.originalSha || ""))
        ? String(rawDraft.originalSha)
        : ""
    });
  }

  return output;
}

function cleanAssetMutations(value) {
  if (!Array.isArray(value)) return [];
  const safePath = (value) => {
    const path = String(value || "").trim();
    if (
      !path.startsWith("assets/") ||
      path.includes("..") ||
      path.length > 240 ||
      !/^[a-z0-9][a-z0-9._/-]*\.(?:png|jpe?g|webp|gif|svg|avif|mp4|webm|mov|pdf)$/i.test(path)
    ) return "";
    return path;
  };

  const output = [];
  for (const raw of value.slice(0, 30)) {
    const action = raw?.action === "rename" ? "rename" : raw?.action === "delete" ? "delete" : "";
    const path = safePath(raw?.path);
    const nextPath = action === "rename" ? safePath(raw?.nextPath) : "";
    if (!action || !path || (action === "rename" && (!nextPath || nextPath === path))) continue;
    output.push({ action, path, nextPath });
  }
  return output;
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

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
    const assetMutations = cleanAssetMutations(input.assetMutations);
    const sourceFiles = cleanSourceFiles(input.sourceDrafts);
    const hasPageChanges = pagePatches.length > 0;
    const hasNavigationChange = Boolean(navigationResult);
    const hasLayoutChange = Boolean(rawLayoutOrders && Object.keys(rawLayoutOrders).length);
    const hasAssets = assets.length > 0;
    const hasAssetMutations = assetMutations.length > 0;
    const hasSourceFiles = sourceFiles.length > 0;

    if (!hasPageChanges && !hasBannerChange && !hasNavigationChange && !hasLayoutChange && !hasAssets && !hasAssetMutations && !hasSourceFiles) {
      return sessionResponse({ error: "No website changes supplied." }, session, 400);
    }

    const files = [];

    for (const sourceFile of sourceFiles) {
      const currentSource = await readTextFile(env, BETA_BRANCH, sourceFile.path);
      if (sourceFile.originalSha && currentSource.sha !== sourceFile.originalSha) {
        const error = new Error(`${sourceFile.path} changed on beta-main while you were editing. Reload before publishing.`);
        error.status = 409;
        throw error;
      }
      if (String(currentSource.content || "") !== sourceFile.content) {
        files.push({ path: sourceFile.path, content: sourceFile.content });
      }
    }

    for (const [pagePath, patch] of pagePatches) {
      if (!patch.supplied.seo || !Object.values(patch.seo).some(Boolean)) continue;
      const htmlPath = pagePath === "/" ? "index.html" : pagePath.replace(/^\/+/, "");
      if (!/\.html$/i.test(htmlPath)) continue;
      const staged = files.find((file) => file.path === htmlPath);
      let source = staged?.content;
      if (typeof source !== "string") {
        const currentHtml = await readTextFile(env, BETA_BRANCH, htmlPath);
        source = String(currentHtml.content || "");
      }
      const withSeo = applySeoToHtml(source, patch.seo);
      validateSourceFile(htmlPath, withSeo);
      if (withSeo !== source) {
        if (staged) staged.content = withSeo;
        else files.push({ path: htmlPath, content: withSeo });
      }
    }

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

    for (const mutation of assetMutations) {
      if (mutation.action === "delete") {
        files.push({ path: mutation.path, delete: true });
        continue;
      }

      const source = await readBase64File(env, BETA_BRANCH, mutation.path);
      if (!source?.contentBase64) {
        const error = new Error(`Unable to read ${mutation.path} for rename.`);
        error.status = 409;
        throw error;
      }
      files.push({
        path: mutation.nextPath,
        content: source.contentBase64,
        encoding: "base64"
      });
      files.push({ path: mutation.path, delete: true });
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

    await recordEditorAudit(session, "editor_publish_beta", {
      commit_sha: result.sha,
      pages: pagePatches.map(([path]) => path),
      navigation_changed: hasNavigationChange,
      layout_changed: hasLayoutChange,
      banner_changed: hasBannerChange,
      asset_paths: assets.map((asset) => asset.path),
      asset_mutations: assetMutations,
      source_paths: sourceFiles.map((file) => file.path)
    });

    return sessionResponse({
      ok: true,
      branch: BETA_BRANCH,
      commitSha: result.sha,
      pagesUpdated: pagePatches.map(([path]) => path),
      overrides: nextOverrides,
      navigation: navigationResult,
      layoutOrders: nextLayout,
      assets: assets.map((asset) => ({ path: asset.path, url: `/${asset.path}` })),
      assetMutations,
      sourceFiles: sourceFiles.map(({ path, kind }) => ({ path, kind }))
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to publish Web Editor changes." },
      session,
      error.status || 500
    );
  }
}
