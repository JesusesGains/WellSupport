const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
const MAX_MESSAGE_LENGTH = 4000;

const app = document.querySelector("#app");
const config = window.WELL_SUPPORT_CONFIG || {};

const state = {
  client: null,
  agent: null,
  user: null,
  conversations: [],
  lastMessages: new Map(),
  messages: [],
  selectedId: null,
  unread: new Set(),
  filter: "open",
  search: "",
  realtimeStatus: "connecting",
  channel: null,
  loadingInbox: false,
  loadingMessages: false
};

function configured() {
  return Boolean(
    String(config.supabaseUrl || "").trim() &&
    String(config.publishableKey || "").trim()
  );
}

function formatTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short" }
  ).format(date);
}

function formatDay(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function visitorName(conversation) {
  const id = String(conversation?.visitor_id || "");
  return `Visitor ${id.slice(0, 6).toUpperCase() || "Unknown"}`;
}

function initials(name) {
  return String(name || "W")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "W";
}

function chatIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z"></path><path d="M9 9h6M9 12h4"></path></svg>`;
}

function sendIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 8-16 8 3-8-3-8Z"></path><path d="M7 12h13"></path></svg>`;
}

function closeIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg>`;
}

function reopenIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68"></path><path d="M4 4v4.68h4.68"></path></svg>`;
}

function backIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg>`;
}

function inboxIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="M4 14h4l2 2h4l2-2h4"></path></svg>`;
}

function searchIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg>`;
}

function showToast(message, tone = "default") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }

  const toast = document.createElement("div");
  toast.className = `toast${tone === "error" ? " is-error" : ""}`;
  toast.textContent = message;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.remove();
    if (!stack.children.length) stack.remove();
  }, 3600);
}

async function getClient() {
  if (state.client) return state.client;
  if (!configured()) throw new Error("Supabase is not configured for Well Support.");

  const { createClient } = await import(SDK_URL);
  state.client = createClient(
    String(config.supabaseUrl).trim(),
    String(config.publishableKey).trim(),
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    }
  );

  state.client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      cleanupRealtime();
      state.agent = null;
      state.user = null;
      state.conversations = [];
      state.messages = [];
      state.selectedId = null;
      renderLogin();
    }
  });

  return state.client;
}

async function loadStaff(userId) {
  const client = await getClient();
  const { data, error } = await client
    .from("support_agents")
    .select("user_id,display_name,active")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function verifyCurrentStaff() {
  const client = await getClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;

  if (data.user.is_anonymous) {
    await client.auth.signOut();
    return null;
  }

  const agent = await loadStaff(data.user.id);
  if (!agent) {
    await client.auth.signOut();
    return null;
  }

  state.user = data.user;
  state.agent = agent;
  return { user: data.user, agent };
}

function renderLogin(message = "") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="staff-sign-in-title">
        <div class="auth-brand">
          <span class="brand-mark" aria-hidden="true">W</span>
          <div class="auth-brand-copy">
            <strong>Well Support</strong>
            <span>Well College Global</span>
          </div>
        </div>
        <h1 id="staff-sign-in-title">Staff sign in</h1>
        <p>Access live website conversations and reply to learners in real time.</p>
        <div id="auth-error" class="auth-error" role="status" ${message ? "" : "hidden"}></div>
        <form id="login-form" class="auth-form" autocomplete="on">
          <div class="field">
            <label for="staff-email">Email</label>
            <input id="staff-email" name="email" type="email" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="staff-password">Password</label>
            <input id="staff-password" name="password" type="password" autocomplete="current-password" required />
          </div>
          <button id="login-submit" class="auth-submit" type="submit" ${configured() ? "" : "disabled"}>Sign in</button>
        </form>
      </section>
    </main>
  `;

  const errorBox = document.querySelector("#auth-error");
  if (message && errorBox) errorBox.textContent = message;

  document.querySelector("#login-form")?.addEventListener("submit", handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  if (!configured()) return;

  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const submit = document.querySelector("#login-submit");
  const errorBox = document.querySelector("#auth-error");

  if (submit) {
    submit.disabled = true;
    submit.textContent = "Signing in…";
  }
  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  try {
    const client = await getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data?.user) throw new Error("Unable to sign in.");

    if (data.user.is_anonymous) {
      await client.auth.signOut();
      throw new Error("This account is not permitted to access staff support.");
    }

    const agent = await loadStaff(data.user.id);
    if (!agent) {
      await client.auth.signOut();
      throw new Error("This account does not have Well Support access.");
    }

    state.user = data.user;
    state.agent = agent;
    renderDashboard();
    await initialiseDashboard();
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error?.message || "Unable to sign in.";
      errorBox.hidden = false;
    }
  } finally {
    if (submit && document.body.contains(submit)) {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  }
}

function renderDashboard() {
  app.innerHTML = `
    <main id="dashboard" class="dashboard">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <span class="brand-mark" aria-hidden="true">W</span>
          <div class="sidebar-brand-copy">
            <strong>Well Support</strong>
            <span>Live assistance</span>
          </div>
        </div>

        <nav class="nav-group" aria-label="Support navigation">
          <button class="nav-button is-active" type="button">
            ${inboxIcon()}
            <span>Inbox</span>
          </button>
        </nav>

        <div class="sidebar-live">
          <i id="sidebar-live-dot" class="live-dot is-connecting" aria-hidden="true"></i>
          <span id="sidebar-live-copy">Connecting</span>
        </div>

        <div class="sidebar-spacer"></div>

        <div class="agent-card">
          <div class="agent-row">
            <span id="agent-avatar" class="agent-avatar">W</span>
            <div class="agent-copy">
              <strong id="agent-name">Support staff</strong>
              <span id="agent-email">Authenticated</span>
            </div>
          </div>
          <button id="signout-button" class="signout-button" type="button">Sign out</button>
        </div>
      </aside>

      <section class="inbox-panel" aria-label="Support conversations">
        <header class="inbox-header">
          <div class="eyebrow"><i aria-hidden="true"></i> Website support</div>
          <div class="inbox-title-row">
            <h1>Inbox</h1>
            <span id="open-count" class="open-count">0</span>
          </div>
        </header>

        <div class="inbox-tools">
          <label class="search-wrap">
            ${searchIcon()}
            <input id="conversation-search" type="search" placeholder="Search conversations" autocomplete="off" />
          </label>
          <div class="filter-row" role="group" aria-label="Conversation status">
            <button class="filter-button is-active" type="button" data-filter="open">Open</button>
            <button class="filter-button" type="button" data-filter="all">All</button>
            <button class="filter-button" type="button" data-filter="closed">Closed</button>
          </div>
        </div>

        <div id="conversation-list" class="conversation-list"></div>
      </section>

      <section id="chat-panel" class="chat-panel" aria-label="Selected support conversation">
        <div class="chat-empty">
          <div class="chat-empty-card">
            <div class="chat-empty-icon">${chatIcon()}</div>
            <h2>Select a conversation</h2>
            <p>Open a website chat to view its message history and reply as Well College Global support.</p>
          </div>
        </div>
      </section>
    </main>
  `;

  document.querySelector("#agent-name").textContent = state.agent?.display_name || "Support staff";
  document.querySelector("#agent-email").textContent = state.user?.email || "Authenticated";
  document.querySelector("#agent-avatar").textContent = initials(state.agent?.display_name);

  document.querySelector("#signout-button")?.addEventListener("click", signOut);
  document.querySelector("#conversation-search")?.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderConversationList();
  });

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter || "open";
      document.querySelectorAll(".filter-button").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      renderConversationList();
    });
  });

  renderRealtimeStatus();
}

async function initialiseDashboard() {
  await loadInbox();
  subscribeRealtime();
}

async function loadInbox() {
  state.loadingInbox = true;
  renderConversationList();

  try {
    const client = await getClient();
    const [conversationResult, messageResult] = await Promise.all([
      client
        .from("support_conversations")
        .select("id,visitor_id,status,page_path,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      client
        .from("support_messages")
        .select("id,conversation_id,sender_type,body,created_at")
        .order("created_at", { ascending: false })
        .limit(1000)
    ]);

    if (conversationResult.error) throw conversationResult.error;
    if (messageResult.error) throw messageResult.error;

    state.conversations = conversationResult.data || [];
    state.lastMessages = new Map();

    for (const message of messageResult.data || []) {
      if (!state.lastMessages.has(message.conversation_id)) {
        state.lastMessages.set(message.conversation_id, message);
      }
    }
  } catch (error) {
    showToast(error?.message || "Unable to load support inbox.", "error");
  } finally {
    state.loadingInbox = false;
    renderConversationList();
  }
}

function sortedConversations() {
  return [...state.conversations].sort((a, b) => {
    const aDate = new Date(state.lastMessages.get(a.id)?.created_at || a.created_at).getTime() || 0;
    const bDate = new Date(state.lastMessages.get(b.id)?.created_at || b.created_at).getTime() || 0;
    return bDate - aDate;
  });
}

function conversationMatches(conversation) {
  if (state.filter !== "all" && conversation.status !== state.filter) return false;
  if (!state.search) return true;

  const last = state.lastMessages.get(conversation.id);
  return [
    conversation.id,
    conversation.visitor_id,
    conversation.page_path,
    last?.body
  ].some((value) => String(value || "").toLowerCase().includes(state.search));
}

function renderConversationList() {
  const list = document.querySelector("#conversation-list");
  if (!list) return;

  const openCount = state.conversations.filter((conversation) => conversation.status === "open").length;
  const count = document.querySelector("#open-count");
  if (count) count.textContent = String(openCount);

  if (state.loadingInbox) {
    list.innerHTML = `
      <div class="list-loading">
        <div class="skeleton-stack" aria-label="Loading conversations">
          <div class="skeleton-row"></div>
          <div class="skeleton-row"></div>
          <div class="skeleton-row"></div>
          <div class="skeleton-row"></div>
        </div>
      </div>
    `;
    return;
  }

  const matches = sortedConversations().filter(conversationMatches);
  list.replaceChildren();

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = state.search
      ? "No conversations match your search."
      : state.filter === "open"
        ? "No open conversations."
        : "No conversations to show.";
    list.appendChild(empty);
    return;
  }

  for (const conversation of matches) {
    const last = state.lastMessages.get(conversation.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    button.classList.toggle("is-selected", state.selectedId === conversation.id);
    button.dataset.conversationId = conversation.id;

    const top = document.createElement("div");
    top.className = "conversation-top";

    const name = document.createElement("span");
    name.className = "conversation-name";
    name.textContent = visitorName(conversation);

    const time = document.createElement("time");
    time.className = "conversation-time";
    time.dateTime = last?.created_at || conversation.created_at;
    time.textContent = formatTime(last?.created_at || conversation.created_at);

    top.append(name, time);

    const preview = document.createElement("div");
    preview.className = "conversation-preview";
    preview.textContent = last?.body || "Conversation started";

    const meta = document.createElement("div");
    meta.className = "conversation-meta";

    const path = document.createElement("span");
    path.className = "conversation-path";
    path.textContent = conversation.page_path || "Website";

    const chip = document.createElement("span");
    chip.className = `status-chip is-${conversation.status}`;
    chip.textContent = conversation.status === "open" ? "Open" : "Closed";

    meta.append(path, chip);
    button.append(top, preview, meta);

    if (state.unread.has(conversation.id)) {
      const unread = document.createElement("span");
      unread.className = "unread-dot";
      unread.setAttribute("aria-label", "Unread message");
      button.appendChild(unread);
    }

    button.addEventListener("click", () => selectConversation(conversation.id));
    list.appendChild(button);
  }
}

function currentConversation() {
  return state.conversations.find((conversation) => conversation.id === state.selectedId) || null;
}

async function selectConversation(id) {
  state.selectedId = id;
  state.unread.delete(id);
  document.querySelector("#dashboard")?.classList.add("has-selection");
  renderConversationList();
  renderChatShell();
  await loadMessages(id);
}

function renderChatShell() {
  const panel = document.querySelector("#chat-panel");
  const conversation = currentConversation();
  if (!panel || !conversation) return;

  const closed = conversation.status === "closed";
  panel.innerHTML = `
    <header class="chat-header">
      <div class="chat-person">
        <button id="mobile-back" class="mobile-back" type="button" aria-label="Back to inbox">
          ${backIcon()}
        </button>
        <span class="visitor-avatar">V</span>
        <div class="chat-person-copy">
          <strong id="chat-visitor-name"></strong>
          <span id="chat-source-path"></span>
        </div>
      </div>
      <div class="chat-actions">
        <span class="status-chip is-${conversation.status}">${closed ? "Closed" : "Open"}</span>
        <button id="status-button" class="toolbar-button ${closed ? "is-reopen" : ""}" type="button">
          ${closed ? reopenIcon() : closeIcon()}
          <span>${closed ? "Reopen" : "Close"}</span>
        </button>
      </div>
    </header>
    <div id="messages" class="messages"></div>
    <div id="composer-slot"></div>
  `;

  document.querySelector("#chat-visitor-name").textContent = visitorName(conversation);
  document.querySelector("#chat-source-path").textContent = conversation.page_path || "Well College Global website";
  document.querySelector("#mobile-back")?.addEventListener("click", () => {
    state.selectedId = null;
    state.messages = [];
    document.querySelector("#dashboard")?.classList.remove("has-selection");
    renderConversationList();
  });
  document.querySelector("#status-button")?.addEventListener("click", toggleConversationStatus);
  renderComposer();
}

async function loadMessages(conversationId) {
  state.loadingMessages = true;
  renderMessages();

  try {
    const client = await getClient();
    const { data, error } = await client
      .from("support_messages")
      .select("id,conversation_id,sender_type,sender_user_id,body,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;
    if (state.selectedId === conversationId) {
      state.messages = data || [];
    }
  } catch (error) {
    showToast(error?.message || "Unable to load messages.", "error");
  } finally {
    state.loadingMessages = false;
    if (state.selectedId === conversationId) renderMessages();
  }
}

function renderMessages() {
  const viewport = document.querySelector("#messages");
  if (!viewport) return;

  viewport.replaceChildren();

  if (state.loadingMessages) {
    const loading = document.createElement("div");
    loading.className = "messages-loading";
    loading.textContent = "Loading conversation…";
    viewport.appendChild(loading);
    return;
  }

  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "messages-loading";
    empty.textContent = "No messages yet.";
    viewport.appendChild(empty);
    return;
  }

  let previousDay = "";

  for (const message of state.messages) {
    const day = formatDay(message.created_at);
    if (day !== previousDay) {
      const dayLabel = document.createElement("div");
      dayLabel.className = "message-day";
      dayLabel.textContent = day;
      viewport.appendChild(dayLabel);
      previousDay = day;
    }

    const row = document.createElement("div");
    const kind = message.sender_type === "agent"
      ? "agent"
      : message.sender_type === "system"
        ? "system"
        : "visitor";
    row.className = `message-row is-${kind}`;

    const bubble = document.createElement("article");
    bubble.className = "message-bubble";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const sender = document.createElement("strong");
    sender.textContent = kind === "agent"
      ? (message.sender_user_id === state.user?.id ? "You" : "Well College Global")
      : kind === "visitor"
        ? visitorName(currentConversation())
        : "System";

    const time = document.createElement("time");
    time.dateTime = message.created_at;
    time.textContent = formatTime(message.created_at);

    meta.append(sender, time);

    const body = document.createElement("p");
    body.className = "message-body";
    body.textContent = message.body;

    bubble.append(meta, body);
    row.appendChild(bubble);
    viewport.appendChild(row);
  }

  requestAnimationFrame(() => {
    viewport.scrollTop = viewport.scrollHeight;
  });
}

function renderComposer() {
  const slot = document.querySelector("#composer-slot");
  const conversation = currentConversation();
  if (!slot || !conversation) return;

  if (conversation.status === "closed") {
    slot.innerHTML = `
      <div class="composer">
        <div class="closed-banner">
          <span>This conversation is closed. Reopen it to send another reply.</span>
          <button id="reopen-inline" type="button">Reopen</button>
        </div>
      </div>
    `;
    document.querySelector("#reopen-inline")?.addEventListener("click", toggleConversationStatus);
    return;
  }

  slot.innerHTML = `
    <form id="composer-form" class="composer">
      <div class="composer-inner">
        <textarea
          id="message-input"
          rows="1"
          maxlength="${MAX_MESSAGE_LENGTH}"
          placeholder="Reply as Well College Global…"
          aria-label="Support reply"
        ></textarea>
        <button id="send-button" class="send-button" type="submit" disabled aria-label="Send reply">
          ${sendIcon()}
        </button>
      </div>
      <div class="composer-note">
        <span>Enter to send · Shift + Enter for a new line</span>
        <span>Powered by <strong>Well College Global</strong></span>
      </div>
    </form>
  `;

  const form = document.querySelector("#composer-form");
  const input = document.querySelector("#message-input");
  const button = document.querySelector("#send-button");

  input?.addEventListener("input", () => {
    if (button) button.disabled = !input.value.trim();
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form?.requestSubmit();
    }
  });

  form?.addEventListener("submit", sendReply);
}

async function sendReply(event) {
  event.preventDefault();
  const input = document.querySelector("#message-input");
  const button = document.querySelector("#send-button");
  const body = String(input?.value || "").trim();
  const conversation = currentConversation();

  if (!body || !conversation || conversation.status !== "open" || !state.user) return;
  if (body.length > MAX_MESSAGE_LENGTH) return;

  if (button) button.disabled = true;
  if (input) input.disabled = true;

  try {
    const client = await getClient();
    const { data, error } = await client
      .from("support_messages")
      .insert({
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_user_id: state.user.id,
        body
      })
      .select("id,conversation_id,sender_type,sender_user_id,body,created_at")
      .single();

    if (error) throw error;
    appendMessage(data);

    if (input) {
      input.value = "";
      input.style.height = "auto";
    }
  } catch (error) {
    showToast(error?.message || "Unable to send reply.", "error");
  } finally {
    if (input) input.disabled = false;
    if (button) button.disabled = !String(input?.value || "").trim();
    input?.focus();
  }
}

function appendMessage(message) {
  if (!message?.id) return;

  state.lastMessages.set(message.conversation_id, message);

  if (state.selectedId === message.conversation_id) {
    if (!state.messages.some((item) => item.id === message.id)) {
      state.messages.push(message);
      renderMessages();
    }
    state.unread.delete(message.conversation_id);
  } else if (message.sender_type === "visitor") {
    state.unread.add(message.conversation_id);
  }

  renderConversationList();
}

async function toggleConversationStatus() {
  const conversation = currentConversation();
  if (!conversation) return;

  const nextStatus = conversation.status === "open" ? "closed" : "open";
  const button = document.querySelector("#status-button");
  if (button) button.disabled = true;

  try {
    const client = await getClient();
    const { data, error } = await client
      .from("support_conversations")
      .update({ status: nextStatus })
      .eq("id", conversation.id)
      .select("id,visitor_id,status,page_path,created_at")
      .single();

    if (error) throw error;
    upsertConversation(data);
    renderChatShell();
    renderMessages();
    showToast(nextStatus === "closed" ? "Conversation closed." : "Conversation reopened.");
  } catch (error) {
    showToast(error?.message || "Unable to update conversation.", "error");
  } finally {
    const currentButton = document.querySelector("#status-button");
    if (currentButton) currentButton.disabled = false;
  }
}

function upsertConversation(conversation) {
  if (!conversation?.id) return;
  const index = state.conversations.findIndex((item) => item.id === conversation.id);
  if (index >= 0) state.conversations[index] = { ...state.conversations[index], ...conversation };
  else state.conversations.unshift(conversation);
  renderConversationList();
}

function subscribeRealtime() {
  cleanupRealtime();
  state.realtimeStatus = "connecting";
  renderRealtimeStatus();

  const client = state.client;
  if (!client) return;

  state.channel = client
    .channel("well-support-dashboard")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "support_conversations" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          state.conversations = state.conversations.filter((item) => item.id !== payload.old?.id);
          if (state.selectedId === payload.old?.id) {
            state.selectedId = null;
            state.messages = [];
            document.querySelector("#dashboard")?.classList.remove("has-selection");
            renderDashboardChatEmpty();
          }
          renderConversationList();
          return;
        }

        upsertConversation(payload.new);
        if (state.selectedId === payload.new?.id) {
          renderChatShell();
          renderMessages();
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "support_messages" },
      (payload) => appendMessage(payload.new)
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") state.realtimeStatus = "live";
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") state.realtimeStatus = "error";
      else state.realtimeStatus = "connecting";
      renderRealtimeStatus();
    });
}

function renderDashboardChatEmpty() {
  const panel = document.querySelector("#chat-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="chat-empty">
      <div class="chat-empty-card">
        <div class="chat-empty-icon">${chatIcon()}</div>
        <h2>Select a conversation</h2>
        <p>Open a website chat to view its message history and reply as Well College Global support.</p>
      </div>
    </div>
  `;
}

function renderRealtimeStatus() {
  const dot = document.querySelector("#sidebar-live-dot");
  const copy = document.querySelector("#sidebar-live-copy");
  if (!dot || !copy) return;

  dot.className = "live-dot";
  if (state.realtimeStatus === "live") {
    dot.classList.add("is-live");
    copy.textContent = "Realtime live";
  } else if (state.realtimeStatus === "error") {
    dot.classList.add("is-error");
    copy.textContent = "Reconnect needed";
  } else {
    dot.classList.add("is-connecting");
    copy.textContent = "Connecting";
  }
}

function cleanupRealtime() {
  if (state.client && state.channel) {
    state.client.removeChannel(state.channel);
  }
  state.channel = null;
}

async function signOut() {
  try {
    cleanupRealtime();
    await state.client?.auth.signOut();
  } catch (error) {
    showToast(error?.message || "Unable to sign out.", "error");
  }
}

async function bootstrap() {
  if (!configured()) {
    renderLogin();
    return;
  }

  try {
    const client = await getClient();
    const { data } = await client.auth.getSession();

    if (!data?.session) {
      renderLogin();
      return;
    }

    const verified = await verifyCurrentStaff();
    if (!verified) {
      renderLogin("Your session does not have Well Support access.");
      return;
    }

    renderDashboard();
    await initialiseDashboard();
  } catch (error) {
    renderLogin(error?.message || "Unable to initialise Well Support.");
  }
}

bootstrap();
