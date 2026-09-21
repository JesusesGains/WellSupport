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
  const body = String(input.body || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return sessionResponse({ error: "Invalid conversation." }, session, 400);
  }

  if (!body || body.length > 4000) {
    return sessionResponse(
      { error: "Reply must be between 1 and 4000 characters." },
      session,
      400
    );
  }

  try {
    const rows = await restJson(
      "/rest/v1/support_messages?select=id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at",
      session,
      {
        method: "POST",
        body: {
          conversation_id: conversationId,
          sender_type: "agent",
          sender_user_id: session.user.id,
          sender_display_name: session.agent.display_name,
          sender_avatar_url: session.agent.avatar_url || null,
          body
        },
        headers: { Prefer: "return=representation" }
      }
    );

    return sessionResponse({
      message: Array.isArray(rows) ? rows[0] || null : null
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to send reply." },
      session,
      error.status || 500
    );
  }
}
