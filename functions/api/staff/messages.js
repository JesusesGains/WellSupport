import {
  requireStaff,
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
    const result = await session.db
      .prepare(
        "SELECT * FROM support_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500"
      )
      .bind(conversationId)
      .all();

    return sessionResponse({
      messages: Array.isArray(result?.results) ? result.results : []
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error?.message || "Unable to load messages." },
      session,
      500
    );
  }
}
