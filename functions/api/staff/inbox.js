import {
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

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  try {
    const [conversations, messages, agents, reads] = await Promise.all([
      restJson(
        `/rest/v1/support_conversations?select=${encodeURIComponent(FIELDS)}&status=eq.open&order=updated_at.desc&limit=250`,
        session
      ),
      restJson(
        "/rest/v1/support_messages?select=id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at&order=created_at.desc&limit=1500",
        session
      ),
      restJson(
        "/rest/v1/support_agents?select=user_id,display_name,avatar_url,active&active=eq.true&order=display_name.asc",
        session
      ),
      restJson(
        `/rest/v1/support_conversation_reads?select=conversation_id,last_read_at&user_id=eq.${encodeURIComponent(session.user.id)}`,
        session
      )
    ]);

    return sessionResponse({
      conversations: Array.isArray(conversations) ? conversations : [],
      messages: Array.isArray(messages) ? messages : [],
      agents: Array.isArray(agents) ? agents : [],
      reads: Array.isArray(reads) ? reads : []
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to load support inbox." },
      session,
      error.status || 500
    );
  }
}
