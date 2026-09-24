import {
  assertSameOrigin,
  requireStaff,
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
    const lastReadAt = new Date().toISOString();

    await session.db
      .prepare(
        `INSERT INTO support_conversation_reads (
          conversation_id, user_id, last_read_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(conversation_id, user_id)
        DO UPDATE SET last_read_at = excluded.last_read_at`
      )
      .bind(conversationId, session.user.id, lastReadAt)
      .run();

    return sessionResponse({
      read: {
        conversation_id: conversationId,
        user_id: session.user.id,
        last_read_at: lastReadAt
      }
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error?.message || "Unable to update read state." },
      session,
      500
    );
  }
}
