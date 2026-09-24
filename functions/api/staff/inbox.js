import {
  requireStaff,
  sessionResponse
} from "./_utils.js";

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const db = session.db;
  if (!db?.prepare) {
    return sessionResponse({ error: "Well Support D1 is unavailable." }, session, 503);
  }

  try {
    const [conversationsResult, messagesResult, agentsResult, readsResult] =
      await Promise.all([
        db.prepare(
          "SELECT * FROM support_conversations WHERE status = 'open' ORDER BY updated_at DESC LIMIT 250"
        ).all(),
        db.prepare(
          "SELECT * FROM support_messages ORDER BY created_at DESC LIMIT 1500"
        ).all(),
        db.prepare(
          "SELECT * FROM staff_agents WHERE active = 1 ORDER BY display_name ASC"
        ).all(),
        db.prepare(
          "SELECT * FROM support_conversation_reads WHERE user_id = ?"
        ).bind(session.user.id).all()
      ]);

    const agents = rows(agentsResult).map((agent) => ({
      ...agent,
      avatar_url: agent.avatar_url || null
    }));

    return sessionResponse({
      conversations: rows(conversationsResult),
      messages: rows(messagesResult),
      agents,
      reads: rows(readsResult)
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error?.message || "Unable to load support inbox." },
      session,
      500
    );
  }
}
