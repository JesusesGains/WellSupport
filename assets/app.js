const MAX_MESSAGE_LENGTH = 4000;

const app = document.querySelector("#app");
const state = {
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
  loadingInbox: false,
  loadingMessages: false,
  pendingAvatarFile: null,
  removeAvatar: false,
  pollTimer: null,
  messagePollTimer: null,
  pollBusy: false,
  messagePollBusy: false,
  currentView: "dashboard",
  analytics: null,
  analyticsDays: 30,
  analyticsLoading: false,
  analyticsTimer: null,
  unreadCounts: new Map(),
  knownVisitorMessageIds: new Set(),
  notificationsReady: false
};

function configured() {
  return true;
}

async function apiRequest(path, {
  method = "GET",
  body,
  formData
} = {}) {
  const headers = new Headers({
    "X-Well-Support-Request": "1"
  });

  let requestBody;

  if (formData) {
    requestBody = formData;
  } else if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`/api/staff${path}`, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: requestBody
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // handled below
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      cleanupRealtime();
      state.agent = null;
      state.user = null;
      state.conversations = [];
      state.messages = [];
      state.selectedId = null;
      renderLogin(response.status === 403 ? payload?.error || "Access denied." : "");
    }

    const error = new Error(payload?.error || "Support request failed.");
    error.status = response.status;
    throw error;
  }

  return payload;
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

function safeStaffAvatarUrl(avatarUrl) {
  const value = String(avatarUrl || "");
  const prefix =
    "https://fmlrtcofnbqdotpvuaem.supabase.co/storage/v1/object/public/support-avatars/";

  return value.startsWith(prefix) ? value : "";
}

function renderAvatarInto(element, avatarUrl, name) {
  if (!element) return;
  element.replaceChildren();

  const safeAvatarUrl = safeStaffAvatarUrl(avatarUrl);

  if (safeAvatarUrl) {
    const image = document.createElement("img");
    image.src = safeAvatarUrl;
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
    let avatarUrl = state.agent.avatar_url || null;
    let avatarChanged = false;

    if (state.removeAvatar) {
      await apiRequest("/avatar", { method: "DELETE" });
      avatarUrl = null;
      avatarChanged = true;
    }

    if (state.pendingAvatarFile) {
      const form = new FormData();
      form.append("file", state.pendingAvatarFile);

      const uploaded = await apiRequest("/avatar", {
        method: "POST",
        formData: form
      });

      avatarUrl = uploaded.avatarUrl || null;
      avatarChanged = true;
    }

    const payload = {
      displayName
    };

    if (avatarChanged) payload.avatarUrl = avatarUrl;

    const result = await apiRequest("/profile", {
      method: "POST",
      body: payload
    });

    state.agent = result.agent;
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

function renderLogin(message = "") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="staff-sign-in-title">
        <div class="auth-brand">
          <span class="brand-mark" aria-hidden="true">W</span>
          <div class="auth-brand-copy">
            <strong>Well College Global</strong>
            <span>Dashboard</span>
          </div>
        </div>
        <h1 id="staff-sign-in-title">Staff sign in</h1>
        <p>Access website analytics, live conversations and visitor activity.</p>
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
          <button id="login-submit" class="auth-submit" type="submit">Sign in</button>
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
    const result = await apiRequest("/login", {
      method: "POST",
      body: { email, password }
    });

    state.user = result.user;
    state.agent = result.agent;
    renderDashboard();
    await initialiseDashboard();
  } catch (error) {
    if (errorBox && document.body.contains(errorBox)) {
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

function dashboardIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z"></path></svg>`;
}

function notificationsIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>`;
}

function totalUnreadMessages() {
  let total = 0;
  for (const count of state.unreadCounts.values()) total += Number(count || 0);
  return total;
}

function renderMessageBadge() {
  const badge = document.querySelector("#messages-nav-badge");
  if (!badge) return;

  const count = totalUnreadMessages();
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count < 1;
}

function updatePrimaryNavigation() {
  document.querySelectorAll("[data-dashboard-view]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.dashboardView === state.currentView
    );
  });
  renderMessageBadge();
}

function setDashboardView(view) {
  state.currentView = view === "messages" ? "messages" : "dashboard";
  updatePrimaryNavigation();

  if (state.currentView === "dashboard") {
    document.querySelector("#dashboard")?.classList.remove("has-selection");
    renderAnalyticsDashboard();
    if (!state.analytics && !state.analyticsLoading) loadAnalytics();
    return;
  }

  if (state.selectedId) {
    document.querySelector("#dashboard")?.classList.add("has-selection");
    renderChatShell();
    renderMessages();
  } else {
    document.querySelector("#dashboard")?.classList.remove("has-selection");
    renderDashboardChatEmpty();
  }
}

function notificationStatusLabel() {
  if (!("Notification" in window)) return "Desktop alerts unavailable";
  if (Notification.permission === "granted") return "Desktop alerts on";
  if (Notification.permission === "denied") return "Desktop alerts blocked";
  return "Enable desktop alerts";
}

function renderNotificationControl() {
  const button = document.querySelector("#notification-permission-button");
  if (!button) return;

  button.querySelector("span").textContent = notificationStatusLabel();
  button.disabled = !("Notification" in window) || Notification.permission === "denied";
  button.classList.toggle(
    "is-enabled",
    "Notification" in window && Notification.permission === "granted"
  );
}

async function requestDesktopNotifications() {
  if (!("Notification" in window)) {
    showToast("Desktop notifications are not available in this browser.", "error");
    return;
  }

  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }

  renderNotificationControl();

  if (Notification.permission === "granted") {
    showToast("Desktop chat notifications enabled.");
  } else if (Notification.permission === "denied") {
    showToast("Desktop notifications are blocked in browser settings.", "error");
  }
}

function showDesktopChatNotification(title, body, conversationId) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const notification = new Notification(title, {
    body: String(body || "New website message").slice(0, 180),
    tag: `well-support-${conversationId}`,
    renotify: true,
    icon: "/favicon.ico"
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
    if (conversationId) selectConversation(conversationId);
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function analyticsRow(container, primary, secondary, value) {
  const row = document.createElement("div");
  row.className = "analytics-list-row";

  const copy = document.createElement("div");
  copy.className = "analytics-list-copy";

  const strong = document.createElement("strong");
  strong.textContent = primary || "Unknown";
  copy.appendChild(strong);

  if (secondary) {
    const small = document.createElement("span");
    small.textContent = secondary;
    copy.appendChild(small);
  }

  const metric = document.createElement("b");
  metric.textContent = String(value ?? "0");

  row.append(copy, metric);
  container.appendChild(row);
}

function renderAnalyticsList(id, rows, mapper) {
  const container = document.querySelector(id);
  if (!container) return;
  container.replaceChildren();

  if (!rows?.length) {
    const empty = document.createElement("div");
    empty.className = "analytics-empty";
    empty.textContent = "No data yet.";
    container.appendChild(empty);
    return;
  }

  rows.forEach((row) => {
    const item = mapper(row);
    analyticsRow(container, item.primary, item.secondary, item.value);
  });
}

function renderTrafficBars(rows) {
  const container = document.querySelector("#analytics-traffic-bars");
  if (!container) return;
  container.replaceChildren();

  if (!rows?.length) {
    const empty = document.createElement("div");
    empty.className = "analytics-empty";
    empty.textContent = "Traffic will appear here once visits are recorded.";
    container.appendChild(empty);
    return;
  }

  const max = Math.max(...rows.map((row) => Number(row.views || 0)), 1);

  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "traffic-bar-item";

    const bar = document.createElement("div");
    bar.className = "traffic-bar-track";

    const fill = document.createElement("span");
    fill.style.height = `${Math.max(6, Math.round((Number(row.views || 0) / max) * 100))}%`;
    bar.appendChild(fill);

    const label = document.createElement("small");
    const date = new Date(`${row.date}T00:00:00`);
    label.textContent = Number.isNaN(date.getTime())
      ? row.date
      : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);

    const value = document.createElement("b");
    value.textContent = formatNumber(row.views);

    item.append(value, bar, label);
    container.appendChild(item);
  });
}

function renderAnalyticsDashboard() {
  const panel = document.querySelector("#chat-panel");
  if (!panel) return;

  panel.className = "chat-panel analytics-panel";
  panel.innerHTML = `
    <div class="analytics-view">
      <header class="analytics-header">
        <div>
          <div class="eyebrow"><i aria-hidden="true"></i> Website analytics</div>
          <h1>Dashboard</h1>
          <p>First-party, cookieless traffic and engagement from Well College Global.</p>
        </div>
        <div class="analytics-range" role="group" aria-label="Analytics date range">
          <button type="button" data-analytics-days="7">7d</button>
          <button type="button" data-analytics-days="30">30d</button>
          <button type="button" data-analytics-days="90">90d</button>
        </div>
      </header>

      <div id="analytics-loading" class="analytics-loading" hidden>Refreshing analytics…</div>

      <section class="analytics-metrics" aria-label="Website metrics">
        <article><span>Visitors</span><strong id="metric-visitors">0</strong><small>unique tab sessions</small></article>
        <article><span>Page views</span><strong id="metric-pageviews">0</strong><small>public page loads</small></article>
        <article><span>Clicks</span><strong id="metric-clicks">0</strong><small>links and controls</small></article>
        <article><span>Avg. visit</span><strong id="metric-duration">0s</strong><small>until page exit</small></article>
      </section>

      <section class="analytics-grid">
        <article class="analytics-card is-wide">
          <div class="analytics-card-head">
            <div><span>Traffic</span><h2>Page views over time</h2></div>
          </div>
          <div id="analytics-traffic-bars" class="traffic-bars"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Content</span><h2>Top pages</h2></div></div>
          <div id="analytics-top-pages" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Engagement</span><h2>Top clicks</h2></div></div>
          <div id="analytics-top-clicks" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Journey</span><h2>Where visitors leave</h2></div></div>
          <div id="analytics-exit-pages" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Audience</span><h2>Top locations</h2></div></div>
          <div id="analytics-locations" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Acquisition</span><h2>Referrers</h2></div></div>
          <div id="analytics-referrers" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Devices</span><h2>Visitor devices</h2></div></div>
          <div id="analytics-devices" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Campaigns</span><h2>UTM traffic</h2></div></div>
          <div id="analytics-campaigns" class="analytics-list"></div>
        </article>

        <article class="analytics-card is-wide privacy-card">
          <div class="analytics-card-head"><div><span>Privacy</span><h2>Tracking & storage inventory</h2></div></div>
          <div class="privacy-grid">
            <div><strong>Analytics cookies</strong><span>None</span></div>
            <div><strong>Analytics session</strong><span>Random sessionStorage ID, cleared with the browser tab</span></div>
            <div><strong>Raw IP stored</strong><span>No</span></div>
            <div><strong>Approx. location</strong><span>City, region and country from Cloudflare</span></div>
            <div><strong>Privacy signals</strong><span>Global Privacy Control and Do Not Track are respected</span></div>
            <div><strong>Retention</strong><span>Analytics events are deleted after 90 days</span></div>
            <div><strong>Support chat</strong><span>Tab-scoped sessionStorage until the tab closes or staff closes the chat</span></div>
            <div><strong>Staff dashboard</strong><span>Secure HttpOnly SameSite=Strict authentication cookies</span></div>
          </div>
        </article>
      </section>
    </div>
  `;

  document.querySelectorAll("[data-analytics-days]").forEach((button) => {
    const days = Number(button.dataset.analyticsDays);
    button.classList.toggle("is-active", days === state.analyticsDays);
    button.addEventListener("click", () => {
      if (days === state.analyticsDays) return;
      state.analyticsDays = days;
      document.querySelectorAll("[data-analytics-days]").forEach((item) => {
        item.classList.toggle("is-active", Number(item.dataset.analyticsDays) === days);
      });
      loadAnalytics();
    });
  });

  paintAnalytics();
}

function paintAnalytics() {
  if (state.currentView !== "dashboard") return;

  const loading = document.querySelector("#analytics-loading");
  if (loading) loading.hidden = !state.analyticsLoading;

  const summary = state.analytics;
  if (!summary) return;

  const metrics = summary.metrics || {};
  const metricValues = {
    "#metric-visitors": formatNumber(metrics.visitors),
    "#metric-pageviews": formatNumber(metrics.pageViews),
    "#metric-clicks": formatNumber(metrics.clicks),
    "#metric-duration": formatDuration(metrics.avgDurationMs)
  };

  Object.entries(metricValues).forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  });

  renderTrafficBars(summary.daily || []);
  renderAnalyticsList("#analytics-top-pages", summary.topPages, (row) => ({
    primary: row.path,
    secondary: "Page views",
    value: formatNumber(row.views)
  }));
  renderAnalyticsList("#analytics-top-clicks", summary.topClicks, (row) => ({
    primary: row.label,
    secondary: row.href || row.kind || "",
    value: formatNumber(row.clicks)
  }));
  renderAnalyticsList("#analytics-exit-pages", summary.exitPages, (row) => ({
    primary: row.path,
    secondary: `Avg. ${formatDuration(row.avgDurationMs)}`,
    value: formatNumber(row.exits)
  }));
  renderAnalyticsList("#analytics-locations", summary.locations, (row) => ({
    primary: [row.city, row.region].filter(Boolean).join(", "),
    secondary: row.country,
    value: formatNumber(row.visitors)
  }));
  renderAnalyticsList("#analytics-referrers", summary.referrers, (row) => ({
    primary: row.host,
    secondary: "Referring visitors",
    value: formatNumber(row.visitors)
  }));
  renderAnalyticsList("#analytics-devices", summary.devices, (row) => ({
    primary: String(row.device || "unknown").replace(/^./, (letter) => letter.toUpperCase()),
    secondary: "Visitors",
    value: formatNumber(row.visitors)
  }));
  renderAnalyticsList("#analytics-campaigns", summary.campaigns, (row) => ({
    primary: row.campaign || row.source || "Campaign",
    secondary: [row.source, row.medium].filter(Boolean).join(" · "),
    value: formatNumber(row.visitors)
  }));
}

async function loadAnalytics({ silent = false } = {}) {
  if (state.analyticsLoading) return;
  state.analyticsLoading = true;
  if (!silent) paintAnalytics();

  try {
    const result = await apiRequest(`/analytics?days=${state.analyticsDays}`);
    state.analytics = result.summary || null;
  } catch (error) {
    if (error.status !== 401 && error.status !== 403 && !silent) {
      showToast(error?.message || "Unable to load website analytics.", "error");
    }
  } finally {
    state.analyticsLoading = false;
    paintAnalytics();
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
                <input id="account-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" hidden />
                <button id="remove-avatar-button" class="account-remove-photo" type="button">Remove photo</button>
                <small>JPG, PNG or WebP · max 5 MB</small>
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
            <strong>Well College Global</strong>
            <span>Dashboard</span>
          </div>
        </div>

        <nav class="nav-group" aria-label="Dashboard navigation">
          <button class="nav-button is-active" type="button" data-dashboard-view="dashboard">
            ${dashboardIcon()}
            <span>Dashboard</span>
          </button>
          <button class="nav-button" type="button" data-dashboard-view="messages">
            ${inboxIcon()}
            <span>Messages</span>
            <b id="messages-nav-badge" class="nav-badge" hidden>0</b>
          </button>
        </nav>

        <button id="notification-permission-button" class="sidebar-notification-button" type="button">
          ${notificationsIcon()}
          <span>Enable desktop alerts</span>
        </button>

        <div class="sidebar-live">
          <i id="sidebar-live-dot" class="live-dot is-connecting" aria-hidden="true"></i>
          <span id="sidebar-live-copy">Connecting</span>
        </div>

        <div class="sidebar-spacer"></div>
      </aside>

      <section class="inbox-panel" aria-label="Support conversations">
        <header class="inbox-header">
          <div class="eyebrow"><i aria-hidden="true"></i> Website conversations</div>
          <div class="inbox-title-row">
            <h1>Messages</h1>
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
  await Promise.all([loadInbox(), loadAnalytics()]);
  subscribeRealtime();
}

async function loadInbox({ silent = false } = {}) {
  if (state.pollBusy) return;
  state.pollBusy = true;

  if (!silent) {
    state.loadingInbox = true;
    renderConversationList();
  }

  try {
    const result = await apiRequest("/inbox");
    const previousIds = new Set(state.conversations.map((item) => item.id));
    const incomingMessages = result.messages || [];
    const newVisitorMessages = state.notificationsReady
      ? incomingMessages.filter(
          (message) =>
            message.sender_type === "visitor" &&
            !state.knownVisitorMessageIds.has(message.id)
        )
      : [];

    state.conversations = result.conversations || [];
    state.lastMessages = new Map();

    for (const message of incomingMessages) {
      if (!state.lastMessages.has(message.conversation_id)) {
        state.lastMessages.set(message.conversation_id, message);
      }

      if (message.sender_type === "visitor") {
        state.knownVisitorMessageIds.add(message.id);
      }
    }

    if (!state.notificationsReady) {
      state.notificationsReady = true;
    } else if (silent && newVisitorMessages.length) {
      const grouped = new Map();

      for (const message of newVisitorMessages) {
        const id = message.conversation_id;
        if (
          state.currentView === "messages" &&
          state.selectedId === id &&
          document.visibilityState === "visible"
        ) {
          continue;
        }

        state.unread.add(id);
        state.unreadCounts.set(id, (state.unreadCounts.get(id) || 0) + 1);

        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id).push(message);
      }

      for (const [conversationId, messages] of grouped) {
        const newest = messages[0];
        const isNewChat = !previousIds.has(conversationId);
        showDesktopChatNotification(
          isNewChat ? "New website chat" : "New support message",
          newest?.body || "A visitor sent a message.",
          conversationId
        );
      }
    }

    renderMessageBadge();

    if (state.selectedId && !state.conversations.some((item) => item.id === state.selectedId)) {
      state.selectedId = null;
      state.messages = [];
      document.querySelector("#dashboard")?.classList.remove("has-selection");
      if (state.currentView === "messages") {
        renderDashboardChatEmpty();
      } else {
        renderAnalyticsDashboard();
      }
    }

    state.realtimeStatus = "live";
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) {
      state.realtimeStatus = "error";
      if (!silent) showToast(error?.message || "Unable to load support inbox.", "error");
    }
  } finally {
    state.pollBusy = false;
    state.loadingInbox = false;
    renderConversationList();
    renderRealtimeStatus();
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

  const result = await apiRequest("/join", {
    method: "POST",
    body: { conversationId: id }
  });

  if (result.conversation) upsertConversation(result.conversation);
  if (result.message) appendMessage(result.message);
}

async function selectConversation(id) {
  state.selectedId = id;
  state.unread.delete(id);
  state.unreadCounts.delete(id);
  state.currentView = "messages";
  updatePrimaryNavigation();
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

  panel.className = "chat-panel";
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
      <div class="visitor-map-center-pin" aria-hidden="true">
        <span class="visitor-map-center-dot"></span>
      </div>
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

async function loadMessages(conversationId, { silent = false } = {}) {
  if (!conversationId || state.messagePollBusy) return;
  state.messagePollBusy = true;

  if (!silent) {
    state.loadingMessages = true;
    renderMessages();
  }

  try {
    const result = await apiRequest(
      `/messages?conversationId=${encodeURIComponent(conversationId)}`
    );

    if (state.selectedId === conversationId) {
      state.messages = result.messages || [];

      const last = state.messages[state.messages.length - 1];
      if (last) state.lastMessages.set(conversationId, last);
    }
  } catch (error) {
    if (error.status !== 401 && error.status !== 403 && !silent) {
      showToast(error?.message || "Unable to load messages.", "error");
    }
  } finally {
    state.messagePollBusy = false;
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
      row.append(bubble, avatar);
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

  try {
    const result = await apiRequest("/send", {
      method: "POST",
      body: {
        conversationId: conversation.id,
        body
      }
    });

    if (result.message) appendMessage(result.message);

    if (input) {
      input.value = "";
      input.style.height = "auto";
    }
  } catch (error) {
    showToast(error?.message || "Unable to send reply.", "error");
  } finally {
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
    await apiRequest("/close", {
      method: "POST",
      body: { conversationId: conversation.id }
    });

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

  const pollInbox = async () => {
    if (!state.user) return;
    await loadInbox({ silent: true });

    if (state.selectedId) {
      await loadMessages(state.selectedId, { silent: true });
    }

    state.pollTimer = window.setTimeout(pollInbox, 1400);
  };

  state.pollTimer = window.setTimeout(pollInbox, 700);
  state.analyticsTimer = window.setInterval(() => {
    if (state.user && state.currentView === "dashboard") {
      loadAnalytics({ silent: true });
    }
  }, 30000);
}

function renderDashboardChatEmpty() {
  const panel = document.querySelector("#chat-panel");
  if (!panel) return;
  panel.className = "chat-panel";
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
    copy.textContent = "Secure live";
  } else if (state.realtimeStatus === "error") {
    dot.classList.add("is-error");
    copy.textContent = "Reconnect needed";
  } else {
    dot.classList.add("is-connecting");
    copy.textContent = "Connecting";
  }
}

function cleanupRealtime() {
  if (state.pollTimer) window.clearTimeout(state.pollTimer);
  if (state.messagePollTimer) window.clearTimeout(state.messagePollTimer);
  if (state.analyticsTimer) window.clearInterval(state.analyticsTimer);
  state.pollTimer = null;
  state.messagePollTimer = null;
  state.analyticsTimer = null;
  state.pollBusy = false;
  state.messagePollBusy = false;
}

async function signOut() {
  try {
    cleanupRealtime();
    await apiRequest("/logout", { method: "POST" });
  } catch {
    // Server also expires the session cookie on normal logout; render locally regardless.
  }

  state.agent = null;
  state.user = null;
  state.conversations = [];
  state.messages = [];
  state.selectedId = null;
  state.lastMessages = new Map();
  state.unread = new Set();
  state.unreadCounts = new Map();
  state.knownVisitorMessageIds = new Set();
  state.notificationsReady = false;
  state.analytics = null;
  state.currentView = "dashboard";
  renderLogin();
}

async function bootstrap() {
  try {
    const result = await apiRequest("/session");
    state.user = result.user;
    state.agent = result.agent;
    renderDashboard();
    await initialiseDashboard();
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) {
      renderLogin("Unable to initialise Well Support.");
    } else if (!document.querySelector(".auth-shell")) {
      renderLogin();
    }
  }
}

bootstrap();
