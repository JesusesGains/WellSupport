import {
  assertSameOrigin,
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

const FIELDS = [
  "id","status","page_path","created_at","updated_at","client_ip",
  "visitor_city","visitor_region","visitor_country","visitor_country_code",
  "visitor_timezone","browser_language","user_agent","staff_joined_at",
  "joined_agent_id"
].join(",");

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.conversationId || "");

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return sessionResponse({ error: "Invalid conversation." }, session, 400);
  }

  try {
    const joinedAt = new Date().toISOString();

    const rows = await restJson(
      `/rest/v1/support_conversations?id=eq.${encodeURIComponent(id)}&status=eq.open&staff_joined_at=is.null&select=${encodeURIComponent(FIELDS)}`,
      session,
      {
        method: "PATCH",
        body: {
          staff_joined_at: joinedAt,
          joined_agent_id: session.user.id,
          updated_at: joinedAt
        },
        headers: { Prefer: "return=representation" }
      }
    );

    const conversation = Array.isArray(rows) ? rows[0] || null : null;

    if (!conversation) {
      return sessionResponse({ conversation: null, message: null }, session);
    }

    const staffName = session.agent.display_name || "Staff member";
    const messages = await restJson(
      "/rest/v1/support_messages?select=id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at",
      session,
      {
        method: "POST",
        body: {
          conversation_id: id,
          sender_type: "system",
          sender_user_id: session.user.id,
          sender_display_name: staffName,
          sender_avatar_url: session.agent.avatar_url || null,
          body: `${staffName} has joined your chat`
        },
        headers: { Prefer: "return=representation" }
      }
    );

    return sessionResponse({
      conversation,
      message: Array.isArray(messages) ? messages[0] || null : null
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to join conversation." },
      session,
      error.status || 500
    );
  }
}
