const PREVIEW_ORIGIN = "https://wellwebsite.pages.dev";
const PRESENCE_POLL_MS = 550;
const NOTES_POLL_MS = 2000;
const CURSOR_WRITE_MS = 240;
const HEARTBEAT_MS = 4000;

const clientId =
  typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

const collab = {
  active: false,
  frame: null,
  page: "/",
  device: "desktop",
  noteMode: false,
  notesOpen: false,
  notes: [],
  presence: [],
  self: null,
  selfColour: "#2F65A0",
  noteAnchor: null,
  noteDraftBody: "",
  noteDraftId: "",
  noteSaveTimer: null,
  noteSaveBusy: false,
  selectedNoteId: "",
  lastCursor: { visible: false },
  cursorWriteTimer: null,
  presenceTimer: null,
  notesTimer: null,
  heartbeatTimer: null,
  unavailable: false,
  presenceSignature: "",
  notesSignature: ""
};

async function collabRequest(query = "", { method = "GET", body, keepalive = false } = {}) {
  const headers = new Headers({ "X-Well-Support-Request": "1" });
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(`/api/staff/editor-collab${query}`, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    keepalive,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || "Editor collaboration request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function currentFrame() {
  return document.querySelector("#web-editor-frame");
}

function currentPage() {
  const select = document.querySelector("#web-editor-page");
  return String(select?.value || "/");
}

function currentDevice() {
  return String(document.querySelector("#web-editor-browser")?.dataset?.device || "desktop");
}

function postToPreview(type, payload = {}) {
  const frame = currentFrame();
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage({ type, ...payload }, PREVIEW_ORIGIN);
}

function noteCount() {
  return collab.notes.filter((note) => !note.resolved).length;
}

function ensurePresenceControl() {
  const topbar = document.querySelector(".editor-fullscreen-topbar");
  if (!topbar) return;

  let host = topbar.querySelector("#editor-collab-presence");
  if (!host) {
    host = document.createElement("div");
    host.id = "editor-collab-presence";
    host.className = "editor-collab-presence";

    const people = document.createElement("div");
    people.className = "editor-collab-people";
    people.setAttribute("aria-label", "Other staff in this page");

    const notes = document.createElement("button");
    notes.id = "editor-collab-notes-toggle";
    notes.type = "button";
    notes.className = "editor-collab-notes-toggle";
    notes.addEventListener("click", () => {
      collab.notesOpen = !collab.notesOpen;
      renderNotesPanel();
    });

    host.append(people, notes);
    topbar.appendChild(host);
  }

  const notesButton = host.querySelector("#editor-collab-notes-toggle");
  if (notesButton) {
    const label = `Notes ${noteCount() ? `(${noteCount()})` : ""}`;
    if (notesButton.textContent !== label) notesButton.textContent = label;
    notesButton.classList.toggle("has-notes", noteCount() > 0);
  }
}

function ensureNoteTool() {
  const toolbar = document.querySelector(".editor-tool-toolbar");
  if (!toolbar) return;

  let button = toolbar.querySelector("#editor-collab-note-tool");
  if (!button) {
    button = document.createElement("button");
    button.id = "editor-collab-note-tool";
    button.type = "button";
    button.title = "Pin a staff note";
    button.innerHTML = "✎ <span>Note</span>";
    button.addEventListener("click", () => {
      collab.noteMode = !collab.noteMode;
      if (collab.noteMode) collab.notesOpen = true;
      button.classList.toggle("is-active", collab.noteMode);
      renderNotesPanel();
      postToPreview("WCG_EDITOR_TOOL", {
        tool: collab.noteMode ? "note" : "select",
        colour: collab.selfColour
      });
    });
    toolbar.appendChild(button);
  }
  button.classList.toggle("is-active", collab.noteMode);
}

function avatarNode(person) {
  if (person?.avatar_url) {
    const image = document.createElement("img");
    image.src = person.avatar_url;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    return image;
  }
  const fallback = document.createElement("span");
  fallback.textContent = String(person?.display_name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return fallback;
}

function renderPresence() {
  ensurePresenceControl();
  const host = document.querySelector(".editor-collab-people");
  if (!host) return;
  host.replaceChildren();

  const people = collab.presence.slice(0, 5);
  for (const person of people) {
    const chip = document.createElement("div");
    chip.className = "editor-collab-person";
    chip.title = `${person.display_name || "Staff"} · ${person.device || "desktop"}`;
    chip.style.setProperty("--collab-colour", person.colour || "#2F65A0");

    const avatar = document.createElement("span");
    avatar.className = "editor-collab-avatar";
    avatar.appendChild(avatarNode(person));

    const label = document.createElement("span");
    label.textContent = person.display_name || "Staff";
    chip.append(avatar, label);
    host.appendChild(chip);
  }

  if (!people.length) {
    const solo = document.createElement("span");
    solo.className = "editor-collab-solo";
    solo.textContent = "Only you";
    host.appendChild(solo);
  }
}

function noteCard(note) {
  const card = document.createElement("article");
  card.className = `editor-note-card${note.resolved ? " is-resolved" : ""}`;
  card.dataset.noteId = note.id;
  card.style.setProperty("--note-colour", note.colour || "#2F65A0");

  const bodyButton = document.createElement("button");
  bodyButton.type = "button";
  bodyButton.className = "editor-note-goto";
  bodyButton.dataset.noteGoto = note.id;

  const copy = document.createElement("span");
  copy.className = "editor-note-copy";
  copy.textContent = note.body || "";

  const meta = document.createElement("small");
  const date = note.created_at ? new Date(note.created_at) : null;
  meta.textContent = [
    note.created_by_name || "Staff",
    date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date)
      : ""
  ].filter(Boolean).join(" · ");

  bodyButton.append(copy, meta);

  const actions = document.createElement("div");
  actions.className = "editor-note-actions";

  const resolve = document.createElement("button");
  resolve.type = "button";
  resolve.dataset.noteResolve = note.id;
  resolve.textContent = note.resolved ? "Reopen" : "Resolve";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.noteDelete = note.id;
  remove.textContent = "Delete";

  actions.append(resolve, remove);
  card.append(bodyButton, actions);
  return card;
}

function upsertLocalNote(note) {
  if (!note?.id) return;
  const index = collab.notes.findIndex((item) => item.id === note.id);
  if (index >= 0) collab.notes[index] = { ...collab.notes[index], ...note };
  else collab.notes.unshift(note);
  ensurePresenceControl();
  sendNotesToPreview();
}

function clearPendingNoteHighlight() {
  postToPreview("WCG_EDITOR_NOTE_DRAFT", {
    active: false,
    anchor: collab.noteAnchor || {},
    colour: collab.selfColour
  });
}

async function saveCurrentDraftNote() {
  const body = String(collab.noteDraftBody || "").trim();
  if (!collab.noteAnchor || !body || collab.noteSaveBusy) return;

  collab.noteSaveBusy = true;
  try {
    const result = await collabRequest("", {
      method: "POST",
      body: collab.noteDraftId
        ? {
            action: "note_update",
            page: currentPage(),
            id: collab.noteDraftId,
            body
          }
        : {
            action: "note_add",
            page: currentPage(),
            anchor: collab.noteAnchor,
            body
          }
    });

    if (result?.note?.id) {
      collab.noteDraftId = result.note.id;
      collab.selectedNoteId = result.note.id;
      upsertLocalNote(result.note);
    }
  } catch (error) {
    const textarea = document.querySelector("#editor-note-draft");
    if (textarea) {
      textarea.setCustomValidity(error?.message || "Unable to save note.");
      textarea.reportValidity();
      window.setTimeout(() => textarea.setCustomValidity(""), 1400);
    }
  } finally {
    collab.noteSaveBusy = false;
    if (String(collab.noteDraftBody || "").trim() !== body) {
      queueDraftNoteSave();
    }
  }
}

function queueDraftNoteSave() {
  if (collab.noteSaveTimer) window.clearTimeout(collab.noteSaveTimer);
  collab.noteSaveTimer = window.setTimeout(() => {
    collab.noteSaveTimer = null;
    saveCurrentDraftNote();
  }, 450);
}

function renderNotesPanel() {
  const workspace = document.querySelector(".editor-preview-placeholder.is-fullscreen");
  if (!workspace) return;

  let panel = workspace.querySelector("#editor-notes-panel");
  if (!panel) {
    panel = document.createElement("aside");
    panel.id = "editor-notes-panel";
    panel.className = "editor-notes-panel";
    workspace.appendChild(panel);
  }

  const canDock = !workspace.classList.contains("has-code-dock");
  const open = collab.notesOpen && canDock;
  workspace.classList.toggle("has-notes-dock", open);
  panel.classList.toggle("is-open", open);
  if (!open) return;

  const activeDraft =
    collab.noteAnchor &&
    document.activeElement?.id === "editor-note-draft";

  const preservedSelection = activeDraft
    ? {
        start: document.activeElement.selectionStart,
        end: document.activeElement.selectionEnd
      }
    : null;

  panel.replaceChildren();

  const header = document.createElement("header");
  const titleWrap = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "Page notes";
  const subtitle = document.createElement("span");
  subtitle.textContent = "Highlights and notes shared with staff";
  titleWrap.append(title, subtitle);

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close notes");
  close.textContent = "×";
  close.addEventListener("click", () => {
    collab.notesOpen = false;
    collab.noteMode = false;
    document.querySelector("#editor-collab-note-tool")?.classList.remove("is-active");
    postToPreview("WCG_EDITOR_TOOL", { tool: "select", colour: collab.selfColour });
    renderNotesPanel();
  });
  header.append(titleWrap, close);
  panel.appendChild(header);

  if (collab.noteAnchor) {
    const composer = document.createElement("section");
    composer.className = "editor-note-composer";
    composer.style.setProperty("--note-colour", collab.selfColour);

    const labelRow = document.createElement("div");
    labelRow.className = "editor-note-composer-label";
    const colour = document.createElement("i");
    colour.style.background = collab.selfColour;
    const label = document.createElement("strong");
    label.textContent = collab.noteDraftId ? "Linked note" : "New highlighted note";
    const saving = document.createElement("small");
    saving.textContent = "Autosaves while you type";
    labelRow.append(colour, label, saving);

    const textarea = document.createElement("textarea");
    textarea.id = "editor-note-draft";
    textarea.maxLength = 2000;
    textarea.placeholder = "Type your note…";
    textarea.value = collab.noteDraftBody;
    textarea.addEventListener("input", () => {
      collab.noteDraftBody = textarea.value;
      postToPreview("WCG_EDITOR_NOTE_DRAFT", {
        active: true,
        anchor: collab.noteAnchor,
        colour: collab.selfColour,
        body: collab.noteDraftBody
      });
      if (textarea.value.trim()) queueDraftNoteSave();
    });

    const actions = document.createElement("div");
    const done = document.createElement("button");
    done.type = "button";
    done.className = "editor-note-secondary";
    done.textContent = "Done";
    done.addEventListener("click", async () => {
      if (collab.noteSaveTimer) {
        window.clearTimeout(collab.noteSaveTimer);
        collab.noteSaveTimer = null;
      }
      if (collab.noteDraftBody.trim()) await saveCurrentDraftNote();
      else clearPendingNoteHighlight();

      collab.noteAnchor = null;
      collab.noteDraftBody = "";
      collab.noteDraftId = "";
      collab.noteMode = false;
      document.querySelector("#editor-collab-note-tool")?.classList.remove("is-active");
      postToPreview("WCG_EDITOR_TOOL", { tool: "select", colour: collab.selfColour });
      await loadNotes();
    });

    actions.append(done);
    composer.append(labelRow, textarea, actions);
    panel.appendChild(composer);

    window.setTimeout(() => {
      textarea.focus();
      if (preservedSelection) {
        textarea.setSelectionRange(preservedSelection.start, preservedSelection.end);
      }
    }, 0);
  }

  const list = document.createElement("div");
  list.className = "editor-note-list";

  const openNotes = collab.notes.filter((note) => !note.resolved);
  const resolvedNotes = collab.notes.filter((note) => note.resolved);
  const ordered = [...openNotes, ...resolvedNotes];

  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "editor-note-empty";
    empty.textContent = "Choose Note, then click a section of the page to highlight it and start typing.";
    list.appendChild(empty);
  } else {
    for (const note of ordered) list.appendChild(noteCard(note));
  }

  panel.appendChild(list);

  if (collab.selectedNoteId) {
    window.setTimeout(() => {
      panel.querySelector(`[data-note-id="${CSS.escape(collab.selectedNoteId)}"]`)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth"
      });
    }, 0);
  }
}

function sendNotesToPreview() {
  postToPreview("WCG_EDITOR_NOTES", {
    notes: collab.notes.map((note) => ({
      id: note.id,
      body: note.body,
      resolved: note.resolved,
      createdByName: note.created_by_name,
      colour: note.colour || "#2F65A0",
      anchor: note.anchor || {}
    }))
  });
}

function sendRemoteCursors() {
  const device = currentDevice();
  postToPreview("WCG_EDITOR_REMOTE_CURSORS", {
    cursors: collab.presence
      .filter((person) => person.device === device && person.cursor?.visible !== false)
      .map((person) => ({
        id: person.session_id,
        name: person.display_name || "Staff",
        avatarUrl: person.avatar_url || "",
        colour: person.colour || "#2F65A0",
        ...person.cursor
      }))
  });
}

async function loadPresence() {
  if (!currentFrame()) return;
  collab.page = currentPage();
  collab.device = currentDevice();

  try {
    const result = await collabRequest(
      `?kind=presence&page=${encodeURIComponent(collab.page)}`
    );
    collab.unavailable = result.available === false;
    const nextPresence = Array.isArray(result.presence) ? result.presence : [];
    if (result.self) {
      collab.self = result.self;
      collab.selfColour = result.self.colour || collab.selfColour;
    }
    const signature = JSON.stringify(
      nextPresence.map((person) => [
        person.session_id,
        person.updated_at,
        person.display_name,
        person.colour,
        person.cursor?.pageX,
        person.cursor?.pageY,
        person.cursor?.visible
      ])
    );
    if (signature !== collab.presenceSignature) {
      collab.presenceSignature = signature;
      collab.presence = nextPresence;
      renderPresence();
      sendRemoteCursors();
    }
  } catch (error) {
    if (error?.status === 503) collab.unavailable = true;
  }
}

async function loadNotes() {
  if (!currentFrame()) return;
  collab.page = currentPage();

  try {
    const result = await collabRequest(
      `?kind=notes&page=${encodeURIComponent(collab.page)}`
    );
    collab.unavailable = result.available === false;
    const nextNotes = Array.isArray(result.notes) ? result.notes : [];
    if (result.self) {
      collab.self = result.self;
      collab.selfColour = result.self.colour || collab.selfColour;
    }
    const signature = JSON.stringify(
      nextNotes.map((note) => [
        note.id,
        note.updated_at,
        note.resolved,
        note.body,
        note.colour,
        note.anchor?.selector,
        note.anchor?.pageX,
        note.anchor?.pageY
      ])
    );
    if (signature !== collab.notesSignature) {
      collab.notesSignature = signature;
      collab.notes = nextNotes;
      ensurePresenceControl();
      if (document.activeElement?.id !== "editor-note-draft") renderNotesPanel();
      sendNotesToPreview();
    }
  } catch (error) {
    if (error?.status === 503) collab.unavailable = true;
  }
}

async function writePresence({ keepalive = false } = {}) {
  if (!currentFrame() || collab.unavailable) return;

  try {
    await collabRequest("", {
      method: "POST",
      keepalive,
      body: {
        action: "presence",
        clientId,
        page: currentPage(),
        device: currentDevice(),
        cursor: collab.lastCursor
      }
    });
  } catch (error) {
    if (error?.status === 503) collab.unavailable = true;
  }
}

function queuePresenceWrite() {
  if (collab.cursorWriteTimer || collab.unavailable) return;
  collab.cursorWriteTimer = window.setTimeout(() => {
    collab.cursorWriteTimer = null;
    writePresence();
  }, CURSOR_WRITE_MS);
}

function leavePresence() {
  if (collab.cursorWriteTimer) {
    window.clearTimeout(collab.cursorWriteTimer);
    collab.cursorWriteTimer = null;
  }
  if (collab.unavailable) return;

  collabRequest("", {
    method: "POST",
    keepalive: true,
    body: {
      action: "presence_leave",
      clientId,
      page: collab.page || "/"
    }
  }).catch(() => {});
}

function stopCollaboration() {
  if (!collab.active) return;
  collab.active = false;
  for (const timer of [collab.presenceTimer, collab.notesTimer, collab.heartbeatTimer]) {
    if (timer) window.clearInterval(timer);
  }
  collab.presenceTimer = null;
  collab.notesTimer = null;
  collab.heartbeatTimer = null;
  if (collab.noteSaveTimer) window.clearTimeout(collab.noteSaveTimer);
  collab.noteSaveTimer = null;
  leavePresence();
  collab.frame = null;
  collab.presence = [];
  collab.notes = [];
  collab.presenceSignature = "";
  collab.notesSignature = "";
}

function startCollaboration() {
  const frame = currentFrame();
  if (!frame) {
    stopCollaboration();
    return;
  }

  if (collab.active && collab.frame === frame) {
    ensurePresenceControl();
    ensureNoteTool();
    return;
  }

  ensurePresenceControl();
  ensureNoteTool();
  renderPresence();
  renderNotesPanel();

  if (collab.active && collab.frame !== frame) {
    collab.frame = frame;
    window.setTimeout(() => {
      sendNotesToPreview();
      sendRemoteCursors();
      if (collab.noteMode) postToPreview("WCG_EDITOR_TOOL", { tool: "note", colour: collab.selfColour });
    }, 120);
    return;
  }

  collab.active = true;
  collab.frame = frame;
  collab.page = currentPage();
  collab.device = currentDevice();

  loadPresence();
  loadNotes();
  writePresence();

  collab.presenceTimer = window.setInterval(loadPresence, PRESENCE_POLL_MS);
  collab.notesTimer = window.setInterval(loadNotes, NOTES_POLL_MS);
  collab.heartbeatTimer = window.setInterval(() => writePresence(), HEARTBEAT_MS);
}

document.addEventListener("click", async (event) => {
  const existingTool = event.target?.closest?.("[data-editor-tool]");
  if (existingTool && !existingTool.closest("#editor-collab-note-tool")) {
    collab.noteMode = false;
    document.querySelector("#editor-collab-note-tool")?.classList.remove("is-active");
  }

  const goto = event.target?.closest?.("[data-note-goto]");
  if (goto) {
    const note = collab.notes.find((item) => item.id === goto.dataset.noteGoto);
    if (!note) return;
    collab.selectedNoteId = note.id;
    postToPreview("WCG_EDITOR_GOTO_NOTE", { anchor: note.anchor || {}, noteId: note.id });
    return;
  }

  const resolve = event.target?.closest?.("[data-note-resolve]");
  if (resolve) {
    const note = collab.notes.find((item) => item.id === resolve.dataset.noteResolve);
    if (!note) return;
    resolve.disabled = true;
    try {
      await collabRequest("", {
        method: "POST",
        body: {
          action: "note_update",
          page: currentPage(),
          id: note.id,
          resolved: !note.resolved
        }
      });
      await loadNotes();
    } finally {
      resolve.disabled = false;
    }
    return;
  }

  const remove = event.target?.closest?.("[data-note-delete]");
  if (remove) {
    const note = collab.notes.find((item) => item.id === remove.dataset.noteDelete);
    if (!note || !window.confirm("Delete this pinned note?")) return;
    remove.disabled = true;
    try {
      await collabRequest("", {
        method: "POST",
        body: {
          action: "note_delete",
          page: currentPage(),
          id: note.id
        }
      });
      await loadNotes();
    } finally {
      remove.disabled = false;
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target?.id !== "web-editor-page") return;
  collab.page = currentPage();
  collab.lastCursor = { visible: false };
  collab.notes = [];
  collab.notesSignature = "";
  collab.presenceSignature = "";
  collab.noteAnchor = null;
  collab.noteDraftBody = "";
  collab.noteDraftId = "";
  writePresence();
  loadPresence();
  loadNotes();
});

window.addEventListener("message", (event) => {
  const frame = currentFrame();
  if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
  if (event.origin !== PREVIEW_ORIGIN) return;
  if (!event.data || typeof event.data !== "object") return;

  if (event.data.type === "WCG_EDITOR_CURSOR") {
    collab.lastCursor = {
      selector: String(event.data.cursor?.selector || "").slice(0, 1000),
      pageX: Number(event.data.cursor?.pageX || 0),
      pageY: Number(event.data.cursor?.pageY || 0),
      offsetX: Number(event.data.cursor?.offsetX ?? 0.5),
      offsetY: Number(event.data.cursor?.offsetY ?? 0.5),
      scrollY: Number(event.data.cursor?.scrollY || 0),
      visible: event.data.cursor?.visible !== false
    };
    queuePresenceWrite();
    return;
  }

  if (event.data.type === "WCG_EDITOR_NOTE_ANCHOR") {
    collab.noteMode = false;
    collab.noteAnchor = event.data.anchor || {};
    collab.noteDraftBody = "";
    collab.noteDraftId = "";
    collab.selfColour = event.data.colour || collab.selfColour;
    collab.notesOpen = true;
    document.querySelector("#editor-collab-note-tool")?.classList.remove("is-active");
    renderNotesPanel();
    return;
  }

  if (event.data.type === "WCG_EDITOR_NOTE_OPEN") {
    collab.selectedNoteId = String(event.data.noteId || "");
    collab.noteAnchor = null;
    collab.noteDraftBody = "";
    collab.noteDraftId = "";
    collab.notesOpen = true;
    renderNotesPanel();
    return;
  }

  if (event.data.type === "WCG_EDITOR_READY") {
    window.setTimeout(() => {
      sendNotesToPreview();
      sendRemoteCursors();
      if (collab.noteMode) postToPreview("WCG_EDITOR_TOOL", { tool: "note", colour: collab.selfColour });
    }, 80);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    collab.lastCursor = { ...collab.lastCursor, visible: false };
    writePresence({ keepalive: true });
  } else if (currentFrame()) {
    collab.lastCursor = { ...collab.lastCursor, visible: true };
    writePresence();
  }
});

window.addEventListener("pagehide", leavePresence);

let observedFrame = currentFrame();
const observer = new MutationObserver(() => {
  const frame = currentFrame();
  if (frame === observedFrame) return;
  observedFrame = frame;
  if (frame) startCollaboration();
  else stopCollaboration();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
startCollaboration();
