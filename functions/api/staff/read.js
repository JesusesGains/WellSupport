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
      "/rest/v1/support_conversation_reads?on_conflict=conversation_id,user_id&select=conversation_id,last_read_at",
      session,
      {
        method: "POST",
        body: {
          conversation_id: conversationId,
          user_id: session.user.id,
          last_read_at: new Date().toISOString()
        },
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        }
      }
    );

    return sessionResponse({
      read: Array.isArray(rows) ? rows[0] || null : null
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to update read state." },
      session,
      error.status || 500
    );
  }
}
