import {
  assertSameOrigin,
  requireStaff,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  MAIN_BRANCH,
  compareBranches,
  editorStatus,
  mergeBranch,
  moveBranchForward
} from "./_github.js";

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const input = await request.json().catch(() => ({}));
  if (input.confirm !== "PROMOTE_BETA_TO_MAIN") {
    return sessionResponse(
      { error: "Production promotion confirmation is required." },
      session,
      400
    );
  }

  try {
    const comparison = await compareBranches(env);

    if (comparison.behindBy > 0) {
      return sessionResponse(
        {
          error: "beta-main is behind main. Sync beta before promoting.",
          code: "beta_behind"
        },
        session,
        409
      );
    }

    if (comparison.aheadBy < 1) {
      return sessionResponse(
        { error: "There are no beta changes to promote." },
        session,
        409
      );
    }

    const merged = await mergeBranch(
      env,
      MAIN_BRANCH,
      BETA_BRANCH,
      "Promote approved beta-main website changes to production"
    );

    const productionSha = merged.sha || null;
    if (productionSha) {
      await moveBranchForward(env, BETA_BRANCH, productionSha);
    }

    return sessionResponse({
      ok: true,
      productionSha,
      status: await editorStatus(env)
    }, session);
  } catch (error) {
    return sessionResponse(
      {
        error:
          error.status === 409
            ? "GitHub could not promote beta-main cleanly. Review the branch before retrying."
            : error.message || "Unable to promote beta-main to production."
      },
      session,
      error.status || 500
    );
  }
}
