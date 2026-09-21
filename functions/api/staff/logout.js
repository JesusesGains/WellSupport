import {
  assertSameOrigin,
  clearSessionCookies,
  json,
  withCookies
} from "./_utils.js";

export async function onRequestPost({ request }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return withCookies(
    json({ ok: true }),
    clearSessionCookies()
  );
}
