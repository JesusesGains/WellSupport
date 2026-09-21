import {
  assertSameOrigin,
  json,
  loginStaff,
  withCookies
} from "./_utils.js";

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const email = String(body.email || "").trim().slice(0, 320);
  const password = String(body.password || "");

  if (!email || !password || password.length > 1024) {
    return json({ error: "Email and password are required." }, 400);
  }

  const result = await loginStaff(env, email, password);
  if (result.response) return result.response;

  return withCookies(
    json({
      user: { id: result.user.id, email: result.user.email || "" },
      agent: result.agent
    }),
    result.cookies
  );
}
