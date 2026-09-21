import {
  assertSameOrigin,
  clearSessionCookies,
  json,
  revokeCurrentSession,
  withCookies
} from "./_utils.js";

export async function onRequestPost({ request }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  await revokeCurrentSession(request);

  return withCookies(
    json({ ok: true }),
    clearSessionCookies()
  );
}
