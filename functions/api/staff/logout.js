import {
  assertSameOrigin,
  json
} from "./_utils.js";

export async function onRequestPost({ request }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  return json({
    ok: true,
    logoutUrl: "/cdn-cgi/access/logout"
  });
}
