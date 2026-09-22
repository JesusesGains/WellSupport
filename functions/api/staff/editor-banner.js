import {
  assertSameOrigin,
  requireStaff,
  sessionResponse
} from "./_utils.js";
import {
  MAIN_BRANCH,
  BETA_BRANCH,
  readOverrides,
  writeOverrides
} from "./_github.js";

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function cleanColour(value, fallback) {
  const colour = cleanText(value, 16);
  return /^#[0-9a-f]{6}$/i.test(colour) ? colour.toUpperCase() : fallback;
}

function cleanHref(value) {
  const href = cleanText(value, 400);
  if (!href) return "";

  if (
    href.startsWith("/") ||
    /^[a-z0-9][a-z0-9._/-]*\.html(?:[?#].*)?$/i.test(href)
  ) {
    return href;
  }

  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanDate(value) {
  const raw = cleanText(value, 40);
  if (!raw) return "";

  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString();
}

function cleanItems(value) {
  if (!Array.isArray(value)) return [];

  const output = [];
  for (const [index, item] of value.slice(0, 10).entries()) {
    if (!item || typeof item !== "object") continue;

    const message = cleanText(item.message, 150);
    if (!message) continue;

    const startsAt = cleanDate(item.startsAt);
    const endsAt = cleanDate(item.endsAt);
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      continue;
    }

    output.push({
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

  return output;
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  return sessionResponse(
    {
      error:
        "Banner edits are a local draft. Publish beta preview from the top-right to create the beta-main commit/build."
    },
    session,
    409
  );
}
