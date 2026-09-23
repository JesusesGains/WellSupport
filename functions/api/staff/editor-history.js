import {
  requireStaff,
  requireStaffPermission,
  restJson,
  sessionResponse
} from "./_utils.js";
import {
  MAIN_BRANCH,
  REPOSITORY,
  githubRequest
} from "./_github.js";

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  try {
    const commits = await githubRequest(
      env,
      `/repos/${REPOSITORY}/commits?sha=${encodeURIComponent(MAIN_BRANCH)}&per_page=15`
    );

    let audit = [];
    try {
      audit = await restJson(
        "/rest/v1/support_editor_audit?select=id,actor_user_id,actor_display_name,action,details,created_at&order=created_at.desc&limit=30",
        session
      );
    } catch {
      audit = [];
    }

    return sessionResponse({
      branch: MAIN_BRANCH,
      commits: (Array.isArray(commits) ? commits : []).map((item) => ({
        sha: item.sha || null,
        message: String(item.commit?.message || "").split("\n")[0].slice(0, 240),
        authoredAt: item.commit?.author?.date || null,
        author: item.commit?.author?.name || item.author?.login || "Unknown"
      })),
      audit: Array.isArray(audit) ? audit : []
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to load website history." },
      session,
      error.status || 500
    );
  }
}
