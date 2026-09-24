import {
  assertSameOrigin,
  requireStaff,
  sessionResponse
} from "./_utils.js";
import { insertSupportMessage } from "./_d1_messages.js";

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

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));
  const id = String(input.conversationId || "");

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return sessionResponse({ error: "Invalid conversation." }, session, 400);
  }

  try {
    const current = await session.db
      .prepare("SELECT * FROM support_conversations WHERE id = ? LIMIT 1")
      .bind(id)
      .first();

    if (!current || current.status !== "open") {
      return sessionResponse({ conversation: null, message: null }, session);
    }

    if (current.joined_agent_id && current.joined_agent_id !== session.user.id) {
      return sessionResponse({ conversation: null, message: null }, session);
    }

    if (current.joined_agent_id === session.user.id) {
      return sessionResponse({ conversation: current, message: null }, session);
    }

    const joinedAt = new Date().toISOString();
    const update = await session.db
      .prepare(
        "UPDATE support_conversations SET staff_joined_at = ?, joined_agent_id = ?, updated_at = ? WHERE id = ? AND status = 'open' AND joined_agent_id IS NULL"
      )
      .bind(joinedAt, session.user.id, joinedAt, id)
      .run();

    if (!update?.success || Number(update?.meta?.changes || 0) < 1) {
      return sessionResponse({ conversation: null, message: null }, session);
    }

    const staffName = session.agent.display_name || "Staff member";

    const message = await insertSupportMessage(session.db, {
      id: crypto.randomUUID(),
      conversation_id: id,
      sender_type: "system",
      sender_user_id: session.user.id,
      sender_display_name: staffName,
      sender_avatar_url: session.agent.avatar_url || null,
      client_message_id: null,
      body: `${staffName} has joined your chat`,
      created_at: joinedAt
    });

    const conversation = await session.db
      .prepare("SELECT * FROM support_conversations WHERE id = ? LIMIT 1")
      .bind(id)
      .first();

    await notifySupportRoom(env, id, { type: "conversation", conversation });
    await notifySupportRoom(env, id, { type: "message", message });

    return sessionResponse({ conversation, message }, session);
  } catch (error) {
    return sessionResponse(
      { error: error?.message || "Unable to join conversation." },
      session,
      500
    );
  }
}
