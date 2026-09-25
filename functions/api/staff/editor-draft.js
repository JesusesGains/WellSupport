import {
  assertSameOrigin,
  requireStaff,
  requireStaffPermission,
  restJson,
  sessionResponse
} from "./_utils.js";
import { editorStatus } from "./_github.js";

const WORKSPACE = "wellwebsite-beta";
const MAX_DRAFT_CHARS = 1_250_000;

function cleanPages(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([path, draft]) =>
        typeof path === "string" &&
        path.startsWith("/") &&
        path.length <= 240 &&
        !path.includes("?") &&
        !path.includes("#") &&
        draft &&
        typeof draft === "object" &&
        !Array.isArray(draft)
      )
      .slice(0, 30)
  );
}

function cleanPlainObject(value, maxEntries = 80) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) =>
        typeof key === "string" &&
        key.length <= 500 &&
        item !== undefined
      )
      .slice(0, maxEntries)
  );
}

function cleanSourceDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  let total = 0;

  for (const [rawPath, rawDraft] of Object.entries(value).slice(0, 24)) {
    const path = String(rawPath || "").trim().replace(/^\/+/, "");
    if (
      !path ||
      path.length > 240 ||
      path.includes("..") ||
      !/^[a-z0-9][a-z0-9._/-]*\.(?:html|css)$/i.test(path) ||
      !rawDraft ||
      typeof rawDraft !== "object" ||
      Array.isArray(rawDraft)
    ) {
      continue;
    }

    const content = String(rawDraft.content ?? "");
    const max = path.toLowerCase().endsWith(".css") ? 650000 : 350000;
    if (!content || content.length > max || content.includes("\0")) continue;

    total += content.length;
    if (total > 1_050_000) break;

    output[path] = {
      path,
      kind: path.toLowerCase().endsWith(".css") ? "css" : "html",
      content,
      originalSha: /^[0-9a-f]{40}$/i.test(String(rawDraft.originalSha || ""))
        ? String(rawDraft.originalSha)
        : ""
    };
  }

  return output;
}

function cleanWorkspaceState(input) {
  return {
    pages: cleanPages(input.pages),
    navigation: cleanPlainObject(input.navigation, 12),
    layoutOrders: cleanPlainObject(input.layoutOrders, 80),
    banner:
      input.banner && typeof input.banner === "object" && !Array.isArray(input.banner)
        ? input.banner
        : {},
    sourceDrafts: cleanSourceDrafts(input.sourceDrafts)
  };
}

async function currentDraft(session) {
  const rows = await restJson(
    `/rest/v1/support_editor_drafts?workspace=eq.${encodeURIComponent(WORKSPACE)}&select=workspace,base_sha,payload,revision,updated_by,updated_at&limit=1`,
    session
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  try {
    const draft = await currentDraft(session);
    return sessionResponse({ draft }, session);
  } catch (error) {
    // Shared drafts are an enhancement. If the schema migration has not been
    // applied yet, the visual editor continues to work with its local draft.
    if ([400, 404].includes(Number(error.status || 0))) {
      return sessionResponse({
        draft: null,
        available: false
      }, session);
    }
    return sessionResponse(
      { error: error.message || "Unable to load the shared editor draft." },
      session,
      error.status || 500
    );
  }
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  const input = await request.json().catch(() => ({}));
  const baseSha = String(input.baseSha || "").trim();
  const expectedRevision = Math.max(0, Number(input.revision || 0));
  const payload = cleanWorkspaceState(input);
  const serialised = JSON.stringify(payload);

  if (!/^[0-9a-f]{40}$/i.test(baseSha)) {
    return sessionResponse({ error: "A current beta commit is required." }, session, 400);
  }
  if (serialised.length > MAX_DRAFT_CHARS) {
    return sessionResponse({ error: "The shared website draft is too large." }, session, 413);
  }

  try {
    const status = await editorStatus(env);
    if (status.beta?.sha !== baseSha) {
      return sessionResponse(
        {
          error: "beta-main changed before the shared draft could be saved.",
          code: "draft_base_changed",
          currentBetaSha: status.beta?.sha || null
        },
        session,
        409
      );
    }

    const existing = await currentDraft(session);

    if (!existing) {
      if (expectedRevision !== 0) {
        return sessionResponse(
          { error: "The shared draft changed. Reload the editor before saving.", code: "draft_revision_changed" },
          session,
          409
        );
      }

      const rows = await restJson(
        "/rest/v1/support_editor_drafts?on_conflict=workspace",
        session,
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: {
            workspace: WORKSPACE,
            base_sha: baseSha,
            payload,
            revision: 1,
            updated_by: session.user.id,
            updated_at: new Date().toISOString()
          }
        }
      );

      const draft = Array.isArray(rows) ? rows[0] || null : null;
      return sessionResponse({ ok: true, draft }, session);
    }

    if (Number(existing.revision || 0) !== expectedRevision) {
      return sessionResponse(
        {
          error: "Another staff member updated the shared draft. Reload before overwriting it.",
          code: "draft_revision_changed",
          draft: existing
        },
        session,
        409
      );
    }

    const nextRevision = expectedRevision + 1;
    const rows = await restJson(
      `/rest/v1/support_editor_drafts?workspace=eq.${encodeURIComponent(WORKSPACE)}&revision=eq.${expectedRevision}`,
      session,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: {
          base_sha: baseSha,
          payload,
          revision: nextRevision,
          updated_by: session.user.id,
          updated_at: new Date().toISOString()
        }
      }
    );

    const draft = Array.isArray(rows) ? rows[0] || null : null;
    if (!draft) {
      return sessionResponse(
        { error: "Another staff member updated the shared draft. Reload before overwriting it.", code: "draft_revision_changed" },
        session,
        409
      );
    }

    return sessionResponse({ ok: true, draft }, session);
  } catch (error) {
    if ([400, 404].includes(Number(error.status || 0))) {
      return sessionResponse({
        ok: false,
        available: false,
        error: "Shared draft storage is not enabled yet."
      }, session, 503);
    }
    return sessionResponse(
      { error: error.message || "Unable to save the shared editor draft." },
      session,
      error.status || 500
    );
  }
}

export async function onRequestDelete({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  try {
    await restJson(
      `/rest/v1/support_editor_drafts?workspace=eq.${encodeURIComponent(WORKSPACE)}`,
      session,
      { method: "DELETE", headers: { Prefer: "return=minimal" } }
    );
    return sessionResponse({ ok: true }, session);
  } catch (error) {
    if ([400, 404].includes(Number(error.status || 0))) {
      return sessionResponse({ ok: true, available: false }, session);
    }
    return sessionResponse(
      { error: error.message || "Unable to clear the shared editor draft." },
      session,
      error.status || 500
    );
  }
}
