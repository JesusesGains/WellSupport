import {
  assertSameOrigin,
  recordEditorAudit,
  requireStaff,
  requireStaffPermission,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  REPOSITORY,
  commitFiles,
  githubRequest,
  readTextFile
} from "./_github.js";

const MAX_CHANGES = 4;
const MAX_FILE_CHARS = 500000;
const MAX_REPLACEMENT_CHARS = 60000;

function editableSourcePath(path) {
  const value = String(path || "").trim();
  if (
    !value ||
    value.includes("..") ||
    /^(?:\.github\/|supabase\/|functions\/)/i.test(value) ||
    /(?:^|\/)(?:package(?:-lock)?\.json|wrangler\.[^/]*|vite\.config\.[^/]*|worker\.js|_headers|_redirects)$/i.test(value)
  ) {
    return false;
  }

  return (
    /^[a-z0-9][a-z0-9._-]*\.html$/i.test(value) ||
    /^[a-z0-9][a-z0-9._-]*\.(?:css|js)$/i.test(value) ||
    /^(?:src|assets)\/[a-z0-9][a-z0-9._/-]*\.(?:css|js|jsx|ts|tsx)$/i.test(value)
  );
}

async function betaHead(env) {
  const branch = await githubRequest(
    env,
    `/repos/${REPOSITORY}/branches/${encodeURIComponent(BETA_BRANCH)}`
  );
  return branch.commit?.sha || null;
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const denied =
    requireStaffPermission(session, "editor") ||
    requireStaffPermission(session, "dev_ai");
  if (denied) return denied;

  const input = await request.json().catch(() => ({}));
  const expectedBetaSha = String(input.expectedBetaSha || "").trim();
  const rawChanges = Array.isArray(input.changes)
    ? input.changes.slice(0, MAX_CHANGES)
    : [];

  if (!expectedBetaSha || !/^[0-9a-f]{40}$/i.test(expectedBetaSha)) {
    return sessionResponse({ error: "A reviewed beta commit is required." }, session, 400);
  }
  if (!rawChanges.length) {
    return sessionResponse({ error: "No code changes were supplied." }, session, 400);
  }

  try {
    let currentHead = await betaHead(env);
    if (currentHead !== expectedBetaSha) {
      return sessionResponse(
        {
          error: "beta-main changed after this AI patch was generated. Ask Developer AI to regenerate the change.",
          code: "beta_sha_changed",
          currentBetaSha: currentHead
        },
        session,
        409
      );
    }

    const files = [];
    const auditChanges = [];
    let replacementChars = 0;

    for (const item of rawChanges) {
      if (!item || typeof item !== "object") {
        return sessionResponse({ error: "Invalid AI code change." }, session, 400);
      }

      const path = String(item.path || "").trim();
      const find = String(item.find || "");
      const replace = String(item.replace ?? "");
      const reason = String(item.reason || "").trim().slice(0, 400);

      if (!editableSourcePath(path) || !find) {
        return sessionResponse(
          { error: `Developer AI is not allowed to modify ${path || "that file"}.` },
          session,
          400
        );
      }
      if (find.length > 12000 || replace.length > 24000) {
        return sessionResponse({ error: "AI source patch is too large." }, session, 413);
      }

      replacementChars += replace.length;
      if (replacementChars > MAX_REPLACEMENT_CHARS) {
        return sessionResponse({ error: "Combined AI source patch is too large." }, session, 413);
      }

      const file = await readTextFile(env, expectedBetaSha, path);
      const source = String(file.content || "");
      if (source.length > MAX_FILE_CHARS) {
        return sessionResponse({ error: `${path} is too large for AI patching.` }, session, 413);
      }

      const first = source.indexOf(find);
      if (first < 0 || first !== source.lastIndexOf(find)) {
        return sessionResponse(
          {
            error: `The expected source in ${path} is no longer a unique match. Regenerate the AI patch.`,
            code: "patch_context_changed"
          },
          session,
          409
        );
      }

      files.push({
        path,
        content: source.slice(0, first) + replace + source.slice(first + find.length)
      });
      auditChanges.push({ path, reason });
    }

    currentHead = await betaHead(env);
    if (currentHead !== expectedBetaSha) {
      return sessionResponse(
        {
          error: "beta-main changed while the patch was being checked. Regenerate the AI patch.",
          code: "beta_sha_changed",
          currentBetaSha: currentHead
        },
        session,
        409
      );
    }

    const committed = await commitFiles(
      env,
      BETA_BRANCH,
      files,
      "Developer AI: apply reviewed beta source patch"
    );

    await recordEditorAudit(session, "dev_ai_apply_beta", {
      source_beta_sha: expectedBetaSha,
      commit_sha: committed.sha,
      changes: auditChanges
    });

    return sessionResponse({
      ok: true,
      branch: BETA_BRANCH,
      commitSha: committed.sha,
      files: files.map((file) => file.path)
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to apply the Developer AI patch." },
      session,
      error.status || 500
    );
  }
}
