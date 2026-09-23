import {
  assertSameOrigin,
  requireStaff,
  requireStaffPermission,
  recordEditorAudit,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  MAIN_BRANCH,
  compareBranches,
  editorStatus,
  mergeBranch
} from "./_github.js";

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  try {
    const comparison = await compareBranches(env);

    if (comparison.behindBy > 0) {
      await mergeBranch(
        env,
        BETA_BRANCH,
        MAIN_BRANCH,
        "Sync production main into beta-main"
      );
      await recordEditorAudit(session, "editor_sync_main_to_beta", {
        behind_by: comparison.behindBy
      });
    }

    return sessionResponse({
      ok: true,
      status: await editorStatus(env)
    }, session);
  } catch (error) {
    return sessionResponse(
      {
        error:
          error.status === 409
            ? "beta-main has merge conflicts with main. Resolve them in GitHub before continuing."
            : error.message || "Unable to sync beta-main."
      },
      session,
      error.status || 500
    );
  }
}
