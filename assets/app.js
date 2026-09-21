const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
const MAX_MESSAGE_LENGTH = 4000;
const CONVERSATION_FIELDS = "id,status,page_path,created_at,updated_at,client_ip,visitor_city,visitor_region,visitor_country,visitor_country_code,visitor_timezone,browser_language,user_agent,staff_joined_at,joined_agent_id";

const app = document.querySelector("#app");
const DEFAULT_CONFIG = Object.freeze({
  supabaseUrl: "https://fmlrtcofnbqdotpvuaem.supabase.co",
  publishableKey: "sb_publishable_my0myBoo-Kdu4tMCOsdKiQ_l0uuIHpR"
});
const config = { ...DEFAULT_CONFIG, ...(window.WELL_SUPPORT_CONFIG || {}) };

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
  loadingMessages: false,
  pendingAvatarFile: null,
  removeAvatar: false
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

function visitorName() {
  return "Website visitor";
}

function visitorLocation(conversation) {
  const parts = [
    conversation?.visitor_city,
    conversation?.visitor_region,
    conversation?.visitor_country || conversation?.visitor_country_code
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "Location unavailable";
}

function visitorMapUrl(conversation) {
  const location = visitorLocation(conversation);
  if (!location || location === "Location unavailable") return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(location)}&z=10&output=embed`;
}

function visitorContextMeta(conversation) {
  return [
    conversation?.client_ip ? `IP ${conversation.client_ip}` : null,
    conversation?.visitor_timezone,
    conversation?.browser_language
  ].filter(Boolean).join(" · ");
}

function initials(name) {
  return String(name || "W")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "W";
}

function renderAvatarInto(element, avatarUrl, name) {
  if (!element) return;
  element.replaceChildren();

  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    element.appendChild(image);
    element.classList.add("has-image");
    return;
  }

  element.classList.remove("has-image");
  element.textContent = initials(name);
}

function refreshProfileUI() {
  const name = state.agent?.display_name || "Support staff";
  const avatarUrl = state.agent?.avatar_url || null;

  const topName = document.querySelector("#top-profile-name");
  if (topName) topName.textContent = name;

  const dropdownName = document.querySelector("#profile-dropdown-name");
  if (dropdownName) dropdownName.textContent = name;

  const dropdownEmail = document.querySelector("#profile-dropdown-email");
  if (dropdownEmail) dropdownEmail.textContent = state.user?.email || "";

  renderAvatarInto(document.querySelector("#top-profile-avatar"), avatarUrl, name);
  renderAvatarInto(document.querySelector("#profile-dropdown-avatar"), avatarUrl, name);
  renderAvatarInto(document.querySelector("#account-avatar-preview"), avatarUrl, name);
}

function closeProfileMenu() {
  const menu = document.querySelector("#profile-dropdown");
  const button = document.querySelector("#profile-menu-button");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleProfileMenu(event) {
  event?.stopPropagation();
  const menu = document.querySelector("#profile-dropdown");
  const button = document.querySelector("#profile-menu-button");
  if (!menu || !button) return;

  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function openAccountDetails() {
  closeProfileMenu();
  state.pendingAvatarFile = null;
  state.removeAvatar = false;

  const modal = document.querySelector("#account-modal");
  const nameInput = document.querySelector("#account-display-name");
  const emailInput = document.querySelector("#account-email");
  const removeButton = document.querySelector("#remove-avatar-button");

  if (nameInput) nameInput.value = state.agent?.display_name || "";
  if (emailInput) emailInput.value = state.user?.email || "";
  if (removeButton) removeButton.hidden = !state.agent?.avatar_url;

  refreshProfileUI();
  if (modal) {
    modal.hidden = false;
    requestAnimationFrame(() => nameInput?.focus());
  }
}

function closeAccountDetails() {
  state.pendingAvatarFile = null;
  state.removeAvatar = false;
  const modal = document.querySelector("#account-modal");
  if (modal) modal.hidden = true;
}

function previewAvatarFile(file) {
  const preview = document.querySelector("#account-avatar-preview");
  if (!preview || !file) return;

  const objectUrl = URL.createObjectURL(file);
  preview.replaceChildren();

  const image = document.createElement("img");
  image.src = objectUrl;
  image.alt = "Selected profile photo";
  image.onload = () => URL.revokeObjectURL(objectUrl);

  preview.appendChild(image);
  preview.classList.add("has-image");
}

async function saveAccountDetails(event) {
  event.preventDefault();

  const nameInput = document.querySelector("#account-display-name");
  const saveButton = document.querySelector("#account-save-button");
  const displayName = String(nameInput?.value || "").trim();

  if (!displayName || displayName.length > 120) {
    showToast("Enter a staff display name between 1 and 120 characters.", "error");
    return;
  }

  if (!state.user || !state.agent) return;

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
  }

  try {
    const client = await getClient();
    let avatarUrl = state.agent.avatar_url || null;

    if (state.removeAvatar) {
      const { error: removeError } = await client.storage
        .from("support-avatars")
        .remove([`${state.user.id}/profile`]);

      if (removeError && !String(removeError.message || "").toLowerCase().includes("not found")) {
        throw removeError;
      }

      avatarUrl = null;
    }

    if (state.pendingAvatarFile) {
      const file = state.pendingAvatarFile;
      const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

      if (!allowedTypes.has(file.type)) {
        throw new Error("Use a JPG, PNG, WebP, or GIF profile photo.");
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error("Profile photos must be 5 MB or smaller.");
      }

      const objectPath = `${state.user.id}/profile`;
      const { error: uploadError } = await client.storage
        .from("support-avatars")
        .upload(objectPath, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600"
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = client.storage
        .from("support-avatars")
        .getPublicUrl(objectPath);

      avatarUrl = publicData?.publicUrl
        ? `${publicData.publicUrl}?v=${Date.now()}`
        : null;
    }

    const { data, error } = await client
      .from("support_agents")
      .update({
        display_name: displayName,
        avatar_url: avatarUrl
      })
      .eq("user_id", state.user.id)
      .select("user_id,display_name,avatar_url,active")
      .single();

    if (error) throw error;

    state.agent = data;
    state.pendingAvatarFile = null;
    state.removeAvatar = false;
    refreshProfileUI();
    closeAccountDetails();
    showToast("Account details updated.");
  } catch (error) {
    showToast(error?.message || "Unable to update account details.", "error");
  } finally {
    const currentSave = document.querySelector("#account-save-button");
    if (currentSave) {
      currentSave.disabled = false;
      currentSave.textContent = "Save changes";
    }
  }
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
    .select("user_id,display_name,avatar_url,active")
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
      <div class="staff-profile-shell">
        <button
          id="profile-menu-button"
          class="staff-profile-button"
          type="button"
          aria-haspopup="menu"
          aria-expanded="false"
        >
          <span id="top-profile-avatar" class="staff-profile-avatar"></span>
          <span id="top-profile-name" class="staff-profile-name"></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg>
        </button>

        <div id="profile-dropdown" class="profile-dropdown" role="menu" hidden>
          <div class="profile-dropdown-head">
            <span id="profile-dropdown-avatar" class="staff-profile-avatar is-large"></span>
            <div>
              <strong id="profile-dropdown-name"></strong>
              <span id="profile-dropdown-email"></span>
            </div>
          </div>
          <button id="account-details-button" class="profile-dropdown-action" type="button" role="menuitem">
            Account details
          </button>
          <button id="profile-signout-button" class="profile-dropdown-action is-danger" type="button" role="menuitem">
            Sign out
          </button>
        </div>
      </div>

      <div id="account-modal" class="account-modal" hidden>
        <button id="account-modal-backdrop" class="account-modal-backdrop" type="button" aria-label="Close account details"></button>
        <section class="account-card" role="dialog" aria-modal="true" aria-labelledby="account-title">
          <div class="account-card-head">
            <div>
              <span class="account-eyebrow">Staff profile</span>
              <h2 id="account-title">Account details</h2>
            </div>
            <button id="account-close-button" class="account-close-button" type="button" aria-label="Close account details">×</button>
          </div>

          <form id="account-form">
            <div class="account-avatar-row">
              <span id="account-avatar-preview" class="account-avatar-preview"></span>
              <div class="account-avatar-actions">
                <label class="account-photo-button" for="account-avatar-input">Change photo</label>
                <input id="account-avatar-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
                <button id="remove-avatar-button" class="account-remove-photo" type="button">Remove photo</button>
                <small>JPG, PNG, WebP or GIF · max 5 MB</small>
              </div>
            </div>

            <label class="account-field" for="account-display-name">
              <span>Display name</span>
              <input id="account-display-name" type="text" maxlength="120" autocomplete="name" required />
              <small>This is the name visitors see in support chat replies.</small>
            </label>

            <label class="account-field" for="account-email">
              <span>Email</span>
              <input id="account-email" type="email" disabled />
            </label>

            <div class="account-actions">
              <button id="account-cancel-button" class="account-secondary-button" type="button">Cancel</button>
              <button id="account-save-button" class="account-primary-button" type="submit">Save changes</button>
            </div>
          </form>
        </section>
      </div>
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

  refreshProfileUI();

  document.querySelector("#profile-menu-button")?.addEventListener("click", toggleProfileMenu);
  document.querySelector("#account-details-button")?.addEventListener("click", openAccountDetails);
  document.querySelector("#profile-signout-button")?.addEventListener("click", signOut);
  document.querySelector("#account-close-button")?.addEventListener("click", closeAccountDetails);
  document.querySelector("#account-modal-backdrop")?.addEventListener("click", closeAccountDetails);
  document.querySelector("#account-cancel-button")?.addEventListener("click", closeAccountDetails);
  document.querySelector("#account-form")?.addEventListener("submit", saveAccountDetails);

  document.querySelector("#account-avatar-input")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    state.pendingAvatarFile = file;
    state.removeAvatar = false;
    previewAvatarFile(file);
    const removeButton = document.querySelector("#remove-avatar-button");
    if (removeButton) removeButton.hidden = false;
  });

  document.querySelector("#remove-avatar-button")?.addEventListener("click", () => {
    state.pendingAvatarFile = null;
    state.removeAvatar = true;
    renderAvatarInto(
      document.querySelector("#account-avatar-preview"),
      null,
      document.querySelector("#account-display-name")?.value || state.agent?.display_name
    );
    const input = document.querySelector("#account-avatar-input");
    if (input) input.value = "";
    const removeButton = document.querySelector("#remove-avatar-button");
    if (removeButton) removeButton.hidden = true;
  });

  document.addEventListener("click", (event) => {
    const shell = document.querySelector(".staff-profile-shell");
    if (shell && !shell.contains(event.target)) closeProfileMenu();
  }, { once: false });
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
        .select(CONVERSATION_FIELDS)
        .order("created_at", { ascending: false })
        .limit(500),
      client
        .from("support_messages")
        .select("id,conversation_id,sender_type,sender_display_name,sender_avatar_url,body,created_at")
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
    conversation.page_path,
    conversation.client_ip,
    conversation.visitor_city,
    conversation.visitor_region,
    conversation.visitor_country,
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

async function markConversationJoined(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation || conversation.status !== "open" || conversation.staff_joined_at || !state.user) return;

  const client = await getClient();
  const joinedAt = new Date().toISOString();

  const { data: joinedConversation, error: joinError } = await client
    .from("support_conversations")
    .update({
      staff_joined_at: joinedAt,
      joined_agent_id: state.user.id,
      updated_at: joinedAt
    })
    .eq("id", id)
    .is("staff_joined_at", null)
    .select(CONVERSATION_FIELDS)
    .maybeSingle();

  if (joinError) throw joinError;
  if (!joinedConversation) return;

  upsertConversation(joinedConversation);

  const staffName = state.agent?.display_name || "Staff member";

  const { data: systemMessage, error: messageError } = await client
    .from("support_messages")
    .insert({
      conversation_id: id,
      sender_type: "system",
      sender_user_id: state.user.id,
      sender_display_name: staffName,
      sender_avatar_url: state.agent?.avatar_url || null,
      body: `${staffName} has joined your chat`
    })
    .select("id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at")
    .single();

  if (messageError) throw messageError;
  appendMessage(systemMessage);
}

async function selectConversation(id) {
  state.selectedId = id;
  state.unread.delete(id);
  document.querySelector("#dashboard")?.classList.add("has-selection");
  renderConversationList();
  renderChatShell();
  await loadMessages(id);

  try {
    await markConversationJoined(id);
  } catch (error) {
    showToast(error?.message || "Unable to mark the conversation as joined.", "error");
  }
}

function renderChatShell() {
  const panel = document.querySelector("#chat-panel");
  const conversation = currentConversation();
  if (!panel || !conversation) return;

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
        <span class="status-chip is-open">Open</span>
        <button id="close-chat-button" class="toolbar-button is-close-chat" type="button">
          ${closeIcon()}
          <span>Close chat</span>
        </button>
      </div>
    </header>

    <div class="visitor-context-bar">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"></path>
        <circle cx="12" cy="10" r="2"></circle>
      </svg>
      <div>
        <strong id="visitor-location"></strong>
        <span id="visitor-context-meta"></span>
      </div>
    </div>

    <div id="visitor-map-wrap" class="visitor-map-wrap" hidden>
      <iframe
        id="visitor-map"
        title="Visitor approximate city"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        aria-label="Approximate visitor city map"
      ></iframe>
      <div class="visitor-map-pin-label">
        <span class="visitor-map-pin" aria-hidden="true"></span>
        <strong id="visitor-map-city"></strong>
      </div>
    </div>

    <div id="messages" class="messages"></div>
    <div id="composer-slot"></div>
  `;

  const location = visitorLocation(conversation);
  document.querySelector("#chat-visitor-name").textContent = visitorName(conversation);
  document.querySelector("#chat-source-path").textContent =
    conversation.page_path || "Well College Global website";
  document.querySelector("#visitor-location").textContent = location;
  document.querySelector("#visitor-context-meta").textContent =
    visitorContextMeta(conversation) || "Temporary support context unavailable";

  const mapUrl = visitorMapUrl(conversation);
  const mapWrap = document.querySelector("#visitor-map-wrap");
  const map = document.querySelector("#visitor-map");
  const mapCity = document.querySelector("#visitor-map-city");

  if (mapUrl && mapWrap && map) {
    map.src = mapUrl;
    mapWrap.hidden = false;
    if (mapCity) mapCity.textContent = location;
  }

  document.querySelector("#mobile-back")?.addEventListener("click", () => {
    state.selectedId = null;
    state.messages = [];
    document.querySelector("#dashboard")?.classList.remove("has-selection");
    renderConversationList();
  });

  document.querySelector("#close-chat-button")?.addEventListener("click", deleteConversation);
  renderComposer();
}

async function loadMessages(conversationId) {
  state.loadingMessages = true;
  renderMessages();

  try {
    const client = await getClient();
    const { data, error } = await client
      .from("support_messages")
      .select("id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at")
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
      ? (message.sender_user_id === state.user?.id
          ? `You · ${message.sender_display_name || state.agent?.display_name || "Support"}`
          : (message.sender_display_name || "Well College Global"))
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

    if (kind === "agent") {
      const avatar = document.createElement("span");
      avatar.className = "message-agent-avatar";
      renderAvatarInto(
        avatar,
        message.sender_avatar_url || (message.sender_user_id === state.user?.id ? state.agent?.avatar_url : null),
        message.sender_display_name || (message.sender_user_id === state.user?.id ? state.agent?.display_name : "W")
      );
      row.append(avatar, bubble);
    } else {
      row.appendChild(bubble);
    }

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
        sender_display_name: state.agent?.display_name || "Well College Global",
        sender_avatar_url: state.agent?.avatar_url || null,
        body
      })
      .select("id,conversation_id,sender_type,sender_user_id,sender_display_name,sender_avatar_url,body,created_at")
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

async function deleteConversation() {
  const conversation = currentConversation();
  if (!conversation) return;

  const button = document.querySelector("#close-chat-button");
  if (button) {
    button.disabled = true;
    const label = button.querySelector("span");
    if (label) label.textContent = "Closing…";
  }

  try {
    const client = await getClient();
    const { error } = await client
      .from("support_conversations")
      .delete()
      .eq("id", conversation.id);

    if (error) throw error;

    state.conversations = state.conversations.filter((item) => item.id !== conversation.id);
    state.lastMessages.delete(conversation.id);
    state.unread.delete(conversation.id);
    state.selectedId = null;
    state.messages = [];

    document.querySelector("#dashboard")?.classList.remove("has-selection");
    renderConversationList();
    renderDashboardChatEmpty();
    showToast("Chat closed and deleted.");
  } catch (error) {
    showToast(error?.message || "Unable to close this chat.", "error");

    const currentButton = document.querySelector("#close-chat-button");
    if (currentButton) {
      currentButton.disabled = false;
      const label = currentButton.querySelector("span");
      if (label) label.textContent = "Close chat";
    }
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
