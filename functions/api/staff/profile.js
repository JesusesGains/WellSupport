import {
  assertSameOrigin,
  requireStaff,
  restJson,
  sessionResponse
} from "./_utils.js";

export async function onRequestPost({ request }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));
  const displayName = String(input.displayName || "").trim();

  if (!displayName || displayName.length > 120) {
    return sessionResponse(
      { error: "Display name must be between 1 and 120 characters." },
      session,
      400
    );
  }

  const update = { display_name: displayName };
  if (Object.prototype.hasOwnProperty.call(input, "avatarUrl")) {
    update.avatar_url = input.avatarUrl ? String(input.avatarUrl).slice(0, 2048) : null;
  }

  try {
    const rows = await restJson(
      `/rest/v1/support_agents?user_id=eq.${encodeURIComponent(session.user.id)}&select=user_id,display_name,avatar_url,active`,
      session,
      {
        method: "PATCH",
        body: update,
        headers: { Prefer: "return=representation" }
      }
    );

    return sessionResponse({
      agent: Array.isArray(rows) ? rows[0] || null : null
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to update staff profile." },
      session,
      error.status || 500
    );
  }
}
