import {
  assertSameOrigin,
  requireStaff,
  requireStaffPermission,
  restJson,
  sessionResponse
} from "./_utils.js";

const PRESENCE_TTL_MS = 9000;
const MAX_NOTES = 200;
const STAFF_COLOURS = Object.freeze([
  "#2F65A0",
  "#2F7D73",
  "#8A6A2F",
  "#A65353",
  "#6C5FA7",
  "#3E7A4F",
  "#9A5A2F",
  "#3C6F8C"
]);

function staffColour(value) {
  const seed = String(value || "staff");
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return STAFF_COLOURS[Math.abs(hash) % STAFF_COLOURS.length];
}

function decorateNote(note) {
  return note && typeof note === "object"
    ? { ...note, colour: staffColour(note.created_by || note.created_by_name) }
    : note;
}

function decoratePresence(person) {
  return person && typeof person === "object"
    ? { ...person, colour: staffColour(person.user_id || person.display_name) }
    : person;
}

function cleanPage(value) {
  const raw = String(value || "/").trim();
  if (!raw.startsWith("/") || raw.includes("?") || raw.includes("#")) return null;
  if (raw.length > 240 || raw.includes("..")) return null;
  return raw === "/index.html" ? "/" : raw;
}

function cleanClientId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9_-]{8,80}$/i.test(id) ? id : null;
}

function cleanDevice(value) {
  return ["desktop", "tablet", "mobile"].includes(value) ? value : "desktop";
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanAnchor(value) {
  const anchor = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const box =
    anchor.box && typeof anchor.box === "object" && !Array.isArray(anchor.box)
      ? anchor.box
      : null;

  return {
    selector: String(anchor.selector || "").slice(0, 1000),
    pageX: Math.max(0, finiteNumber(anchor.pageX)),
    pageY: Math.max(0, finiteNumber(anchor.pageY)),
    offsetX: Math.min(1, Math.max(0, finiteNumber(anchor.offsetX, 0.5))),
    offsetY: Math.min(1, Math.max(0, finiteNumber(anchor.offsetY, 0.5))),
    scrollY: Math.max(0, finiteNumber(anchor.scrollY)),
    box: box
      ? {
          pageX: Math.max(0, finiteNumber(box.pageX)),
          pageY: Math.max(0, finiteNumber(box.pageY)),
          width: Math.min(5000, Math.max(8, finiteNumber(box.width, 8))),
          height: Math.min(5000, Math.max(8, finiteNumber(box.height, 8))),
          offsetX: Math.min(1, Math.max(0, finiteNumber(box.offsetX))),
          offsetY: Math.min(1, Math.max(0, finiteNumber(box.offsetY))),
          widthRatio: Math.min(1, Math.max(0.002, finiteNumber(box.widthRatio, 0.002))),
          heightRatio: Math.min(1, Math.max(0.002, finiteNumber(box.heightRatio, 0.002)))
        }
      : null
  };
}

function cleanCursor(value) {
  const cursor = cleanAnchor(value);
  return {
    ...cursor,
    visible: value?.visible !== false,
    at: new Date().toISOString()
  };
}

function cleanNoteBody(value) {
  const body = String(value || "").trim();
  return body.length >= 1 && body.length <= 2000 ? body : null;
}

function uuid(value) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  const url = new URL(request.url);
  const kind = String(url.searchParams.get("kind") || "presence");
  const page = cleanPage(url.searchParams.get("page") || "/");
  if (!page) return sessionResponse({ error: "Invalid editor page." }, session, 400);

  try {
    if (kind === "notes") {
      const query = new URLSearchParams({
        select: "id,page_path,anchor,body,resolved,created_by,created_by_name,created_at,updated_at,resolved_by,resolved_at",
        page_path: `eq.${page}`,
        order: "resolved.asc,created_at.desc",
        limit: String(MAX_NOTES)
      });
      const notes = await restJson(
        `/rest/v1/support_editor_notes?${query.toString()}`,
        session
      );
      return sessionResponse({
        notes: Array.isArray(notes) ? notes.map(decorateNote) : [],
        self: {
          user_id: session.user.id,
          display_name: String(session.agent?.display_name || "Staff").slice(0, 120),
          avatar_url: session.agent?.avatar_url || null,
          colour: staffColour(session.user.id)
        }
      }, session);
    }

    const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
    const query = new URLSearchParams({
      select: "session_id,user_id,display_name,avatar_url,page_path,device,cursor,updated_at",
      page_path: `eq.${page}`,
      updated_at: `gte.${cutoff}`,
      order: "updated_at.desc",
      limit: "40"
    });
    const presence = await restJson(
      `/rest/v1/support_editor_presence?${query.toString()}`,
      session
    );

    return sessionResponse({
      presence: Array.isArray(presence)
        ? presence
            .filter((row) => row?.user_id !== session.user.id)
            .map(decoratePresence)
        : [],
      self: {
        user_id: session.user.id,
        display_name: String(session.agent?.display_name || "Staff").slice(0, 120),
        avatar_url: session.agent?.avatar_url || null,
        colour: staffColour(session.user.id)
      }
    }, session);
  } catch (error) {
    if ([400, 404].includes(Number(error.status || 0))) {
      return sessionResponse({ available: false, presence: [], notes: [] }, session);
    }
    return sessionResponse(
      { error: error.message || "Unable to load editor collaboration." },
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
  const action = String(input.action || "");
  const page = cleanPage(input.page || "/");
  if (!page) return sessionResponse({ error: "Invalid editor page." }, session, 400);

  try {
    if (action === "presence") {
      const clientId = cleanClientId(input.clientId);
      if (!clientId) {
        return sessionResponse({ error: "Invalid collaboration session." }, session, 400);
      }

      const sessionId = `${session.user.id}:${clientId}`;
      await restJson(
        "/rest/v1/support_editor_presence?on_conflict=session_id",
        session,
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: {
            session_id: sessionId,
            user_id: session.user.id,
            display_name: String(session.agent?.display_name || "Staff").slice(0, 120),
            avatar_url: session.agent?.avatar_url || null,
            page_path: page,
            device: cleanDevice(input.device),
            cursor: cleanCursor(input.cursor),
            updated_at: new Date().toISOString()
          }
        }
      );
      return sessionResponse({ ok: true }, session);
    }

    if (action === "presence_leave") {
      const clientId = cleanClientId(input.clientId);
      if (!clientId) return sessionResponse({ ok: true }, session);
      const sessionId = `${session.user.id}:${clientId}`;
      const query = new URLSearchParams({
        session_id: `eq.${sessionId}`,
        user_id: `eq.${session.user.id}`
      });
      await restJson(
        `/rest/v1/support_editor_presence?${query.toString()}`,
        session,
        { method: "DELETE", headers: { Prefer: "return=minimal" } }
      );
      return sessionResponse({ ok: true }, session);
    }

    if (action === "note_add") {
      const body = cleanNoteBody(input.body);
      if (!body) {
        return sessionResponse({ error: "Write a note before saving it." }, session, 400);
      }

      const notes = await restJson(
        "/rest/v1/support_editor_notes",
        session,
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: {
            page_path: page,
            anchor: cleanAnchor(input.anchor),
            body,
            resolved: false,
            created_by: session.user.id,
            created_by_name: String(session.agent?.display_name || "Staff").slice(0, 120),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        }
      );
      return sessionResponse({
        ok: true,
        note: Array.isArray(notes) ? decorateNote(notes[0] || null) : null
      }, session);
    }

    if (action === "note_update") {
      const id = uuid(input.id);
      if (!id) return sessionResponse({ error: "Invalid note." }, session, 400);

      const patch = { updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(input, "body")) {
        const body = cleanNoteBody(input.body);
        if (!body) return sessionResponse({ error: "A note cannot be empty." }, session, 400);
        patch.body = body;
      }
      if (Object.prototype.hasOwnProperty.call(input, "resolved")) {
        patch.resolved = input.resolved === true;
        patch.resolved_by = patch.resolved ? session.user.id : null;
        patch.resolved_at = patch.resolved ? new Date().toISOString() : null;
      }

      const query = new URLSearchParams({ id: `eq.${id}` });
      const notes = await restJson(
        `/rest/v1/support_editor_notes?${query.toString()}`,
        session,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: patch
        }
      );
      return sessionResponse({
        ok: true,
        note: Array.isArray(notes) ? decorateNote(notes[0] || null) : null
      }, session);
    }

    if (action === "note_delete") {
      const id = uuid(input.id);
      if (!id) return sessionResponse({ error: "Invalid note." }, session, 400);
      const query = new URLSearchParams({ id: `eq.${id}` });
      await restJson(
        `/rest/v1/support_editor_notes?${query.toString()}`,
        session,
        { method: "DELETE", headers: { Prefer: "return=minimal" } }
      );
      return sessionResponse({ ok: true }, session);
    }

    return sessionResponse({ error: "Unsupported collaboration action." }, session, 400);
  } catch (error) {
    if ([400, 404].includes(Number(error.status || 0))) {
      return sessionResponse({
        ok: false,
        available: false,
        error: "Editor collaboration storage is not enabled yet."
      }, session, 503);
    }
    return sessionResponse(
      { error: error.message || "Unable to update editor collaboration." },
      session,
      error.status || 500
    );
  }
}
