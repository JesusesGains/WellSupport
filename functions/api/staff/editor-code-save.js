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

const MAX_HTML_CHARS = 350000;

function cleanPage(value) {
  const raw = String(value || "/").trim();
  if (!raw.startsWith("/") || raw.includes("?") || raw.includes("#")) return null;

  const path =
    raw === "/" || raw === "/index.html"
      ? "index.html"
      : raw.replace(/^\/+/, "");

  if (
    path.length > 240 ||
    path.includes("..") ||
    !/^[a-z0-9][a-z0-9._/-]*\.html$/i.test(path)
  ) {
    return null;
  }

  return path;
}

function validateHtmlSource(path, content) {
  const source = String(content || "");
  const lower = source.toLowerCase();
  const required = ["<html", "<head", "<body", "</body", "</html"];
  if (required.some((token) => !lower.includes(token))) {
    const error = new Error(`HTML source for ${path} is missing a required document element.`);
    error.status = 400;
    throw error;
  }
  const openScript = (source.match(/<script\b/gi) || []).length;
  const closeScript = (source.match(/<\/script\s*>/gi) || []).length;
  if (openScript !== closeScript) {
    const error = new Error(`HTML source for ${path} has an unclosed script element.`);
    error.status = 400;
    throw error;
  }
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

  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  const input = await request.json().catch(() => ({}));
  const page = cleanPage(input.page);
  const expectedBetaSha = String(input.expectedBetaSha || "").trim();
  const expectedFileSha = String(input.expectedFileSha || "").trim();
  const content = String(input.content ?? "");

  if (!page) {
    return sessionResponse({ error: "Invalid website page." }, session, 400);
  }

  if (!/^[0-9a-f]{40}$/i.test(expectedBetaSha)) {
    return sessionResponse({ error: "A current beta commit is required." }, session, 400);
  }

  if (!content.trim() || content.length > MAX_HTML_CHARS || content.includes("\0")) {
    return sessionResponse(
      { error: "HTML source is empty, invalid, or exceeds the 350 KB limit." },
      session,
      400
    );
  }

  try {
    validateHtmlSource(page, content);
    let currentBetaSha = await betaHead(env);
    if (currentBetaSha !== expectedBetaSha) {
      return sessionResponse(
        {
          error: "beta-main changed while you were editing. Reload the code before saving.",
          code: "beta_sha_changed",
          currentBetaSha
        },
        session,
        409
      );
    }

    const currentFile = await readTextFile(env, expectedBetaSha, page);
    if (expectedFileSha && currentFile.sha !== expectedFileSha) {
      return sessionResponse(
        {
          error: "This page source changed while you were editing. Reload before saving.",
          code: "source_file_changed"
        },
        session,
        409
      );
    }

    if (String(currentFile.content || "") === content) {
      return sessionResponse(
        { error: "There are no source changes to save." },
        session,
        409
      );
    }

    currentBetaSha = await betaHead(env);
    if (currentBetaSha !== expectedBetaSha) {
      return sessionResponse(
        {
          error: "beta-main changed while the source was being checked. Reload before saving.",
          code: "beta_sha_changed",
          currentBetaSha
        },
        session,
        409
      );
    }

    const committed = await commitFiles(
      env,
      BETA_BRANCH,
      [{ path: page, content }],
      `Web Editor code: update ${page}`
    );

    await recordEditorAudit(session, "editor_code_publish_beta", {
      page,
      previous_beta_sha: expectedBetaSha,
      commit_sha: committed.sha
    });

    return sessionResponse({
      ok: true,
      branch: BETA_BRANCH,
      page,
      commitSha: committed.sha
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to save website source." },
      session,
      error.status || 500
    );
  }
}
