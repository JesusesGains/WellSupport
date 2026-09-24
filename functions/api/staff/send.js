import {
  assertSameOrigin,
  requireStaff,
  sessionResponse
} from "./_utils.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
    // Polling is the reliable fallback.
  }
}

async function findExisting(db, conversationId, clientMessageId) {
  if (!clientMessageId) return null;
  return db
    .prepare(
      "SELECT * FROM support_messages WHERE conversation_id = ? AND client_message_id = ? LIMIT 1"
    )
    .bind(conversationId, clientMessageId)
    .first();
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));
  const conversationId = String(input.conversationId || "");
  const clientMessageId = String(input.clientMessageId || "").trim();
  const body = String(input.body || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return sessionResponse({ error: "Invalid conversation." }, session, 400);
  }

  if (clientMessageId && !validUuid(clientMessageId)) {
    return sessionResponse({ error: "Invalid client message ID." }, session, 400);
  }

  if (!body || body.length > 4000) {
    return sessionResponse(
      { error: "Reply must be between 1 and 4000 characters." },
      session,
      400
    );
  }

  try {
    const existing = await findExisting(
      session.db,
      conversationId,
      clientMessageId
    );
    if (existing) {
      return sessionResponse({ message: existing, duplicate: true }, session);
    }

    const conversation = await session.db
      .prepare(
        "SELECT * FROM support_conversations WHERE id = ? AND status = 'open' LIMIT 1"
      )
      .bind(conversationId)
      .first();

    if (!conversation) {
      return sessionResponse({ error: "Conversation is no longer open." }, session, 409);
    }

    if (conversation.joined_agent_id !== session.user.id) {
      return sessionResponse(
        { error: "Join this conversation before replying." },
        session,
        409
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await session.db
      .prepare(
        `INSERT INTO support_messages (
          id, conversation_id, sender_type, sender_user_id,
          sender_display_name, sender_avatar_url, client_message_id, body, created_at
        ) VALUES (?, ?, 'agent', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        conversationId,
        session.user.id,
        session.agent.display_name,
        session.agent.avatar_url || null,
        clientMessageId || null,
        body,
        now
      )
      .run();

    await session.db
      .prepare("UPDATE support_conversations SET updated_at = ? WHERE id = ?")
      .bind(now, conversationId)
      .run();

    const message = await session.db
      .prepare("SELECT * FROM support_messages WHERE id = ? LIMIT 1")
      .bind(id)
      .first();

    await notifySupportRoom(env, conversationId, { type: "message", message });

    return sessionResponse({ message, duplicate: false }, session);
  } catch (error) {
    if (clientMessageId) {
      try {
        const existing = await findExisting(
          session.db,
          conversationId,
          clientMessageId
        );
        if (existing) {
          return sessionResponse({ message: existing, duplicate: true }, session);
        }
      } catch {
        // Preserve the original error.
      }
    }

    return sessionResponse(
      { error: error?.message || "Unable to send reply." },
      session,
      500
    );
  }
}
