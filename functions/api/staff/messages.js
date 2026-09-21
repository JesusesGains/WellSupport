import {
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const url = new URL(request.url);
  const conversationId = String(url.searchParams.get("conversationId") || "");

  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
    return sessionResponse({ error: "Invalid conversation." }, session, 400);
  }

  try {
    const messages = await restJson(
      `/rest/v1/support_messages?select=id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at&conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=500`,
      session
    );

    return sessionResponse({
      messages: Array.isArray(messages) ? messages : []
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to load messages." },
      session,
      error.status || 500
    );
  }
}
