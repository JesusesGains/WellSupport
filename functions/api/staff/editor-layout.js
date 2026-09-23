import { requireStaff, requireStaffPermission, sessionResponse } from "./_utils.js";
import { BETA_BRANCH, MAIN_BRANCH, readTextFile } from "./_github.js";

const LAYOUT_PATH = "src/data/editorLayout.json";

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  const url = new URL(request.url);
  const target = url.searchParams.get("target") === "production" ? "production" : "beta";
  const branch = target === "production" ? MAIN_BRANCH : BETA_BRANCH;

  try {
    const file = await readTextFile(env, branch, LAYOUT_PATH);
    return sessionResponse(
      {
        target,
        branch,
        sha: file.sha,
        layoutOrders: JSON.parse(file.content)
      },
      session
    );
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to read website layout source." },
      session,
      error.status || 500
    );
  }
}
