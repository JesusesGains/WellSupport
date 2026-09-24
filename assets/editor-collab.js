const PREVIEW_ORIGIN = "https://wellwebsite.pages.dev";
// Polling adapts to whether anyone else is in the editor: live cursors need
// fast presence reads, but a solo editor only needs to notice when someone
// joins. Every poll re-validates the staff session server-side, so idle
// polling is kept slow and stops entirely while the tab is hidden.
const PRESENCE_ACTIVE_MS = 150;
const PRESENCE_IDLE_MS = 2500;
const NOTES_ACTIVE_MS = 1500;
const NOTES_IDLE_MS = 5000;
const CURSOR_WRITE_MS = 80;
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
  allNotes: [],
  presence: [],
  self: null,
  selfColour: "#2F65A0",
  noteAnchor: null,
  noteDraftBody: "",
  noteDraftId: "",
  noteSaveTimer: null,
  noteSaveBusy: false,
  selectedNoteId: "",
  pendingNoteJump: null,
  lastCursor: { visible: false },
  cursorWriteTimer: null,
  presenceTimer: null,
  presenceLoading: false,
  notesTimer: null,
  notesLoading: false,
  heartbeatTimer: null,
  unavailable: false,
  presenceSignature: "",
  peopleSignature: "",
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
  const target =
    document.querySelector(".editor-fullscreen-topbar-right") ||
    document.querySelector(".editor-fullscreen-topbar");
  if (!target) return;

  let host = target.querySelector("#editor-collab-presence");
  if (!host) {
    host = document.createElement("div");
    host.id = "editor-collab-presence";
    host.className = "editor-collab-presence";
    host.setAttribute("aria-label", "People currently viewing the editor");

    const heading = document.createElement("span");
    heading.className = "editor-collab-heading";
    heading.textContent = "Viewing";

    const people = document.createElement("div");
    people.className = "editor-collab-people";
    people.setAttribute("aria-label", "People currently viewing");

    host.append(heading, people);
    target.appendChild(host);
  }
}

function ensureNoteTool() {
  const slot =
    document.querySelector(".editor-notes-mode-slot") ||
    document.querySelector(".editor-tool-toolbar");
  if (!slot) return;

  let button = document.querySelector("#editor-collab-note-tool");
  if (!button || !button.isConnected) {
    button = document.createElement("button");
    button.id = "editor-collab-note-tool";
    button.type = "button";
    button.className = "editor-notes-mode-button";
    button.title = "Draw a highlighted note region";
    button.setAttribute("aria-label", "Notes: draw a highlighted note region");
    button.innerHTML = "▧ <span>Notes</span>";
    slot.appendChild(button);

    button.addEventListener("click", () => {
      collab.notesOpen = true;
      button.classList.add("is-active");
      renderNotesPanel();
    });
  }

  button.classList.toggle("is-active", collab.notesOpen);
  button.classList.toggle("has-notes", noteCount() > 0);
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

  const peopleHost = document.querySelector(".editor-collab-people");
  const heading = document.querySelector(".editor-collab-heading");
  if (!peopleHost) return;
  peopleHost.replaceChildren();

  const self = collab.self
    ? {
        ...collab.self,
        session_id: "self",
        device: currentDevice(),
        isSelf: true
      }
    : null;

  const allPeople = [
    ...(self ? [self] : []),
    ...collab.presence
  ];

  const visiblePeople = allPeople.slice(0, 5);

  if (heading) {
    heading.textContent = `Viewing ${Math.max(1, allPeople.length)}`;
  }

  for (const person of visiblePeople) {
    const chip = document.createElement("div");
    chip.className = `editor-collab-person${person.isSelf ? " is-self" : ""}`;
    chip.title = person.isSelf
      ? `${person.display_name || "You"} · you`
      : `${person.display_name || "Staff"} · ${person.device || "desktop"}`;
    chip.style.setProperty("--collab-colour", person.colour || "#2F65A0");

    const avatar = document.createElement("span");
    avatar.className = "editor-collab-avatar";
    avatar.appendChild(avatarNode(person));

    const label = document.createElement("span");
    label.className = "editor-collab-name";
    label.textContent = person.isSelf
      ? `${person.display_name || "You"} (you)`
      : person.display_name || "Staff";

    chip.append(avatar, label);
    peopleHost.appendChild(chip);
  }

  if (allPeople.length > visiblePeople.length) {
    const overflow = document.createElement("span");
    overflow.className = "editor-collab-more";
    overflow.textContent = `+${allPeople.length - visiblePeople.length}`;
    peopleHost.appendChild(overflow);
  }
}

function notePageLabel(pagePath) {
  const value = String(pagePath || "/");
  if (value === "/") return "Home";
  return value
    .replace(/^\/+|\.html$/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    )
    .join(" · ") || "Home";
}

function orderedNotes(notes) {
  const open = notes.filter((note) => !note.resolved);
  const resolved = notes.filter((note) => note.resolved);
  return [...open, ...resolved];
}

function notesSection(title, notes, { showPage = false } = {}) {
  const section = document.createElement("section");
  section.className = "editor-note-section";

  const heading = document.createElement("div");
  heading.className = "editor-note-section-heading";

  const label = document.createElement("strong");
  label.textContent = title;

  const count = document.createElement("span");
  count.textContent = String(notes.length);

  heading.append(label, count);
  section.appendChild(heading);

  const items = document.createElement("div");
  items.className = "editor-note-section-items";

  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "editor-note-empty";
    empty.textContent = "No notes yet.";
    items.appendChild(empty);
  } else {
    for (const note of orderedNotes(notes)) {
      items.appendChild(noteCard(note, { showPage }));
    }
  }

  section.appendChild(items);
  return section;
}

function noteCard(note, { showPage = false } = {}) {
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
    showPage ? notePageLabel(note.page_path) : "",
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

  const thread = document.createElement("div");
  thread.className = "editor-note-thread";

  const replies = Array.isArray(note.replies) ? note.replies : [];
  for (const reply of replies) {
    const row = document.createElement("div");
    row.className = "editor-note-reply";
    row.style.setProperty("--reply-colour", reply.colour || "#2F65A0");

    const avatar = document.createElement("span");
    avatar.className = "editor-note-reply-avatar";
    avatar.textContent =
      String(reply.created_by_name || "Staff").trim().slice(0, 1).toUpperCase() || "?";

    const content = document.createElement("div");
    content.className = "editor-note-reply-content";

    const replyMeta = document.createElement("div");
    replyMeta.className = "editor-note-reply-meta";
    const name = document.createElement("strong");
    name.textContent = reply.created_by_name || "Staff";
    const replyDate = reply.created_at ? new Date(reply.created_at) : null;
    const time = document.createElement("span");
    time.textContent =
      replyDate && !Number.isNaN(replyDate.getTime())
        ? new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit"
          }).format(replyDate)
        : "";
    replyMeta.append(name, time);

    const replyBody = document.createElement("p");
    replyBody.textContent = reply.body || "";

    content.append(replyMeta, replyBody);

    const deleteReply = document.createElement("button");
    deleteReply.type = "button";
    deleteReply.className = "editor-note-reply-delete";
    deleteReply.dataset.replyDelete = reply.id;
    deleteReply.dataset.noteId = note.id;
    deleteReply.setAttribute("aria-label", "Delete reply");
    deleteReply.title = "Delete reply";
    deleteReply.textContent = "×";

    row.append(avatar, content, deleteReply);
    thread.appendChild(row);
  }

  const form = document.createElement("form");
  form.className = "editor-note-reply-form";
  form.dataset.replyNote = note.id;

  const input = document.createElement("textarea");
  input.className = "editor-note-reply-input";
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = replies.length ? "Reply…" : "Add a reply…";
  input.setAttribute("aria-label", "Reply to note");

  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = "Send";

  form.append(input, send);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const body = input.value.trim();
    if (!body) return;

    input.disabled = true;
    send.disabled = true;
    try {
      await collabRequest("", {
        method: "POST",
        body: {
          action: "reply_add",
          page: note.page_path || currentPage(),
          noteId: note.id,
          body
        }
      });
      input.value = "";
      collab.notesSignature = "";
      await loadNotes();
    } catch (error) {
      input.setCustomValidity(error?.message || "Unable to send reply.");
      input.reportValidity();
      window.setTimeout(() => input.setCustomValidity(""), 1400);
    } finally {
      input.disabled = false;
      send.disabled = false;
      input.focus();
    }
  });

  thread.appendChild(form);
  card.appendChild(thread);
  return card;
}

function upsertLocalNote(note) {
  if (!note?.id) return;

  const pageIndex = collab.notes.findIndex((item) => item.id === note.id);
  if (note.page_path === currentPage()) {
    if (pageIndex >= 0) collab.notes[pageIndex] = { ...collab.notes[pageIndex], ...note };
    else collab.notes.unshift(note);
  } else if (pageIndex >= 0) {
    collab.notes.splice(pageIndex, 1);
  }

  const allIndex = collab.allNotes.findIndex((item) => item.id === note.id);
  if (allIndex >= 0) collab.allNotes[allIndex] = { ...collab.allNotes[allIndex], ...note };
  else collab.allNotes.unshift(note);

  ensurePresenceControl();
  ensureNoteTool();
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

  const headerActions = document.createElement("div");
  headerActions.className = "editor-notes-header-actions";

  const add = document.createElement("button");
  add.type = "button";
  add.className = "editor-notes-add";
  add.setAttribute("aria-label", "Create new note");
  add.title = "Create new note";
  add.textContent = "+";
  add.addEventListener("click", async () => {
    if (collab.noteSaveTimer) {
      window.clearTimeout(collab.noteSaveTimer);
      collab.noteSaveTimer = null;
    }

    if (collab.noteAnchor && collab.noteDraftBody.trim()) {
      await saveCurrentDraftNote();
    } else if (collab.noteAnchor && !collab.noteDraftId) {
      clearPendingNoteHighlight();
    }

    collab.noteAnchor = null;
    collab.noteDraftBody = "";
    collab.noteDraftId = "";
    collab.selectedNoteId = "";
    collab.noteMode = true;
    collab.notesOpen = true;

    document.querySelectorAll("[data-editor-interaction]").forEach((item) => {
      item.classList.remove("is-active");
    });

    document.querySelector(".editor-tool-toolbar")?.classList.add("is-collapsed");
    document.querySelector(".editor-tool-toolbar")?.classList.remove("is-expanded");
    document.querySelector("#editor-collab-note-tool")?.classList.add("is-active");

    postToPreview("WCG_EDITOR_TOOL", {
      tool: "note",
      colour: collab.selfColour
    });

    renderNotesPanel();
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "editor-notes-close";
  close.setAttribute("aria-label", "Close notes");
  close.textContent = "×";
  close.addEventListener("click", async () => {
    if (collab.noteSaveTimer) {
      window.clearTimeout(collab.noteSaveTimer);
      collab.noteSaveTimer = null;
    }

    if (collab.noteAnchor && collab.noteDraftBody.trim()) {
      await saveCurrentDraftNote();
    } else if (collab.noteAnchor && !collab.noteDraftId) {
      clearPendingNoteHighlight();
    }

    collab.noteAnchor = null;
    collab.noteDraftBody = "";
    collab.noteDraftId = "";
    collab.notesOpen = false;
    collab.noteMode = false;
    document.querySelector("#editor-collab-note-tool")?.classList.remove("is-active");
    postToPreview("WCG_EDITOR_TOOL", { tool: "select", colour: collab.selfColour });
    renderNotesPanel();
  });
  headerActions.append(add, close);
  header.append(titleWrap, headerActions);
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
      document.querySelector("#editor-collab-note-tool")?.classList.add("is-active");
      postToPreview("WCG_EDITOR_TOOL", { tool: "select", colour: collab.selfColour });
      await loadNotes();
      collab.notesOpen = true;
      renderNotesPanel();
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

  const pageNotes = collab.notes;
  const allNotes = collab.allNotes;

  if (pageNotes.length) {
    list.appendChild(
      notesSection("This page’s notes", pageNotes)
    );

    const separator = document.createElement("div");
    separator.className = "editor-note-section-separator";
    list.appendChild(separator);

    list.appendChild(
      notesSection("All notes", allNotes, { showPage: true })
    );
  } else {
    if (allNotes.length) {
      list.appendChild(
        notesSection("All notes", allNotes, { showPage: true })
      );
    } else {
      const empty = document.createElement("div");
      empty.className = "editor-note-empty";
      empty.textContent = "No notes yet. Click + above to create one.";
      list.appendChild(empty);
    }
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
  if (!currentFrame() || collab.presenceLoading) return;
  collab.page = currentPage();
  collab.device = currentDevice();
  collab.presenceLoading = true;

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
    const peopleSignature = JSON.stringify([
      result.self
        ? [
            "self",
            result.self.user_id,
            result.self.display_name,
            result.self.avatar_url,
            result.self.colour,
            currentDevice()
          ]
        : null,
      ...nextPresence.map((person) => [
        person.session_id,
        person.display_name,
        person.avatar_url,
        person.colour,
        person.device
      ])
    ]);
    const cursorSignature = JSON.stringify(
      nextPresence.map((person) => [
        person.session_id,
        person.updated_at,
        person.cursor?.pageX,
        person.cursor?.pageY,
        person.cursor?.visible
      ])
    );

    collab.presence = nextPresence;

    if (peopleSignature !== collab.peopleSignature) {
      collab.peopleSignature = peopleSignature;
      renderPresence();
    }

    if (cursorSignature !== collab.presenceSignature) {
      collab.presenceSignature = cursorSignature;
      sendRemoteCursors();
    }
  } catch (error) {
    if (error?.status === 503) collab.unavailable = true;
  } finally {
    collab.presenceLoading = false;
  }
}

async function loadNotes() {
  if (!currentFrame() || collab.notesLoading) return;
  collab.page = currentPage();
  collab.notesLoading = true;

  try {
    const result = await collabRequest(
      `?kind=notes&page=${encodeURIComponent(collab.page)}`
    );
    collab.unavailable = result.available === false;
    const nextNotes = Array.isArray(result.notes) ? result.notes : [];
    const nextAllNotes = Array.isArray(result.allNotes)
      ? result.allNotes
      : nextNotes;

    if (result.self) {
      collab.self = result.self;
      collab.selfColour = result.self.colour || collab.selfColour;
    }

    const signature = JSON.stringify(
      nextAllNotes.map((note) => [
        note.id,
        note.page_path,
        note.updated_at,
        note.resolved,
        note.body,
        note.colour,
        note.anchor?.selector,
        note.anchor?.pageX,
        note.anchor?.pageY,
        note.anchor?.box?.pageX,
        note.anchor?.box?.pageY,
        note.anchor?.box?.width,
        note.anchor?.box?.height,
        ...(Array.isArray(note.replies)
          ? note.replies.flatMap((reply) => [
              reply.id,
              reply.updated_at,
              reply.body,
              reply.created_by_name
            ])
          : [])
      ])
    );

    if (signature !== collab.notesSignature) {
      collab.notesSignature = signature;
      collab.notes = nextNotes;
      collab.allNotes = nextAllNotes;
      ensurePresenceControl();
      ensureNoteTool();
      const active = document.activeElement;
      const isTyping =
        active?.id === "editor-note-draft" ||
        active?.classList?.contains("editor-note-reply-input");
      if (!isTyping) renderNotesPanel();
      sendNotesToPreview();
    }
  } catch (error) {
    if (error?.status === 503) collab.unavailable = true;
  } finally {
    collab.notesLoading = false;
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

function othersPresent() {
  return collab.presence.length > 0;
}

function schedulePoll(timerKey, load, activeMs, idleMs) {
  window.clearTimeout(collab[timerKey]);
  collab[timerKey] = null;
  if (!collab.active || document.visibilityState === "hidden") return;

  collab[timerKey] = window.setTimeout(async () => {
    collab[timerKey] = null;
    await load();
    schedulePoll(timerKey, load, activeMs, idleMs);
  }, othersPresent() ? activeMs : idleMs);
}

function schedulePresencePoll() {
  schedulePoll("presenceTimer", loadPresence, PRESENCE_ACTIVE_MS, PRESENCE_IDLE_MS);
}

function scheduleNotesPoll() {
  schedulePoll("notesTimer", loadNotes, NOTES_ACTIVE_MS, NOTES_IDLE_MS);
}

function queuePresenceWrite() {
  // Nobody else can see this cursor; the heartbeat keeps presence alive.
  if (!othersPresent()) return;
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
  window.clearTimeout(collab.presenceTimer);
  window.clearTimeout(collab.notesTimer);
  window.clearInterval(collab.heartbeatTimer);
  collab.presenceTimer = null;
  collab.presenceLoading = false;
  collab.notesTimer = null;
  collab.notesLoading = false;
  collab.heartbeatTimer = null;
  if (collab.noteSaveTimer) window.clearTimeout(collab.noteSaveTimer);
  collab.noteSaveTimer = null;
  leavePresence();
  collab.frame = null;
  collab.presence = [];
  collab.notes = [];
  collab.allNotes = [];
  collab.presenceSignature = "";
  collab.peopleSignature = "";
  collab.notesSignature = "";
}

function startCollaboration() {
  const frame = currentFrame();
  if (!frame) {
    stopCollaboration();
    return;
  }

  if (collab.active && collab.frame === frame) {
    refreshCollaborationChrome();
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

  loadPresence().then(schedulePresencePoll);
  loadNotes().then(scheduleNotesPoll);
  writePresence();

  collab.heartbeatTimer = window.setInterval(() => writePresence(), HEARTBEAT_MS);
}

// The editor re-renders its chrome around a kept iframe, which removes the
// presence chips and notes button without changing the frame.
function refreshCollaborationChrome() {
  ensurePresenceControl();
  collab.peopleSignature = "";
  renderPresence();
  ensureNoteTool();

  const workspace = document.querySelector(".editor-preview-placeholder.is-fullscreen");
  const panel = workspace?.querySelector("#editor-notes-panel");
  if (!workspace || !panel) {
    renderNotesPanel();
    return;
  }

  const open = collab.notesOpen && !workspace.classList.contains("has-code-dock");
  const wasOpen = panel.classList.contains("is-open");
  workspace.classList.toggle("has-notes-dock", open);
  panel.classList.toggle("is-open", open);
  if (open && !wasOpen) renderNotesPanel();
}

document.addEventListener("wcg:editor-rendered", () => {
  if (collab.active && collab.frame === currentFrame()) refreshCollaborationChrome();
});

document.addEventListener("click", async (event) => {
  const interaction = event.target?.closest?.("[data-editor-interaction]");
  const existingTool = event.target?.closest?.("[data-editor-tool]");

  if (
    interaction ||
    (existingTool && !existingTool.closest("#editor-collab-note-tool"))
  ) {
    if (collab.noteAnchor && !collab.noteDraftBody.trim() && !collab.noteDraftId) {
      clearPendingNoteHighlight();
      collab.noteAnchor = null;
      collab.noteDraftBody = "";
      collab.noteDraftId = "";
    }

    // Changing View/Edit/tools cancels only note-placement mode.
    // The notes sidebar stays open until the user explicitly clicks ×.
    collab.noteMode = false;

    const notesButton = document.querySelector("#editor-collab-note-tool");
    notesButton?.classList.toggle("is-active", collab.notesOpen);

    if (collab.notesOpen) renderNotesPanel();
  }

  const goto = event.target?.closest?.("[data-note-goto]");
  if (goto) {
    const note =
      collab.notes.find((item) => item.id === goto.dataset.noteGoto) ||
      collab.allNotes.find((item) => item.id === goto.dataset.noteGoto);
    if (!note) return;

    collab.selectedNoteId = note.id;

    if (note.page_path && note.page_path !== currentPage()) {
      collab.pendingNoteJump = {
        id: note.id,
        page: note.page_path,
        anchor: note.anchor || {}
      };

      const select = document.querySelector("#web-editor-page");
      if (select) {
        if (![...select.options].some((option) => option.value === note.page_path)) {
          const option = document.createElement("option");
          option.value = note.page_path;
          option.textContent = notePageLabel(note.page_path);
          select.appendChild(option);
        }
        select.value = note.page_path;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    collab.pendingNoteJump = null;
    postToPreview("WCG_EDITOR_GOTO_NOTE", { anchor: note.anchor || {}, noteId: note.id });
    return;
  }

  const resolve = event.target?.closest?.("[data-note-resolve]");
  if (resolve) {
    const note =
      collab.notes.find((item) => item.id === resolve.dataset.noteResolve) ||
      collab.allNotes.find((item) => item.id === resolve.dataset.noteResolve);
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

  const replyDelete = event.target?.closest?.("[data-reply-delete]");
  if (replyDelete) {
    const replyId = String(replyDelete.dataset.replyDelete || "");
    const noteId = String(replyDelete.dataset.noteId || "");
    if (!replyId) return;

    replyDelete.disabled = true;
    try {
      await collabRequest("", {
        method: "POST",
        body: {
          action: "reply_delete",
          page: currentPage(),
          id: replyId
        }
      });

      for (const note of [...collab.notes, ...collab.allNotes]) {
        if (note?.id !== noteId || !Array.isArray(note.replies)) continue;
        note.replies = note.replies.filter((reply) => reply.id !== replyId);
      }
      collab.notesSignature = "";
      renderNotesPanel();
      await loadNotes();
    } catch (error) {
      replyDelete.disabled = false;
      replyDelete.title = error?.message || "Unable to delete reply.";
    }
    return;
  }

  const remove = event.target?.closest?.("[data-note-delete]");
  if (remove) {
    const note =
      collab.notes.find((item) => item.id === remove.dataset.noteDelete) ||
      collab.allNotes.find((item) => item.id === remove.dataset.noteDelete);
    if (!note) return;

    const card = remove.closest(".editor-note-card");
    card?.classList.add("is-deleting");
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

      collab.notes = collab.notes.filter((item) => item.id !== note.id);
      collab.allNotes = collab.allNotes.filter((item) => item.id !== note.id);
      collab.selectedNoteId =
        collab.selectedNoteId === note.id ? "" : collab.selectedNoteId;
      collab.notesSignature = "";
      ensurePresenceControl();
      ensureNoteTool();
      sendNotesToPreview();
      renderNotesPanel();
    } catch (error) {
      card?.classList.remove("is-deleting");
      remove.disabled = false;
      remove.title = error?.message || "Unable to delete note.";
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target?.id !== "web-editor-page") return;
  collab.page = currentPage();
  collab.lastCursor = { visible: false };
  collab.notes = [];
  collab.allNotes = [];
  collab.notesSignature = "";
  collab.presenceSignature = "";
  collab.peopleSignature = "";
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
    document.querySelector("#editor-collab-note-tool")?.classList.add("is-active");
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
      if (collab.noteMode) {
        postToPreview("WCG_EDITOR_TOOL", { tool: "note", colour: collab.selfColour });
      }

      if (
        collab.pendingNoteJump &&
        collab.pendingNoteJump.page === currentPage()
      ) {
        const jump = collab.pendingNoteJump;
        collab.pendingNoteJump = null;
        postToPreview("WCG_EDITOR_GOTO_NOTE", {
          anchor: jump.anchor || {},
          noteId: jump.id
        });
      }
    }, 120);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    collab.lastCursor = { ...collab.lastCursor, visible: false };
    writePresence({ keepalive: true });
    window.clearTimeout(collab.presenceTimer);
    window.clearTimeout(collab.notesTimer);
    collab.presenceTimer = null;
    collab.notesTimer = null;
  } else if (currentFrame()) {
    collab.lastCursor = { ...collab.lastCursor, visible: true };
    writePresence();
    if (collab.active) {
      loadPresence().then(schedulePresencePoll);
      loadNotes().then(scheduleNotesPoll);
    }
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
