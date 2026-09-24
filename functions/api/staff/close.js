import {
  assertSameOrigin,
  requireStaff,
  sessionResponse
} from "./_utils.js";

async function notifySupportRoom(env, conversationId, event) {
  const namespace = env?.SUPPORT_CHAT;
  if (!namespace?.idFromName || !namespace?.get || !conversationId) return;
  try {
    const id = namespace.idFromName(String(conversationId));
    await namespace.get(id).fetch("https://support-chat.internal/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event)
    });
  } catch {
    // D1 deletion is authoritative.
  }
}

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
    const conversation = await session.db
      .prepare(
        "SELECT * FROM support_conversations WHERE id = ? AND joined_agent_id = ? LIMIT 1"
      )
      .bind(conversationId, session.user.id)
      .first();

    if (!conversation) {
      return sessionResponse(
        { error: "Only the staff member handling this chat can close it." },
        session,
        409
      );
    }

    await session.db
      .prepare("DELETE FROM support_conversation_reads WHERE conversation_id = ?")
      .bind(conversationId)
      .run();
    await session.db
      .prepare("DELETE FROM support_messages WHERE conversation_id = ?")
      .bind(conversationId)
      .run();
    await session.db
      .prepare(
        "DELETE FROM support_conversations WHERE id = ? AND joined_agent_id = ?"
      )
      .bind(conversationId, session.user.id)
      .run();

    await notifySupportRoom(env, conversationId, {
      type: "conversation",
      conversation: {
        id: conversationId,
        status: "closed",
        deleted: true,
        updated_at: new Date().toISOString()
      }
    });

    return sessionResponse({ ok: true }, session);
  } catch (error) {
    return sessionResponse(
      { error: error?.message || "Unable to close chat." },
      session,
      500
    );
  }
}
