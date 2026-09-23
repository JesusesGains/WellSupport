import {
  assertSameOrigin,
  recordEditorAudit,
  requireStaff,
  requireStaffPermission,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  MAIN_BRANCH,
  REPOSITORY,
  editorStatus,
  githubRequest,
  restoreBranchTree
} from "./_github.js";

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "publish");
  if (denied) return denied;

  const input = await request.json().catch(() => ({}));
  const sourceSha = String(input.sourceSha || "").trim();
  const expectedMainSha = String(input.expectedMainSha || "").trim();

  if (input.confirm !== "STAGE_PRODUCTION_RESTORE") {
    return sessionResponse({ error: "Restore confirmation is required." }, session, 400);
  }
  if (!/^[0-9a-f]{40}$/i.test(sourceSha) || !/^[0-9a-f]{40}$/i.test(expectedMainSha)) {
    return sessionResponse({ error: "Invalid website version." }, session, 400);
  }

  try {
    const status = await editorStatus(env);
    if (status.main?.sha !== expectedMainSha) {
      return sessionResponse(
        {
          error: "Production changed after history was loaded. Refresh version history before restoring.",
          code: "main_sha_changed",
          currentMainSha: status.main?.sha || null
        },
        session,
        409
      );
    }

    const comparison = status.comparison || {};
    if (Number(comparison.aheadBy || 0) > 0 || Number(comparison.behindBy || 0) > 0) {
      return sessionResponse(
        {
          error: "beta-main must match production before staging a restore. Review or sync the existing beta changes first.",
          code: "beta_not_clean"
        },
        session,
        409
      );
    }

    const ancestry = await githubRequest(
      env,
      `/repos/${REPOSITORY}/compare/${encodeURIComponent(sourceSha)}...${encodeURIComponent(MAIN_BRANCH)}`
    );

    if (!["ahead", "identical"].includes(String(ancestry.status || ""))) {
      return sessionResponse(
        { error: "That commit is not a production-history version that can be restored." },
        session,
        400
      );
    }

    if (sourceSha === expectedMainSha) {
      return sessionResponse({ error: "Production is already on that version." }, session, 409);
    }

    const result = await restoreBranchTree(
      env,
      BETA_BRANCH,
      sourceSha,
      `Restore preview to production version ${sourceSha.slice(0, 7)}`
    );

    await recordEditorAudit(session, "editor_stage_restore_beta", {
      source_production_sha: sourceSha,
      previous_main_sha: expectedMainSha,
      beta_commit_sha: result.sha
    });

    return sessionResponse({
      ok: true,
      branch: BETA_BRANCH,
      commitSha: result.sha,
      restoredFromSha: sourceSha,
      status: await editorStatus(env)
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to stage the selected website version." },
      session,
      error.status || 500
    );
  }
}
