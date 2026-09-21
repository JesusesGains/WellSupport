import {
  assertSameOrigin,
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

const MESSAGE_FIELDS = [
  "id",
  "conversation_id",
  "sender_type",
  "sender_user_id",
  "sender_display_name",
  "sender_avatar_url",
  "client_message_id",
  "body",
  "created_at"
].join(",");

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findExisting(session, conversationId, clientMessageId) {
  if (!clientMessageId) return null;

  const rows = await restJson(
    `/rest/v1/support_messages?select=${encodeURIComponent(MESSAGE_FIELDS)}&conversation_id=eq.${encodeURIComponent(conversationId)}&client_message_id=eq.${encodeURIComponent(clientMessageId)}&limit=1`,
    session
  );

  return Array.isArray(rows) ? rows[0] || null : null;
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
      session,
      conversationId,
      clientMessageId
    );

    if (existing) {
      return sessionResponse({ message: existing, duplicate: true }, session);
    }

    const rows = await restJson(
      `/rest/v1/support_messages?select=${encodeURIComponent(MESSAGE_FIELDS)}`,
      session,
      {
        method: "POST",
        body: {
          conversation_id: conversationId,
          sender_type: "agent",
          sender_user_id: session.user.id,
          sender_display_name: session.agent.display_name,
          sender_avatar_url: session.agent.avatar_url || null,
          client_message_id: clientMessageId || null,
          body
        },
        headers: { Prefer: "return=representation" }
      }
    );

    return sessionResponse({
      message: Array.isArray(rows) ? rows[0] || null : null,
      duplicate: false
    }, session);
  } catch (error) {
    if (clientMessageId) {
      try {
        const existing = await findExisting(
          session,
          conversationId,
          clientMessageId
        );

        if (existing) {
          return sessionResponse(
            { message: existing, duplicate: true },
            session
          );
        }
      } catch {
        // Preserve the original send failure below.
      }
    }

    return sessionResponse(
      { error: error.message || "Unable to send reply." },
      session,
      error.status || 500
    );
  }
}
