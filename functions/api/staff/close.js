import {
  assertSameOrigin,
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));
  const conversationId = String(input.conversationId || "");

  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return sessionResponse({ error: "Invalid conversation." }, session, 400);
  }

  try {
    const rows = await restJson(
      `/rest/v1/support_conversations?id=eq.${encodeURIComponent(conversationId)}&joined_agent_id=eq.${encodeURIComponent(session.user.id)}&select=id`,
      session,
      {
        method: "DELETE",
        headers: { Prefer: "return=representation" }
      }
    );

    if (!Array.isArray(rows) || !rows.length) {
      return sessionResponse(
        { error: "Only the staff member handling this chat can close it." },
        session,
        409
      );
    }

    return sessionResponse({ ok: true }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to close chat." },
      session,
      error.status || 500
    );
  }
}
