import {
  requireStaff,
  requireStaffPermission,
  sessionResponse
} from "./_utils.js";
import { editorStatus } from "./_github.js";

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  try {
    const status = await editorStatus(env);
    return sessionResponse({ status }, session);
  } catch (error) {
    if (error.code === "github_not_connected") {
      return sessionResponse({
        status: {
          connected: false,
          requiredSecret: "WELLWEBSITE_GITHUB_TOKEN"
        }
      }, session);
    }

    return sessionResponse(
      { error: error.message || "Unable to load Web Editor status." },
      session,
      error.status || 500
    );
  }
}
