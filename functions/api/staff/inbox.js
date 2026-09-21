import {
  json,
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

export async function onRequestGet({ request }) {
  const session = await requireStaff(request);
  if (session.response) return session.response;

  try {
    const conversations = await restJson(
      `/rest/v1/support_conversations?select=${encodeURIComponent(FIELDS)}&order=created_at.desc&limit=250`,
      session
    );

    const messages = await restJson(
      "/rest/v1/support_messages?select=id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at&order=created_at.desc&limit=1000",
      session
    );

    return sessionResponse({
      conversations: Array.isArray(conversations) ? conversations : [],
      messages: Array.isArray(messages) ? messages : []
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to load support inbox." },
      session,
      error.status || 500
    );
  }
}
