import {
  assertSameOrigin,
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

export async function onRequestPost({ request }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));
  const conversationId = String(input.conversationId || "");

  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return sessionResponse({ error: "Invalid conversation." }, session, 400);
  }

  try {
    await restJson(
      `/rest/v1/support_conversations?id=eq.${encodeURIComponent(conversationId)}`,
      session,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      }
    );

    return sessionResponse({ ok: true }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to close chat." },
      session,
      error.status || 500
    );
  }
}
