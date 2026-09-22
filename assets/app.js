const MAX_MESSAGE_LENGTH = 4000;
const DASHBOARD_VIEW_PATHS = {
  dashboard: "/dashboard",
  visitors: "/visitors",
  messages: "/messages",
  editor: "/web-editor"
};

function dashboardViewFromPath(pathname = window.location.pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/visitors") return "visitors";
  if (path === "/messages") return "messages";
  if (path === "/web-editor") return "editor";
  return "dashboard";
}

function dashboardPathForView(view) {
  return DASHBOARD_VIEW_PATHS[view] || DASHBOARD_VIEW_PATHS.dashboard;
}

const app = document.querySelector("#app");
const state = {
  agent: null,
  user: null,
  conversations: [],
  lastMessages: new Map(),
  messages: [],
  selectedId: null,
  unread: new Set(),
  messageSection: "current",
  agents: new Map(),
  readAt: new Map(),
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
  pollFailures: 0,
  currentView: dashboardViewFromPath(),
  analytics: null,
  analyticsDays: 30,
  analyticsLoading: false,
  analyticsTimer: null,
  visitors: [],
  visitorsLoading: false,
  visitorsTimer: null,
  visitorsGeneratedAt: "",
  unreadCounts: new Map(),
  knownVisitorMessageIds: new Set(),
  visitorNames: new Map(),
  visitorNameOverrides: loadVisitorNameOverrides(),
  notificationsReady: false,
  editorStatus: null,
  editorMode: "beta",
  editorPage: "/",
  editorDirty: false,
  editorLoading: false,
  editorDraftKey: "",
  editorTextDrafts: {},
  editorAttributeDrafts: {},
  editorAccentDraft: "",
  editorFontDraft: "",
  editorHeadingDraft: "",
  editorCopyDraft: "",
  editorColours: [],
  editorSelectedText: null,
  editorSelectedObject: null,
  editorPickedColour: "",
  editorDevice: "desktop",
  editorMessageHandler: null,
  editorPendingPages: {},
  editorHistory: [],
  editorFuture: [],
  editorBannerTarget: "production",
  editorBannerItems: [],
  editorBannerInterval: 5200,
  editorBannerDirty: false,
  editorBannerKey: "",
  editorBannerOpenId: "",
  editorBannerPendingDeleteIndex: null,
  supportPagePickerSection: ""
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

const VISITOR_NAME_PREFIX = "[[WCG_VISITOR_NAME_V1:";
const SUPPORT_PAGE_LINK_PREFIX = "[[WCG_PAGE_LINK_V1:";
const VISITOR_NAME_OVERRIDE_KEY = "well-support:visitor-name-overrides";

const SUPPORT_PAGE_CATALOG = {
  qualifications: {
    label: "Qualifications",
    description: "Professional qualification pages",
    items: [
      ["Diploma in Nutrition & Health Coaching", "/diploma-in-nutrition-and-health-coaching.html"],
      ["Women’s Health & Wellness Coach Certification", "/womens-health-and-wellness-coach-certification.html"],
      ["ICF Course", "/icf-certified-coaching-professional-program.html"],
      ["Diploma in Coaching for Lifestyle & Wellbeing", "/diploma-lifestyle-coaching.html"],
      ["Bio Optimise Holistic Wellness Practitioner", "/holisticwellnesspractitioner.html"],
      ["Ultimate Triple Qualification", "/the-ultimate-triple-qualification.html"],
      ["Wellness Coaching for Professionals", "/wellness-coaching-for-professionals.html"],
      ["Professional Certificate in Meal Planning", "/professional-certificate-in-meal-planning.html"],
      ["Coach Gap Training", "/coach-gap-training.html"],
      ["ELCAS Approved Courses", "/elcas-approved-provider.html"],
      ["Accreditation, Registration & Insurance", "/accreditation-registration--insurance-options.html"],
      ["Study Pathways", "/study-pathways.html"],
      ["Vedic Wellness Studies", "/vedicwellnessstudies.html"]
    ]
  },
  shortCourses: {
    label: "Short courses",
    description: "Focused study and free learning",
    items: [
      ["Human Nutrition", "/human-nutrition.html", "Nutrition & health"],
      ["Biomarker & Functional Tests", "/biomarkers.html", "Nutrition & health"],
      ["Ayurvedic Lifestyle", "/ayurvedic-lifestyle.html", "Nutrition & health"],
      ["Sports Nutrition for Optimal Performance", "/sports-nutrition-for-optimal-performance.html", "Nutrition & health"],
      ["Nutrition for Conception, Pregnancy & Lactation", "/pregnancynutrition.html", "Nutrition & health"],
      ["Early Childhood Nutrition", "/early-childhood-nutrition.html", "Nutrition & health"],
      ["Gut & Microbiome", "/gut--microbiome-online-course.html", "Nutrition & health"],
      ["Botanical Healing", "/botanical-healing.html", "Nutrition & health"],
      ["Meal Planning for Healthy Living", "/meal-planning-for-healthy-living.html", "Nutrition & health"],
      ["Non-Diet Approach", "/non-diet-approach.html", "Nutrition & health"],
      ["Nutrition Psychology", "/nutrition-psychology.html", "Nutrition & health"],
      ["Super Nutrition", "/super-nutrition.html", "Nutrition & health"],
      ["Women’s Health & Hormones", "/womens-health-and-hormones.html", "Nutrition & health"],
      ["Weight Management Nutrition", "/weight-management-nutrition.html", "Nutrition & health"],
      ["Integrative Wellness Techniques", "/integrative-wellness-techniques.html", "Holistic health"],
      ["Coaching Clients Holistically", "/coaching-clients-holistically.html", "Holistic health"],
      ["Introduction to Holistic Wellness", "/holistic_wellness_intro.html", "Holistic health"],
      ["Mental Health & Trauma Awareness", "/mental-health--trauma-awareness.html", "Psychology & coaching"],
      ["Wellbeing Management & Coaching Practices", "/wellbeing-management-and-coaching-practices.html", "Psychology & coaching"],
      ["Cultivating Confidence", "/cultivating-confidence.html", "Psychology & coaching"],
      ["Psychology & Wellbeing Foundations", "/psychology-and-wellbeing-foundations.html", "Psychology & coaching"],
      ["Coach Supervision & Mentoring", "/coaching-supervision-and-mentoring.html", "Psychology & coaching"],
      ["Coaching Practicum", "/coaching-practicum.html", "Business & practice"],
      ["Motivational Techniques", "/motivational-techniques.html", "Business & practice"],
      ["Creating Healthy Lifestyle Courses & Programs", "/creating-healthy-lifestyle-courses-and-programs.html", "Business & practice"],
      ["Grow Your Coaching Business", "/grow-your-coaching-business.html", "Business & practice"],
      ["Professional Practice & Business Ready Workshops", "/professional-practice-and-business-ready-workshops.html", "Business & practice"],
      ["Continuing Education Courses", "/continuing-ed-courses.html", "More learning"],
      ["Free Courses & Samplers", "/free-courses.html", "Free learning"],
      ["Pathways to Health Coaching", "/pathways-to-health-coaching.html", "Free learning"],
      ["Free Coaching Webinar Series", "/free-coaching-webinar-series.html", "Free learning"]
    ]
  },
  more: {
    label: "More",
    description: "Helpful website pages",
    items: [
      ["Home", "/"],
      ["About us", "/about.html"],
      ["Testimonials", "/testimonials.html"],
      ["Contact", "/contact.html"],
      ["FAQs", "/faqs.html"],
      ["Book a Free Clarity Session", "/session-bookings.html"],
      ["Enrol & Pay", "/enrol.html"],
      ["Well Collective Blog", "/well-collective-blog.html"],
      ["Find a Health Coach", "/find-a-coach.html"],
      ["Qualifications", "/qualifications.html"],
      ["Short Courses", "/short-courses.html"]
    ]
  }
};

function encodeSupportPageLink(label, path) {
  const cleanLabel = String(label || "").trim().slice(0, 140);
  const cleanPath = String(path || "").trim().slice(0, 500);
  return `${SUPPORT_PAGE_LINK_PREFIX}${encodeURIComponent(cleanLabel)}:${encodeURIComponent(cleanPath)}]]`;
}

function decodeSupportPageLink(body) {
  const value = String(body || "").trim();
  if (!value.startsWith(SUPPORT_PAGE_LINK_PREFIX) || !value.endsWith("]]")) {
    return null;
  }

  const payload = value.slice(SUPPORT_PAGE_LINK_PREFIX.length, -2);
  const separator = payload.indexOf(":");
  if (separator <= 0) return null;

  try {
    const label = decodeURIComponent(payload.slice(0, separator)).trim().slice(0, 140);
    const path = decodeURIComponent(payload.slice(separator + 1)).trim().slice(0, 500);
    if (!label || !/^\/[a-z0-9._~!const VISITOR_NAME_PREFIX = "[[WCG_VISITOR_NAME_V1:";
const VISITOR_NAME_OVERRIDE_KEY = "well-support:visitor-name-overrides";
'()*+,;=:@%/?#-]*$/i.test(path)) return null;
    return { label, path };
  } catch {
    return null;
  }
}


function cleanVisitorDisplayName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function loadVisitorNameOverrides() {
  if (typeof window === "undefined") return new Map();

  try {
    const raw = JSON.parse(
      window.sessionStorage.getItem(VISITOR_NAME_OVERRIDE_KEY) || "{}"
    );
    return new Map(
      Object.entries(raw || {}).filter(
        ([conversationId, name]) =>
          /^[0-9a-f-]{36}$/i.test(conversationId) &&
          Boolean(cleanVisitorDisplayName(name))
      )
    );
  } catch {
    return new Map();
  }
}

function saveVisitorNameOverrides() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      VISITOR_NAME_OVERRIDE_KEY,
      JSON.stringify(Object.fromEntries(state.visitorNameOverrides))
    );
  } catch {
    // Client-side name edits may remain in memory when storage is unavailable.
  }
}

function setVisitorNameOverride(conversationId, value) {
  const name = cleanVisitorDisplayName(value);
  if (!conversationId) return;

  if (name) state.visitorNameOverrides.set(conversationId, name);
  else state.visitorNameOverrides.delete(conversationId);

  saveVisitorNameOverrides();
}

function clearVisitorNameOverride(conversationId) {
  if (!conversationId) return;
  state.visitorNameOverrides.delete(conversationId);
  saveVisitorNameOverrides();
}

function visitorSourceUrl(conversation) {
  const raw = String(conversation?.page_path || "").trim();
  if (!raw) return "https://www.wellcollegeglobal.com/";

  try {
    if (/^https:\/\//i.test(raw)) {
      const url = new URL(raw);
      return url.hostname === "www.wellcollegeglobal.com"
        ? url.toString()
        : "https://www.wellcollegeglobal.com/";
    }

    return new URL(
      raw.startsWith("/") ? raw : `/${raw}`,
      "https://www.wellcollegeglobal.com"
    ).toString();
  } catch {
    return "https://www.wellcollegeglobal.com/";
  }
}

function simplifiedVisitorPage(conversation) {
  const raw = String(conversation?.page_path || "/").trim();

  try {
    const parsed = /^https:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(
          raw.startsWith("/") ? raw : `/${raw}`,
          "https://www.wellcollegeglobal.com"
        );

    let path = parsed.pathname || "/";
    path = path.replace(/\/index\.html$/i, "/");
    path = path.replace(/\.html$/i, "");
    path = path.replace(/\/+$/, "") || "/";

    return path === "/" ? "/home" : path;
  } catch {
    return "/home";
  }
}


function decodeVisitorMessage(message) {
  const body = String(message?.body || "");
  const fallbackName = String(message?.sender_display_name || "").trim();

  if (
    message?.sender_type !== "visitor" ||
    !body.startsWith(VISITOR_NAME_PREFIX)
  ) {
    return { body, name: fallbackName };
  }

  const end = body.indexOf("]]");
  if (end < VISITOR_NAME_PREFIX.length) {
    return { body, name: fallbackName };
  }

  let encodedName = "";
  try {
    encodedName = decodeURIComponent(
      body.slice(VISITOR_NAME_PREFIX.length, end)
    );
  } catch {
    encodedName = "";
  }

  const name = String(fallbackName || encodedName)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return {
    name,
    body: body.slice(end + 2).replace(/^\n/, "")
  };
}

function visitorName(conversation) {
  const conversationId = conversation?.id;
  if (!conversationId) return "Website visitor";

  const override = cleanVisitorDisplayName(
    state.visitorNameOverrides.get(conversationId)
  );
  if (override) return override;

  const knownName = cleanVisitorDisplayName(
    state.visitorNames.get(conversationId)
  );
  if (knownName) return knownName;

  const namedMessage = [...state.messages]
    .reverse()
    .find((message) => {
      if (
        message?.conversation_id !== conversationId ||
        message?.sender_type !== "visitor"
      ) {
        return false;
      }

      return Boolean(decodeVisitorMessage(message).name);
    });

  return namedMessage
    ? decodeVisitorMessage(namedMessage).name
    : "Website visitor";
}

function visibleMessageBody(message) {
  const body = decodeVisitorMessage(message).body;
  const pageLink = decodeSupportPageLink(body);
  return pageLink ? `Shared page: ${pageLink.label}` : body;
}

function refreshCurrentVisitorIdentity() {
  const conversation = currentConversation();
  if (!conversation) return;

  const name = visitorName(conversation);
  const nameElement = document.querySelector("#chat-visitor-name");
  const avatar = document.querySelector("#chat-visitor-avatar");

  if (nameElement && !nameElement.hasAttribute("contenteditable")) {
    nameElement.textContent = name;
  }
  if (avatar) avatar.textContent = initials(name);
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

function visitorsIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
}

function editorIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V4.5A1.5 1.5 0 0 1 5.5 3h8.8L20 8.7v10.8A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5Z"></path><path d="M14 3v6h6"></path><path d="m8 16 5.8-5.8 2 2L10 18H8v-2Z"></path></svg>`;
}

function notificationsIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>`;
}

function totalUnreadMessages() {
  let total = 0;

  for (const [conversationId, count] of state.unreadCounts.entries()) {
    const conversation = state.conversations.find(
      (item) => item.id === conversationId
    );

    if (
      conversation &&
      (
        !conversation.joined_agent_id ||
        conversation.joined_agent_id === state.user?.id
      )
    ) {
      total += Number(count || 0);
    }
  }

  return total;
}

function renderMessageBadge() {
  const badge = document.querySelector("#messages-nav-badge");
  if (!badge) return;

  const waitingCount = state.conversations.filter(
    (conversation) =>
      conversation.status === "open" && !conversation.joined_agent_id
  ).length;

  const count = totalUnreadMessages();
  const displayCount = Math.max(count, waitingCount);

  badge.textContent = displayCount > 99 ? "99+" : String(displayCount);
  badge.hidden = displayCount < 1;
  badge.classList.toggle("has-waiting", waitingCount > 0);
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

function setDashboardView(view, { historyMode = "push" } = {}) {
  const resolvedView = ["dashboard", "visitors", "messages", "editor"].includes(view)
    ? view
    : "dashboard";

  state.currentView = resolvedView;

  const nextPath = dashboardPathForView(resolvedView);
  if (window.location.pathname !== nextPath) {
    if (historyMode === "replace") {
      window.history.replaceState({ dashboardView: resolvedView }, "", nextPath);
    } else if (historyMode !== "none") {
      window.history.pushState({ dashboardView: resolvedView }, "", nextPath);
    }
  }

  updatePrimaryNavigation();

  const dashboard = document.querySelector("#dashboard");
  dashboard?.classList.toggle("is-dashboard", state.currentView === "dashboard");
  dashboard?.classList.toggle("is-visitors", state.currentView === "visitors");
  dashboard?.classList.toggle("is-messages", state.currentView === "messages");
  dashboard?.classList.toggle("is-editor", state.currentView === "editor");

  if (state.currentView !== "visitors" && state.visitorsTimer) {
    window.clearInterval(state.visitorsTimer);
    state.visitorsTimer = null;
  }

  if (state.currentView === "dashboard") {
    dashboard?.classList.remove("has-selection");
    renderAnalyticsDashboard();
    if (!state.analytics && !state.analyticsLoading) loadAnalytics();
    return;
  }

  if (state.currentView === "visitors") {
    dashboard?.classList.remove("has-selection");
    renderVisitorsPage();
    loadVisitors({ silent: state.visitors.length > 0 });
    if (!state.visitorsTimer) {
      state.visitorsTimer = window.setInterval(() => {
        if (state.currentView === "visitors") loadVisitors({ silent: true });
      }, 10000);
    }
    return;
  }

  if (state.currentView === "editor") {
    dashboard?.classList.remove("has-selection");
    renderWebEditor();
    return;
  }

  renderConversationList();

  if (state.selectedId) {
    dashboard?.classList.add("has-selection");
    renderChatShell();
    renderMessages();
  } else {
    dashboard?.classList.remove("has-selection");
    renderDashboardChatEmpty();
  }
}

async function loadWebEditorStatus({ quiet = false } = {}) {
  if (state.editorLoading) return;
  state.editorLoading = true;

  try {
    const result = await apiRequest("/editor-status");
    state.editorStatus = result.status || null;
  } catch (error) {
    state.editorStatus = {
      connected: false,
      error: error?.message || "Unable to load GitHub editor status."
    };
    if (!quiet) showToast(state.editorStatus.error, "error");
  } finally {
    state.editorLoading = false;
    if (state.currentView === "editor") renderWebEditor();
  }
}

function editorPageConfig(mode, path) {
  const status = state.editorStatus;
  if (!status?.connected) return {};

  const source =
    mode === "production"
      ? status.main?.overrides
      : status.beta?.overrides;

  return source?.pages?.[path] || {};
}

function cloneEditorAttributeDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([selector, attributes]) => [
      selector,
      attributes && typeof attributes === "object" && !Array.isArray(attributes)
        ? { ...attributes }
        : {}
    ])
  );
}

function editorDraftFromConfig(config = {}) {
  return {
    heading: String(config.heading || ""),
    copy: String(config.copy || ""),
    accent: String(config.accent || ""),
    font: String(config.font || ""),
    text:
      config.text && typeof config.text === "object" && !Array.isArray(config.text)
        ? { ...config.text }
        : {},
    attributes: cloneEditorAttributeDrafts(config.attributes)
  };
}

function currentEditorDraftSnapshot() {
  return {
    heading: state.editorHeadingDraft || "",
    copy: state.editorCopyDraft || "",
    accent: state.editorAccentDraft || "",
    font: state.editorFontDraft || "",
    text: { ...state.editorTextDrafts },
    attributes: cloneEditorAttributeDrafts(state.editorAttributeDrafts)
  };
}

function applyEditorDraftSnapshot(snapshot = {}) {
  const draft = editorDraftFromConfig(snapshot);
  state.editorHeadingDraft = draft.heading;
  state.editorCopyDraft = draft.copy;
  state.editorAccentDraft = draft.accent;
  state.editorFontDraft = draft.font;
  state.editorTextDrafts = draft.text;
  state.editorAttributeDrafts = draft.attributes;
}

function storeCurrentEditorDraft() {
  if (state.editorMode !== "beta") return;

  state.editorPendingPages = {
    ...state.editorPendingPages,
    [state.editorPage]: currentEditorDraftSnapshot()
  };
  state.editorDirty = Object.keys(state.editorPendingPages).length > 0;
}

function recordEditorHistory() {
  if (state.editorMode !== "beta") return;

  const snapshot = currentEditorDraftSnapshot();
  const previous = state.editorHistory[state.editorHistory.length - 1];

  if (
    previous &&
    previous.pagePath === state.editorPage &&
    JSON.stringify(previous.draft) === JSON.stringify(snapshot)
  ) {
    return;
  }

  state.editorHistory = [
    ...state.editorHistory.slice(-79),
    { pagePath: state.editorPage, draft: snapshot }
  ];
  state.editorFuture = [];
}

function undoEditorDraft() {
  if (state.editorMode !== "beta") return false;

  let index = -1;
  for (let i = state.editorHistory.length - 1; i >= 0; i -= 1) {
    if (state.editorHistory[i]?.pagePath === state.editorPage) {
      index = i;
      break;
    }
  }
  if (index < 0) return false;

  const current = currentEditorDraftSnapshot();
  const entry = state.editorHistory[index];
  state.editorHistory = state.editorHistory.filter((_, itemIndex) => itemIndex !== index);
  state.editorFuture = [
    ...state.editorFuture.slice(-79),
    { pagePath: state.editorPage, draft: current }
  ];

  applyEditorDraftSnapshot(entry.draft);
  storeCurrentEditorDraft();
  return true;
}

function redoEditorDraft() {
  if (state.editorMode !== "beta") return false;

  let index = -1;
  for (let i = state.editorFuture.length - 1; i >= 0; i -= 1) {
    if (state.editorFuture[i]?.pagePath === state.editorPage) {
      index = i;
      break;
    }
  }
  if (index < 0) return false;

  const current = currentEditorDraftSnapshot();
  const entry = state.editorFuture[index];
  state.editorFuture = state.editorFuture.filter((_, itemIndex) => itemIndex !== index);
  state.editorHistory = [
    ...state.editorHistory.slice(-79),
    { pagePath: state.editorPage, draft: current }
  ];

  applyEditorDraftSnapshot(entry.draft);
  storeCurrentEditorDraft();
  return true;
}

function editorCanUndo() {
  return state.editorHistory.some((entry) => entry?.pagePath === state.editorPage);
}

function editorCanRedo() {
  return state.editorFuture.some((entry) => entry?.pagePath === state.editorPage);
}

function editorPendingChangeCount() {
  return Object.keys(state.editorPendingPages || {}).length;
}

const DEFAULT_EDITOR_BANNERS = [
  {
    id: "clarity-session",
    message: "Not sure where to begin?",
    cta: "Book a free clarity session",
    href: "session-bookings.html",
    background: "#304660",
    foreground: "#FFFEFA",
    startsAt: "",
    endsAt: "",
    enabled: true
  },
  {
    id: "live-events",
    message: "Join a free live Pathways to Health Coaching session",
    cta: "View upcoming events",
    href: "free-coaching-webinar-series.html",
    background: "#42514C",
    foreground: "#FFFEFA",
    startsAt: "",
    endsAt: "",
    enabled: true
  }
];

function escapeEditorAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function editorBannerSource(target = state.editorBannerTarget) {
  const source =
    target === "beta"
      ? state.editorStatus?.beta?.overrides
      : state.editorStatus?.main?.overrides;

  const banner =
    source?.banner && typeof source.banner === "object"
      ? source.banner
      : null;

  return {
    intervalMs: Number(banner?.intervalMs || 5200),
    items: Array.isArray(banner?.items)
      ? banner.items.map((item) => ({ ...item }))
      : DEFAULT_EDITOR_BANNERS.map((item) => ({ ...item }))
  };
}

function editorDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes())
  ].join("");
}

function newEditorBannerItem() {
  return {
    id: `banner-${Date.now().toString(36)}`,
    message: "New announcement",
    cta: "Learn more",
    href: "",
    background: "#304660",
    foreground: "#FFFEFA",
    startsAt: "",
    endsAt: "",
    enabled: true
  };
}

async function commitEditorBannerItems(items, {
  operation = "update",
  button = null
} = {}) {
  const target = state.editorBannerTarget === "beta" ? "beta" : "production";
  const branch = target === "beta" ? "beta-main" : "main";

  const result = await apiRequest("/editor-banner", {
    method: "POST",
    body: {
      target,
      operation,
      intervalMs: state.editorBannerInterval,
      items
    }
  });

  const statusKey = target === "beta" ? "beta" : "main";
  if (state.editorStatus?.[statusKey]) {
    state.editorStatus[statusKey].overrides = result.overrides;
    if (result.commitSha) state.editorStatus[statusKey].sha = result.commitSha;
  }

  state.editorBannerItems = items.map((item) => ({ ...item }));
  state.editorBannerDirty = false;
  state.editorBannerKey = "";

  const verb = operation === "delete" ? "deleted and committed" : "committed";
  showToast(
    `Rolling banner ${verb} to WellWebsite/${branch}${result.commitSha ? ` · ${result.commitSha.slice(0, 7)}` : ""}.${target === "production" ? " Cloudflare deployment is starting." : ""}`
  );

  await loadWebEditorStatus({ quiet: true });
  return result;
}

async function publishEditorBanner() {
  const button = document.querySelector("#editor-banner-save");
  if (button) {
    button.disabled = true;
    button.textContent = "Committing…";
  }

  try {
    await commitEditorBannerItems(state.editorBannerItems, {
      operation: "update",
      button
    });
  } catch (error) {
    showToast(error?.message || "Unable to commit the rolling banner.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = state.editorBannerTarget === "production"
        ? "Commit to production"
        : "Commit to beta-main";
    }
  }
}

async function deleteEditorBannerItem(index) {
  if (!Number.isInteger(index) || !state.editorBannerItems[index]) return;

  const item = state.editorBannerItems[index];
  const nextItems = state.editorBannerItems.filter(
    (_, itemIndex) => itemIndex !== index
  );
  const button = document.querySelector("#confirm-editor-banner-delete");

  if (button) {
    button.disabled = true;
    button.textContent = "Deleting…";
  }

  try {
    await commitEditorBannerItems(nextItems, {
      operation: "delete",
      button
    });

    if (state.editorBannerOpenId === item.id) {
      state.editorBannerOpenId = "";
    }

    state.editorBannerPendingDeleteIndex = null;
    document.body.classList.remove("has-support-confirm-modal");
    renderWebEditor();
  } catch (error) {
    showToast(error?.message || "Unable to delete the rolling banner.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Delete & commit";
    }
  }
}

function editorBranchSummary() {
  const comparison = state.editorStatus?.comparison;
  if (!state.editorStatus?.connected || !comparison) {
    return "Publishing connection unavailable";
  }

  if (comparison.behindBy > 0) {
    return "Preview needs updating from the live site";
  }

  if (comparison.aheadBy > 0) {
    return "Preview has unpublished changes";
  }

  return "Preview matches the live site";
}

async function syncWebEditorBeta() {
  const button = document.querySelector("#web-editor-sync");
  if (button) {
    button.disabled = true;
    button.textContent = "Syncing…";
  }

  try {
    const result = await apiRequest("/editor-sync", {
      method: "POST",
      body: {}
    });

    state.editorStatus = result.status || state.editorStatus;
    state.editorDirty = false;
    showToast("Preview updated from the live website.");
    renderWebEditor();
  } catch (error) {
    showToast(error?.message || "Unable to sync beta-main.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Update preview from live site";
    }
  }
}

async function publishWebEditorDraft(payload) {
  const button = document.querySelector("#web-editor-preview-submit");
  if (button) {
    button.disabled = true;
    button.textContent = "Publishing…";
  }

  try {
    const result = await apiRequest("/editor-publish", {
      method: "POST",
      body: payload
    });

    if (state.editorStatus?.beta) {
      state.editorStatus.beta.overrides = result.overrides;
      if (result.commitSha) state.editorStatus.beta.sha = result.commitSha;
    }

    state.editorDirty = false;
    showToast("Changes sent to the preview site. The updated preview will appear shortly.");
    await loadWebEditorStatus({ quiet: true });
  } catch (error) {
    showToast(error?.message || "Unable to publish these changes to the preview site.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Push changes to beta";
    }
  }
}

function openEditorPromotionConfirm() {
  const modal = document.querySelector("#editor-promote-modal");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("has-support-confirm-modal");
  requestAnimationFrame(() => {
    document.querySelector("#confirm-editor-promote")?.focus();
  });
}

function closeEditorPromotionConfirm() {
  const modal = document.querySelector("#editor-promote-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("has-support-confirm-modal");
  document.querySelector("#web-editor-promote")?.focus();
}

async function promoteWebEditorBeta() {
  const button = document.querySelector("#confirm-editor-promote");
  if (button) {
    button.disabled = true;
    button.textContent = "Promoting…";
  }

  try {
    const result = await apiRequest("/editor-promote", {
      method: "POST",
      body: { confirm: "PROMOTE_BETA_TO_MAIN" }
    });

    state.editorStatus = result.status || state.editorStatus;
    state.editorDirty = false;
    document.body.classList.remove("has-support-confirm-modal");
    showToast("Preview approved. The live website deployment is starting.");
    renderWebEditor();
  } catch (error) {
    showToast(error?.message || "Unable to promote beta-main.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Publish preview to live site";
    }
  }
}

function renderWebEditor() {
  const panel = document.querySelector("#chat-panel");
  if (!panel) return;

  const productionPreviewOrigin = "https://wellwebsite.pages.dev";
  const betaPreviewOrigin = "https://beta-main.wellwebsite.pages.dev";
  const publicOrigin = "https://www.wellcollegeglobal.com";
  const connected = state.editorStatus?.connected === true;
  const comparison = state.editorStatus?.comparison || {};
  const betaBehind = Number(comparison.behindBy || 0) > 0;
  const betaAhead = Number(comparison.aheadBy || 0) > 0;
  const editable = state.editorMode === "beta" && connected && !betaBehind;
  const activeBannerTarget = state.editorMode === "production" ? "production" : "beta";

  if (state.editorBannerTarget !== activeBannerTarget && !state.editorBannerDirty) {
    state.editorBannerTarget = activeBannerTarget;
    state.editorBannerKey = "";
    state.editorBannerOpenId = "";
  }

  const config = editorPageConfig(
    state.editorMode === "beta" ? "beta" : "production",
    state.editorPage
  );

  const sourceSha =
    state.editorMode === "beta"
      ? state.editorStatus?.beta?.sha || "beta"
      : state.editorStatus?.main?.sha || "main";
  const draftKey = `${state.editorMode}:${state.editorPage}:${sourceSha}`;
  const pendingDraft =
    state.editorMode === "beta"
      ? state.editorPendingPages?.[state.editorPage]
      : null;
  const draftSource = pendingDraft || config;

  if (state.editorDraftKey !== draftKey) {
    state.editorDraftKey = draftKey;
    const draft = editorDraftFromConfig(draftSource);
    applyEditorDraftSnapshot(draft);
    state.editorColours = [];
    state.editorSelectedText = null;
    state.editorSelectedObject = null;
    state.editorPickedColour = "";
    state.editorDirty =
      state.editorMode === "beta" && editorPendingChangeCount() > 0;
  }

  const currentAccent =
    /^#[0-9a-f]{6}$/i.test(state.editorAccentDraft)
      ? state.editorAccentDraft.toUpperCase()
      : "#304660";

  const bannerBranch =
    state.editorBannerTarget === "beta"
      ? state.editorStatus?.beta
      : state.editorStatus?.main;
  const bannerKey = `${state.editorBannerTarget}:${bannerBranch?.sha || "unloaded"}`;

  if (state.editorBannerKey !== bannerKey && !state.editorBannerDirty) {
    const bannerSource = editorBannerSource(state.editorBannerTarget);
    state.editorBannerKey = bannerKey;
    state.editorBannerItems = bannerSource.items;
    state.editorBannerInterval = bannerSource.intervalMs;
  }

  const pendingCount = editorPendingChangeCount();
  const canUndo = editable && editorCanUndo();
  const canRedo = editable && editorCanRedo();

  panel.className = "chat-panel web-editor-panel is-fullscreen";
  panel.innerHTML = `
    <div class="web-editor-fullscreen">
      <header class="editor-fullscreen-topbar">
        <div class="editor-fullscreen-topbar-left">
          <button id="web-editor-exit" class="editor-topbar-icon-button" type="button" aria-label="Exit website editor">←</button>
          <div class="editor-fullscreen-title">
            <span>Well College Global</span>
            <strong>Website Editor</strong>
          </div>

          <div class="editor-mode-switcher" role="group" aria-label="Website view">
            <button
              type="button"
              data-editor-environment="beta"
              class="${state.editorMode === "beta" ? "is-active" : ""}"
            >Edit preview</button>
            <button
              type="button"
              data-editor-environment="production"
              class="${state.editorMode === "production" ? "is-active" : ""}"
            >View live site</button>
          </div>

          <span class="editor-connection-pill ${connected ? "is-connected" : "is-disconnected"}">
            <i></i>
            ${connected ? editorBranchSummary() : "Publishing unavailable"}
          </span>
        </div>

        <div class="editor-fullscreen-topbar-right">
          <div class="editor-history-actions" role="group" aria-label="Undo and redo">
            <button
              id="web-editor-undo"
              class="editor-topbar-icon-button"
              type="button"
              aria-label="Undo last change"
              title="Undo"
              ${canUndo ? "" : "disabled"}
            >↶</button>
            <button
              id="web-editor-redo"
              class="editor-topbar-icon-button"
              type="button"
              aria-label="Redo change"
              title="Redo"
              ${canRedo ? "" : "disabled"}
            >↷</button>
          </div>

          ${connected && betaBehind ? `
            <button id="web-editor-sync" class="editor-topbar-button" type="button">Update preview</button>
          ` : ""}

          ${connected && betaAhead && !betaBehind ? `
            <button id="web-editor-promote" class="editor-topbar-button is-promote" type="button">Publish preview live</button>
          ` : ""}

          <button id="web-editor-refresh" class="editor-topbar-button" type="button">Refresh preview</button>
          <a id="web-editor-open-page" class="editor-topbar-button" target="_blank" rel="noopener noreferrer">Open page ↗</a>

          <button
            id="web-editor-preview-submit"
            class="editor-topbar-button is-primary"
            type="button"
            ${editable && state.editorDirty ? "" : "disabled"}
          >${pendingCount > 1 ? `Push ${pendingCount} pages to beta` : "Push changes to beta"}</button>
        </div>
      </header>

      <div class="editor-fullscreen-body">
        <aside class="editor-inspector">
          <div class="editor-inspector-scroll">
            <section class="editor-inspector-section is-first">
              <div class="editor-inspector-heading">
                <span>Choose a page</span>
                <small>${state.editorMode === "beta" ? "Changes stay in preview until you publish" : "Live site is view-only"}</small>
              </div>
              <select id="web-editor-page" class="editor-inspector-select">
                <option value="/">Home</option>
                <option value="/qualifications.html">Qualifications</option>
                <option value="/short-courses.html">Short Courses</option>
                <option value="/about.html">About</option>
                <option value="/testimonials.html">Testimonials</option>
                <option value="/faqs.html">FAQs</option>
                <option value="/contact.html">Contact</option>
              </select>
            </section>

            <section class="editor-inspector-section editor-banner-section">
              <div class="editor-inspector-heading">
                <span>Rolling banner</span>
                <small>${state.editorMode === "production" ? "Live website" : "Preview website"}</small>
              </div>

              <div class="editor-banner-toolbar is-current-branch">
                <div class="editor-banner-branch">
                  <span>Where this appears</span>
                  <strong>${state.editorMode === "production" ? "Live website" : "Preview website"}</strong>
                </div>
                <label>
                  <span>Swap every</span>
                  <select id="editor-banner-interval">
                    ${[4000, 5200, 6500, 8000].map((value) => `
                      <option value="${value}" ${Number(state.editorBannerInterval) === value ? "selected" : ""}>${(value / 1000).toFixed(value % 1000 ? 1 : 0)}s</option>
                    `).join("")}
                  </select>
                </label>
              </div>

              <div id="editor-banner-list" class="editor-banner-list">
                ${state.editorBannerItems.map((item, index) => {
                  const isOpen = state.editorBannerOpenId === item.id;
                  const scheduleLabel =
                    item.startsAt || item.endsAt
                      ? `${item.startsAt ? `From ${editorDateTimeLocal(item.startsAt).replace("T", " ")}` : "Now"} · ${item.endsAt ? `until ${editorDateTimeLocal(item.endsAt).replace("T", " ")}` : "no end"}`
                      : "Always visible";

                  return `
                    <article class="editor-banner-card${isOpen ? " is-open" : ""}" data-banner-index="${index}" data-banner-id="${escapeEditorAttribute(item.id)}">
                      <div class="editor-banner-card-head">
                        <button
                          class="editor-banner-card-toggle"
                          type="button"
                          data-banner-toggle="${index}"
                          aria-expanded="${isOpen ? "true" : "false"}"
                        >
                          <span
                            class="editor-banner-card-colour"
                            style="--banner-preview:${/^#[0-9a-f]{6}$/i.test(item.background || "") ? item.background : "#304660"}"
                            aria-hidden="true"
                          ></span>
                          <span class="editor-banner-card-summary">
                            <strong>${escapeEditorAttribute(item.message || `Announcement ${index + 1}`)}</strong>
                            <small>${escapeEditorAttribute(scheduleLabel)}</small>
                          </span>
                          <span class="editor-banner-card-chevron" aria-hidden="true">⌄</span>
                        </button>

                        <button
                          class="editor-banner-delete"
                          type="button"
                          data-banner-remove="${index}"
                          aria-label="Delete ${escapeEditorAttribute(item.message || `announcement ${index + 1}`)}"
                          title="Delete rolling banner"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
                          </svg>
                        </button>
                      </div>

                      <div class="editor-banner-card-body">
                        <label class="editor-banner-enabled">
                          <input type="checkbox" data-banner-field="enabled" ${item.enabled !== false ? "checked" : ""}>
                          <span>Enabled</span>
                        </label>

                        <label class="editor-banner-wide">
                          <span>Message</span>
                          <input type="text" maxlength="150" data-banner-field="message" value="${escapeEditorAttribute(item.message)}">
                        </label>

                        <div class="editor-banner-row">
                          <label>
                            <span>Link label</span>
                            <input type="text" maxlength="80" data-banner-field="cta" value="${escapeEditorAttribute(item.cta)}">
                          </label>
                          <label>
                            <span>Link</span>
                            <input type="text" maxlength="400" data-banner-field="href" value="${escapeEditorAttribute(item.href)}" placeholder="event.html">
                          </label>
                        </div>

                        <div class="editor-banner-row">
                          <label>
                            <span>Background</span>
                            <div class="editor-banner-colour-input">
                              <input type="color" data-banner-field="background" value="${/^#[0-9a-f]{6}$/i.test(item.background || "") ? item.background : "#304660"}">
                              <code>${escapeEditorAttribute((item.background || "#304660").toUpperCase())}</code>
                            </div>
                          </label>
                          <label>
                            <span>Text colour</span>
                            <div class="editor-banner-colour-input">
                              <input type="color" data-banner-field="foreground" value="${/^#[0-9a-f]{6}$/i.test(item.foreground || "") ? item.foreground : "#FFFEFA"}">
                              <code>${escapeEditorAttribute((item.foreground || "#FFFEFA").toUpperCase())}</code>
                            </div>
                          </label>
                        </div>

                        <div class="editor-banner-row">
                          <label>
                            <span>Show from</span>
                            <input type="datetime-local" data-banner-field="startsAt" value="${editorDateTimeLocal(item.startsAt)}">
                          </label>
                          <label>
                            <span>Hide after</span>
                            <input type="datetime-local" data-banner-field="endsAt" value="${editorDateTimeLocal(item.endsAt)}">
                          </label>
                        </div>
                      </div>
                    </article>
                  `;
                }).join("")}
              </div>

              <div class="editor-banner-actions">
                <button id="editor-banner-add" type="button">+ Add rolling banner</button>
                <button id="editor-banner-save" class="is-primary" type="button" ${connected && state.editorBannerDirty ? "" : "disabled"}>
                  ${state.editorMode === "production" ? "Save live banner" : "Save preview banner"}
                </button>
              </div>
              <small class="editor-banner-note">
                ${state.editorMode === "production"
                  ? "Changes here update the live website after you save."
                  : "Changes here update only the preview website until you publish it live."}
              </small>
            </section>

            <section class="editor-inspector-section editor-selection-section">
              <div class="editor-inspector-heading">
                <span>Selected item</span>
                <small>Click text, an image or a link</small>
              </div>
              <div id="editor-selected-item" class="editor-selected-item">
                <div class="editor-selection-empty">
                  <strong>Nothing selected</strong>
                  <span>${editable
                    ? "Move over the website preview and click the item you want to change."
                    : "Choose Edit preview above to make changes."}</span>
                </div>
              </div>
            </section>

            <section class="editor-inspector-section">
              <div class="editor-inspector-heading">
                <span>Page colours</span>
                <small id="editor-colour-count">${state.editorColours.length ? `${state.editorColours.length} found` : "Finding colours…"}</small>
              </div>
              <div id="editor-colour-swatches" class="editor-colour-swatches"></div>
            </section>

            <section class="editor-inspector-section">
              <div class="editor-inspector-heading">
                <span>Pick a colour</span>
                <small>Sample any colour on screen</small>
              </div>
              <button id="editor-eyedropper" class="editor-eyedropper-button" type="button">
                <span class="editor-eyedropper-icon">⌾</span>
                <span>
                  <strong>Choose from the screen</strong>
                  <small>Click anywhere on screen to copy that exact colour.</small>
                </span>
              </button>

              <div class="editor-picked-colour">
                <span id="editor-picked-colour-swatch" style="--picked-colour:${state.editorPickedColour || currentAccent}"></span>
                <div>
                  <small>Selected hex</small>
                  <strong id="editor-picked-colour-value">${state.editorPickedColour || currentAccent}</strong>
                </div>
                <button id="editor-copy-colour" type="button">Copy</button>
              </div>

              <button
                id="editor-apply-picked-accent"
                class="editor-apply-colour"
                type="button"
                ${editable && state.editorPickedColour ? "" : "disabled"}
              >Use as page accent</button>
            </section>

            ${!connected ? `
              <section class="editor-inspector-section">
                <div class="editor-secret-callout">
                  <strong>Publishing is temporarily unavailable</strong>
                  <span>The website publishing connection needs administrator attention.</span>
                </div>
              </section>
            ` : ""}
          </div>

          <div class="editor-simple-help">
            <strong>How to edit</strong>
            <span>Click an item in the preview, make the change, then use <b>Push changes to beta</b> when you are ready to review it.</span>
          </div>
        </aside>

        <main class="editor-live-workspace">
          <div class="editor-live-toolbar">
            <div class="editor-live-location">
              <span class="editor-status-dot"></span>
              <div>
                <strong id="web-editor-preview-title">${state.editorMode === "beta" ? "Preview website" : "Live website"}</strong>
                <small id="web-editor-preview-path"></small>
              </div>
            </div>

            <div class="editor-device-toolbar" role="group" aria-label="Preview device size">
              <button class="${state.editorDevice === "desktop" ? "is-active" : ""}" type="button" data-editor-device="desktop">Desktop</button>
              <button class="${state.editorDevice === "tablet" ? "is-active" : ""}" type="button" data-editor-device="tablet">Tablet</button>
              <button class="${state.editorDevice === "mobile" ? "is-active" : ""}" type="button" data-editor-device="mobile">Mobile</button>
            </div>

            <div class="editor-live-help">
              ${editable ? "Hover and click anything you want to change" : "Live website preview · view only"}
            </div>
          </div>

          <div class="editor-preview-placeholder is-fullscreen">
            <div id="web-editor-browser" class="editor-preview-browser is-fullscreen" data-device="${state.editorDevice}">
              <div class="editor-preview-browser-bar">
                <i></i><i></i><i></i>
                <span id="web-editor-browser-url"></span>
                <b class="${state.editorMode === "beta" ? "is-beta" : ""}">${state.editorMode === "beta" ? "BETA" : "PROD"}</b>
              </div>
              <iframe
                id="web-editor-frame"
                class="editor-live-frame"
                title="Well College Global website preview"
                loading="eager"
                referrerpolicy="strict-origin-when-cross-origin"
              ></iframe>
            </div>
          </div>

          <footer class="editor-fullscreen-footer">
            <div>
              <strong>${state.editorMode === "beta" ? "Preview changes" : "Live website"}</strong>
              <span>${state.editorMode === "beta"
                ? `${pendingCount || 0} page${pendingCount === 1 ? "" : "s"} with changes · nothing reaches the live site until you approve the preview`
                : "Choose Edit preview to make website changes."}</span>
            </div>
            <button id="web-editor-discard" class="editor-topbar-button" type="button" ${state.editorMode === "beta" ? "" : "disabled"}>Discard page changes</button>
          </footer>
        </main>
      </div>
    </div>

    <div id="editor-banner-delete-modal" class="confirm-modal" hidden>
      <button
        id="editor-banner-delete-backdrop"
        class="confirm-modal-backdrop"
        type="button"
        aria-label="Cancel rolling banner deletion"
      ></button>
      <section class="confirm-card is-danger" role="dialog" aria-modal="true" aria-labelledby="editor-banner-delete-title">
        <div class="confirm-icon is-danger">!</div>
        <h2 id="editor-banner-delete-title">Delete rolling banner?</h2>
        <p id="editor-banner-delete-copy">This removes the selected rolling banner and creates a GitHub commit on the branch you are viewing.</p>
        <div class="confirm-actions">
          <button id="cancel-editor-banner-delete" class="confirm-secondary" type="button">Cancel</button>
          <button id="confirm-editor-banner-delete" class="confirm-danger" type="button">Delete &amp; commit</button>
        </div>
      </section>
    </div>

    <div id="editor-promote-modal" class="confirm-modal" hidden>
      <button
        id="editor-promote-backdrop"
        class="confirm-modal-backdrop"
        type="button"
        aria-label="Cancel production promotion"
      ></button>
      <section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="editor-promote-title">
        <div class="confirm-icon">${editorIcon()}</div>
        <h2 id="editor-promote-title">Publish preview to the live website?</h2>
        <p>This publishes the preview version to the live Well College Global website.</p>
        <div class="confirm-actions">
          <button id="cancel-editor-promote" class="confirm-secondary" type="button">Cancel</button>
          <button id="confirm-editor-promote" class="confirm-danger" type="button">Publish preview to live site</button>
        </div>
      </section>
    </div>
  `;

  const pageSelect = document.querySelector("#web-editor-page");
  const frame = document.querySelector("#web-editor-frame");
  const browser = document.querySelector("#web-editor-browser");
  const openPage = document.querySelector("#web-editor-open-page");
  const previewPath = document.querySelector("#web-editor-preview-path");
  const browserUrl = document.querySelector("#web-editor-browser-url");
  const publishButton = document.querySelector("#web-editor-preview-submit");
  const selectedText = document.querySelector("#editor-selected-text");
  const pickedValue = document.querySelector("#editor-picked-colour-value");
  const pickedSwatch = document.querySelector("#editor-picked-colour-swatch");
  const applyPickedAccent = document.querySelector("#editor-apply-picked-accent");
  const bannerInterval = document.querySelector("#editor-banner-interval");
  const bannerList = document.querySelector("#editor-banner-list");
  const bannerSave = document.querySelector("#editor-banner-save");

  if (pageSelect) pageSelect.value = state.editorPage;

  const activeOrigin = () =>
    state.editorMode === "beta"
      ? betaPreviewOrigin
      : productionPreviewOrigin;

  const pageUrl = () =>
    new URL(state.editorPage || "/", activeOrigin()).toString();

  const iframeUrl = (cacheBust = false) => {
    const url = new URL(pageUrl());
    url.searchParams.set("wcgEditor", "1");
    if (cacheBust) url.searchParams.set("_preview", String(Date.now()));
    return url.toString();
  };

  const draftPayload = () => ({
    heading: state.editorHeadingDraft || "",
    copy: state.editorCopyDraft || "",
    accent: state.editorAccentDraft || "",
    font: state.editorFontDraft || "",
    text: { ...state.editorTextDrafts },
    editable
  });

  const setDirty = () => {
    if (!editable) return;
    state.editorDirty = true;
    if (publishButton) publishButton.disabled = false;
  };

  const postDraft = () => {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        type: "WCG_EDITOR_PREVIEW",
        payload: draftPayload()
      },
      activeOrigin()
    );
  };

  const requestColours = () => {
    frame?.contentWindow?.postMessage(
      { type: "WCG_EDITOR_SCAN_COLOURS" },
      activeOrigin()
    );
  };

  const renderSelectedText = () => {
    if (!selectedText) return;
    const strong = selectedText.querySelector("strong");
    const value = selectedText.querySelector("span");

    selectedText.classList.toggle("has-selection", Boolean(state.editorSelectedText));
    if (strong) {
      strong.textContent = state.editorSelectedText
        ? `${String(state.editorSelectedText.tag || "text").toUpperCase()} selected`
        : "Nothing selected";
    }
    if (value) {
      value.textContent = state.editorSelectedText?.text || "";
    }
  };

  const renderColours = () => {
    const host = document.querySelector("#editor-colour-swatches");
    const count = document.querySelector("#editor-colour-count");
    if (!host) return;

    host.replaceChildren();
    const colours = Array.isArray(state.editorColours)
      ? state.editorColours.filter((item) => /^#[0-9a-f]{6}$/i.test(item?.hex || ""))
      : [];

    if (count) {
      count.textContent = colours.length
        ? `${colours.length} detected`
        : "No colours detected";
    }

    for (const colour of colours) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "editor-colour-swatch";
      button.style.setProperty("--swatch", colour.hex);
      button.title = `${colour.hex} · used ${colour.count || 1} time${Number(colour.count || 1) === 1 ? "" : "s"}`;
      button.setAttribute("aria-label", `Use colour ${colour.hex}`);

      const sample = document.createElement("span");
      const code = document.createElement("strong");
      code.textContent = String(colour.hex).toUpperCase();
      button.append(sample, code);

      button.addEventListener("click", async () => {
        state.editorPickedColour = String(colour.hex).toUpperCase();
        if (pickedValue) pickedValue.textContent = state.editorPickedColour;
        if (pickedSwatch) {
          pickedSwatch.style.setProperty("--picked-colour", state.editorPickedColour);
        }
        if (applyPickedAccent) applyPickedAccent.disabled = !editable;

        try {
          await navigator.clipboard.writeText(state.editorPickedColour);
          showToast(`${state.editorPickedColour} copied.`);
        } catch {
          showToast(`Selected ${state.editorPickedColour}.`);
        }
      });

      host.appendChild(button);
    }
  };

  const updatePreviewLocation = ({ reload = true, cacheBust = false } = {}) => {
    const url = pageUrl();
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;

    if (openPage) openPage.href = url;
    if (previewPath) previewPath.textContent = display;
    if (browserUrl) browserUrl.textContent = display;
    if (reload && frame) frame.src = iframeUrl(cacheBust);
  };

  if (state.editorMessageHandler) {
    window.removeEventListener("message", state.editorMessageHandler);
  }

  state.editorMessageHandler = (event) => {
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
    if (![productionPreviewOrigin, betaPreviewOrigin].includes(event.origin)) return;
    if (!event.data || typeof event.data !== "object") return;

    if (event.data.type === "WCG_EDITOR_READY") {
      window.setTimeout(() => {
        postDraft();
        requestColours();
      }, 30);
      return;
    }

    if (event.data.type === "WCG_EDITOR_COLOURS") {
      state.editorColours = Array.isArray(event.data.colours)
        ? event.data.colours
        : [];
      renderColours();
      return;
    }

    if (event.data.type === "WCG_EDITOR_TEXT_SELECTED") {
      state.editorSelectedText = {
        selector: String(event.data.selector || ""),
        text: String(event.data.text || ""),
        tag: String(event.data.tag || "")
      };
      renderSelectedText();
      return;
    }

    if (event.data.type === "WCG_EDITOR_TEXT_CHANGE" && editable) {
      const selector = String(event.data.selector || "");
      const text = String(event.data.text || "").slice(0, 4000);
      if (!selector) return;

      state.editorTextDrafts = {
        ...state.editorTextDrafts,
        [selector]: text
      };
      state.editorSelectedText = {
        selector,
        text,
        tag: String(event.data.tag || "")
      };
      setDirty();
      renderSelectedText();
    }
  };

  window.addEventListener("message", state.editorMessageHandler);

  document.querySelector("#web-editor-exit")?.addEventListener("click", () => {
    if (state.editorMessageHandler) {
      window.removeEventListener("message", state.editorMessageHandler);
      state.editorMessageHandler = null;
    }
    setDashboardView("dashboard");
  });

  document.querySelectorAll("[data-editor-environment]").forEach((button) => {
    button.addEventListener("click", () => {
      const next =
        button.dataset.editorEnvironment === "production"
          ? "production"
          : "beta";

      if (next === state.editorMode) return;
      state.editorMode = next;
      state.editorDirty = false;
      state.editorDraftKey = "";
      state.editorColours = [];
      state.editorSelectedText = null;
      state.editorBannerTarget = next === "production" ? "production" : "beta";
      state.editorBannerDirty = false;
      state.editorBannerKey = "";
      state.editorBannerOpenId = "";
      renderWebEditor();
    });
  });

  pageSelect?.addEventListener("change", () => {
    state.editorPage = pageSelect.value || "/";
    state.editorDirty = false;
    state.editorDraftKey = "";
    state.editorColours = [];
    state.editorSelectedText = null;
    renderWebEditor();
  });

  bannerInterval?.addEventListener("change", () => {
    state.editorBannerInterval = Number(bannerInterval.value || 5200);
    state.editorBannerDirty = true;
    if (bannerSave) bannerSave.disabled = !connected;
  });

  bannerList?.addEventListener("input", (event) => {
    const input = event.target;
    const card = input?.closest?.("[data-banner-index]");
    const field = input?.dataset?.bannerField;
    const index = Number(card?.dataset?.bannerIndex);

    if (!field || !Number.isInteger(index) || !state.editorBannerItems[index]) return;

    const item = state.editorBannerItems[index];

    if (field === "enabled") {
      item.enabled = Boolean(input.checked);
    } else if (field === "startsAt" || field === "endsAt") {
      item[field] = input.value
        ? new Date(input.value).toISOString()
        : "";
    } else if (field === "background" || field === "foreground") {
      item[field] = String(input.value || "").toUpperCase();
      const code = input.closest(".editor-banner-colour-input")?.querySelector("code");
      if (code) code.textContent = item[field];
    } else {
      item[field] = String(input.value || "");
    }

    state.editorBannerDirty = true;
    if (bannerSave) bannerSave.disabled = !connected;
  });

  bannerList?.addEventListener("change", (event) => {
    if (event.target?.dataset?.bannerField === "enabled") {
      event.target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  bannerList?.addEventListener("click", (event) => {
    const toggle = event.target?.closest?.("[data-banner-toggle]");
    if (toggle) {
      const index = Number(toggle.dataset.bannerToggle);
      const item = state.editorBannerItems[index];
      if (!item) return;

      const card = toggle.closest(".editor-banner-card");
      const nextOpen = state.editorBannerOpenId !== item.id;
      state.editorBannerOpenId = nextOpen ? item.id : "";

      bannerList.querySelectorAll(".editor-banner-card").forEach((node) => {
        const open = node === card && nextOpen;
        node.classList.toggle("is-open", open);
        node.querySelector("[data-banner-toggle]")?.setAttribute(
          "aria-expanded",
          open ? "true" : "false"
        );
      });
      return;
    }

    const button = event.target?.closest?.("[data-banner-remove]");
    if (!button) return;

    const index = Number(button.dataset.bannerRemove);
    const item = state.editorBannerItems[index];
    if (!Number.isInteger(index) || !item) return;

    state.editorBannerPendingDeleteIndex = index;

    const modal = document.querySelector("#editor-banner-delete-modal");
    const title = document.querySelector("#editor-banner-delete-title");
    const copy = document.querySelector("#editor-banner-delete-copy");

    if (title) title.textContent = "Delete rolling banner?";
    if (copy) {
      copy.textContent = `“${item.message}” will be removed and committed immediately to WellWebsite/${state.editorMode === "production" ? "main" : "beta-main"}.`;
    }

    if (modal) modal.hidden = false;
    document.body.classList.add("has-support-confirm-modal");
    requestAnimationFrame(() => {
      document.querySelector("#confirm-editor-banner-delete")?.focus();
    });
  });

  document.querySelector("#editor-banner-add")?.addEventListener("click", () => {
    const item = newEditorBannerItem();
    state.editorBannerItems.push(item);
    state.editorBannerOpenId = item.id;
    state.editorBannerDirty = true;
    renderWebEditor();
  });

  bannerSave?.addEventListener("click", publishEditorBanner);

  frame?.addEventListener("load", () => {
    window.setTimeout(() => {
      postDraft();
      requestColours();
    }, 80);
  });

  document.querySelectorAll("[data-editor-device]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editorDevice = button.dataset.editorDevice || "desktop";
      if (browser) browser.dataset.device = state.editorDevice;

      document.querySelectorAll("[data-editor-device]").forEach((item) => {
        item.classList.toggle(
          "is-active",
          item.dataset.editorDevice === state.editorDevice
        );
      });
    });
  });

  document.querySelector("#web-editor-refresh")?.addEventListener("click", () => {
    if (frame) frame.src = iframeUrl(true);
  });

  document.querySelector("#web-editor-inspect")?.addEventListener("click", () => {
    window.open(pageUrl(), "_blank", "noopener,noreferrer");
    showToast("Opened current page. Use ⌘⌥I on Mac or Ctrl+Shift+I / F12 on Windows.");
  });

  document.querySelector("#editor-eyedropper")?.addEventListener("click", async () => {
    if (!window.EyeDropper) {
      showToast("Chrome EyeDropper is unavailable in this browser.", "error");
      return;
    }

    try {
      const result = await new window.EyeDropper().open();
      const hex = String(result?.sRGBHex || "").toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(hex)) return;

      state.editorPickedColour = hex;
      if (pickedValue) pickedValue.textContent = hex;
      if (pickedSwatch) pickedSwatch.style.setProperty("--picked-colour", hex);
      if (applyPickedAccent) applyPickedAccent.disabled = !editable;

      try {
        await navigator.clipboard.writeText(hex);
        showToast(`${hex} copied to clipboard.`);
      } catch {
        showToast(`Captured ${hex}.`);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        showToast("Unable to sample that colour.", "error");
      }
    }
  });

  document.querySelector("#editor-copy-colour")?.addEventListener("click", async () => {
    const hex = state.editorPickedColour || currentAccent;
    try {
      await navigator.clipboard.writeText(hex);
      showToast(`${hex} copied.`);
    } catch {
      showToast(`Selected ${hex}.`);
    }
  });

  applyPickedAccent?.addEventListener("click", () => {
    if (!editable || !/^#[0-9A-F]{6}$/i.test(state.editorPickedColour)) return;
    state.editorAccentDraft = state.editorPickedColour.toUpperCase();
    setDirty();
    postDraft();
    window.setTimeout(requestColours, 40);
  });

  document.querySelector("#web-editor-discard")?.addEventListener("click", () => {
    if (state.editorMode !== "beta") return;

    const deployed = editorPageConfig("beta", state.editorPage);
    state.editorTextDrafts =
      deployed.text && typeof deployed.text === "object"
        ? { ...deployed.text }
        : {};
    state.editorAccentDraft = String(deployed.accent || "");
    state.editorFontDraft = String(deployed.font || "");
    state.editorHeadingDraft = String(deployed.heading || "");
    state.editorCopyDraft = String(deployed.copy || "");
    state.editorDirty = false;
    state.editorSelectedText = null;

    if (publishButton) publishButton.disabled = true;

    frame?.contentWindow?.postMessage(
      {
        type: "WCG_EDITOR_PREVIEW_RESET",
        editable
      },
      betaPreviewOrigin
    );

    window.setTimeout(() => {
      postDraft();
      requestColours();
    }, 20);

    renderSelectedText();
    showToast("Draft reset to the deployed beta-main version.");
  });

  publishButton?.addEventListener("click", () => {
    if (!editable || !state.editorDirty) return;

    publishWebEditorDraft({
      pagePath: state.editorPage,
      heading: state.editorHeadingDraft || "",
      copy: state.editorCopyDraft || "",
      accent: state.editorAccentDraft || "",
      font: state.editorFontDraft || "",
      text: { ...state.editorTextDrafts }
    });
  });

  document.querySelector("#web-editor-sync")?.addEventListener(
    "click",
    syncWebEditorBeta
  );

  const closeBannerDeleteConfirm = () => {
    const modal = document.querySelector("#editor-banner-delete-modal");
    if (modal) modal.hidden = true;
    state.editorBannerPendingDeleteIndex = null;
    document.body.classList.remove("has-support-confirm-modal");
  };

  document.querySelector("#editor-banner-delete-backdrop")?.addEventListener(
    "click",
    closeBannerDeleteConfirm
  );

  document.querySelector("#cancel-editor-banner-delete")?.addEventListener(
    "click",
    closeBannerDeleteConfirm
  );

  document.querySelector("#confirm-editor-banner-delete")?.addEventListener(
    "click",
    () => deleteEditorBannerItem(state.editorBannerPendingDeleteIndex)
  );

  document.querySelector("#editor-banner-delete-modal")?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeBannerDeleteConfirm();
    }
  );

  document.querySelector("#web-editor-promote")?.addEventListener(
    "click",
    openEditorPromotionConfirm
  );

  document.querySelector("#editor-promote-backdrop")?.addEventListener(
    "click",
    closeEditorPromotionConfirm
  );

  document.querySelector("#cancel-editor-promote")?.addEventListener(
    "click",
    closeEditorPromotionConfirm
  );

  document.querySelector("#confirm-editor-promote")?.addEventListener(
    "click",
    promoteWebEditorBeta
  );

  document.querySelector("#editor-promote-modal")?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeEditorPromotionConfirm();
    }
  );

  renderSelectedText();
  renderColours();
  updatePreviewLocation({ reload: true });

  if (!state.editorStatus && !state.editorLoading) {
    window.setTimeout(() => loadWebEditorStatus({ quiet: true }), 0);
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

function formatDecimal(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(digits) : "0.00";
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

function renderRankBars(id, rows, {
  labelKey,
  valueKey,
  secondary
}) {
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

  const max = Math.max(
    ...rows.map((row) => Number(row?.[valueKey] || 0)),
    1
  );

  rows.forEach((row, index) => {
    const value = Number(row?.[valueKey] || 0);
    const item = document.createElement("div");
    item.className = "rank-bar-item";

    const head = document.createElement("div");
    head.className = "rank-bar-head";

    const label = document.createElement("div");
    label.className = "rank-bar-label";

    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = row?.[labelKey] || "Unknown";
    copy.appendChild(strong);

    const secondaryValue = secondary?.(row);
    if (secondaryValue) {
      const small = document.createElement("small");
      small.textContent = secondaryValue;
      copy.appendChild(small);
    }

    label.append(number, copy);

    const metric = document.createElement("b");
    metric.textContent = formatNumber(value);

    head.append(label, metric);

    const track = document.createElement("div");
    track.className = "rank-bar-track";

    const fill = document.createElement("span");
    fill.style.width = `${Math.max(3, Math.round((value / max) * 100))}%`;
    track.appendChild(fill);

    item.append(head, track);
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
          <p>Cloudflare Web Analytics traffic with first-party engagement and conversion events from Well College Global.</p>
        </div>
        <div class="analytics-range" role="group" aria-label="Analytics date range">
          <button type="button" data-analytics-days="7">7d</button>
          <button type="button" data-analytics-days="30">30d</button>
          <button type="button" data-analytics-days="90">90d</button>
        </div>
      </header>

      <div id="analytics-loading" class="analytics-loading" hidden>Refreshing analytics…</div>
      <div id="analytics-source" class="analytics-source" aria-live="polite"></div>

      <section class="analytics-metrics" aria-label="Website metrics">
        <article><span>Visits</span><strong id="metric-visits">0</strong><small>Cloudflare human visits</small></article>
        <article><span>Page views</span><strong id="metric-pageviews">0</strong><small>Cloudflare RUM page loads</small></article>
        <article><span>Pages / visit</span><strong id="metric-pages-per-visit">0.00</strong><small>page views divided by visits</small></article>
        <article class="is-page-metric"><span>Most viewed page</span><strong id="metric-most-viewed">—</strong><small id="metric-most-viewed-count">No views yet</small></article>
        <article><span>Total clicks</span><strong id="metric-clicks">0</strong><small>first-party links and controls</small></article>
        <article><span>Avg. engagement</span><strong id="metric-duration">0s</strong><small>first-party time until page exit</small></article>
      </section>

      <section class="analytics-grid">
        <article class="analytics-card is-wide">
          <div class="analytics-card-head">
            <div><span>Content</span><h2>Most viewed pages</h2></div>
          </div>
          <div id="analytics-top-pages" class="rank-bars"></div>
        </article>

        <article class="analytics-card is-wide">
          <div class="analytics-card-head">
            <div><span>Click off</span><h2>Where visitors leave</h2></div>
          </div>
          <div id="analytics-exit-pages" class="rank-bars"></div>
        </article>

        <article class="analytics-card is-wide">
          <div class="analytics-card-head">
            <div><span>Traffic</span><h2>Page views over time</h2></div>
          </div>
          <div id="analytics-traffic-bars" class="traffic-bars"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Engagement</span><h2>Top clicks</h2></div></div>
          <div id="analytics-top-clicks" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Audience</span><h2>Top countries</h2></div></div>
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
          <div class="analytics-card-head"><div><span>Browsers</span><h2>Top browsers</h2></div></div>
          <div id="analytics-browsers" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Systems</span><h2>Operating systems</h2></div></div>
          <div id="analytics-operating-systems" class="analytics-list"></div>
        </article>

        <article class="analytics-card">
          <div class="analytics-card-head"><div><span>Campaigns</span><h2>UTM traffic</h2></div></div>
          <div id="analytics-campaigns" class="analytics-list"></div>
        </article>

        <article class="analytics-card is-wide privacy-card">
          <div class="analytics-card-head"><div><span>Privacy</span><h2>Tracking & storage inventory</h2></div></div>
          <div class="privacy-grid">
            <div><strong>Traffic source</strong><span>Cloudflare Web Analytics aggregated RUM data</span></div>
            <div><strong>Engagement events</strong><span>First-party click, exit and UTM events only</span></div>
            <div><strong>Analytics cookies</strong><span>None</span></div>
            <div><strong>Raw IP in analytics</strong><span>Not stored by the historical Well analytics event table</span></div>
            <div><strong>Live visitor presence</strong><span>Current IP and page are held only in the private short-lived Visitors view</span></div>
            <div><strong>Privacy signals</strong><span>Global Privacy Control and Do Not Track are respected by first-party events</span></div>
            <div><strong>First-party retention</strong><span>Engagement events are deleted after 90 days</span></div>
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
  const topPage = summary.topPages?.[0] || null;
  const metricValues = {
    "#metric-visits": formatNumber(metrics.visits),
    "#metric-pageviews": formatNumber(metrics.pageViews),
    "#metric-pages-per-visit": formatDecimal(metrics.pagesPerVisit),
    "#metric-most-viewed": topPage?.path || "—",
    "#metric-most-viewed-count": topPage
      ? `${formatNumber(topPage.views)} views`
      : "No views yet",
    "#metric-clicks": formatNumber(metrics.clicks),
    "#metric-duration": formatDuration(metrics.avgDurationMs)
  };

  Object.entries(metricValues).forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  });

  const source = document.querySelector("#analytics-source");
  if (source) {
    if (summary.trafficSource === "cloudflare") {
      source.textContent = "Traffic: Cloudflare Web Analytics · Engagement: first-party events";
      source.classList.remove("is-warning");
    } else {
      source.textContent = summary.cloudflareConfigured
        ? "Cloudflare traffic is temporarily unavailable · showing first-party fallback data"
        : "Cloudflare analytics is not configured · showing first-party fallback data";
      source.classList.add("is-warning");
    }
  }

  renderRankBars("#analytics-top-pages", summary.topPages || [], {
    labelKey: "path",
    valueKey: "views",
    secondary: () => "Page views"
  });
  renderRankBars("#analytics-exit-pages", summary.exitPages || [], {
    labelKey: "path",
    valueKey: "exits",
    secondary: (row) => `Avg. ${formatDuration(row.avgDurationMs)} before exit`
  });
  renderTrafficBars(summary.daily || []);
  renderAnalyticsList("#analytics-top-clicks", summary.topClicks, (row) => ({
    primary: row.label,
    secondary: row.href || row.kind || "",
    value: formatNumber(row.clicks)
  }));
  renderAnalyticsList("#analytics-locations", summary.locations, (row) => ({
    primary: row.country || "Unknown",
    secondary: "Cloudflare visits",
    value: formatNumber(row.visitors)
  }));
  renderAnalyticsList("#analytics-referrers", summary.referrers, (row) => ({
    primary: row.host,
    secondary: "Cloudflare visits",
    value: formatNumber(row.visitors)
  }));
  renderAnalyticsList("#analytics-devices", summary.devices, (row) => ({
    primary: String(row.device || "unknown").replace(/^./, (letter) => letter.toUpperCase()),
    secondary: "Cloudflare visits",
    value: formatNumber(row.visitors)
  }));
  renderAnalyticsList("#analytics-browsers", summary.browsers, (row) => ({
    primary: row.browser || "Unknown",
    secondary: "Cloudflare visits",
    value: formatNumber(row.visitors)
  }));
  renderAnalyticsList("#analytics-operating-systems", summary.operatingSystems, (row) => ({
    primary: row.os || "Unknown",
    secondary: "Cloudflare visits",
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

function countryFlagEmoji(countryCode) {
  const code = String(countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(
    ...[...code].map((letter) => 127397 + letter.charCodeAt(0))
  );
}

function visitorLastSeenLabel(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Active now";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 8) return "Active now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.max(1, Math.round(seconds / 60))}m ago`;
}

function visitorWebsiteUrl(path) {
  const value = String(path || "/").trim();
  try {
    return new URL(value.startsWith("/") ? value : `/${value}`, "https://www.wellcollegeglobal.com").toString();
  } catch {
    return "https://www.wellcollegeglobal.com/";
  }
}

function paintVisitors() {
  if (state.currentView !== "visitors") return;

  const count = document.querySelector("#visitors-count");
  const badge = document.querySelector("#visitors-nav-badge");
  const loading = document.querySelector("#visitors-loading");
  const list = document.querySelector("#visitors-list");
  const stamp = document.querySelector("#visitors-updated");

  const total = state.visitors.length;
  if (count) count.textContent = String(total);
  if (badge) {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.hidden = total < 1;
  }
  if (loading) loading.hidden = !state.visitorsLoading;
  if (stamp) {
    stamp.textContent = state.visitorsGeneratedAt
      ? `Updated ${visitorLastSeenLabel(state.visitorsGeneratedAt)}`
      : "Live presence";
  }
  if (!list) return;

  list.replaceChildren();

  if (!total && !state.visitorsLoading) {
    const empty = document.createElement("div");
    empty.className = "visitors-empty";
    empty.innerHTML = `
      <span class="visitors-empty-icon">${visitorsIcon()}</span>
      <strong>No active visitors right now</strong>
      <p>Visitors appear here while they are actively browsing the Well College Global website.</p>
    `;
    list.appendChild(empty);
    return;
  }

  for (const visitor of state.visitors) {
    const row = document.createElement("article");
    row.className = "visitor-live-row";

    const location = [visitor.city, visitor.region, visitor.country]
      .filter(Boolean)
      .join(", ") || visitor.country || "Unknown location";

    const page = String(visitor.pagePath || "/");
    const device = String(visitor.device || "unknown");
    const width = Number(visitor.viewportWidth || 0);

    row.innerHTML = `
      <div class="visitor-live-country">
        <span class="visitor-live-flag" aria-hidden="true">${countryFlagEmoji(visitor.countryCode)}</span>
        <div>
          <strong>${escapeEditorAttribute(visitor.country || "Unknown")}</strong>
          <span>${escapeEditorAttribute(location)}</span>
        </div>
      </div>
      <div class="visitor-live-ip">
        <span>IP address</span>
        <code>${escapeEditorAttribute(visitor.ip || "Unavailable")}</code>
      </div>
      <a class="visitor-live-page" href="${escapeEditorAttribute(visitorWebsiteUrl(page))}" target="_blank" rel="noopener noreferrer">
        <span>Current page</span>
        <strong>${escapeEditorAttribute(visitor.pageTitle || page)}</strong>
        <small>${escapeEditorAttribute(page)} ↗</small>
      </a>
      <div class="visitor-live-device">
        <span>Device</span>
        <strong>${escapeEditorAttribute(device.replace(/^./, (letter) => letter.toUpperCase()))}</strong>
        <small>${width ? `${width}px viewport` : "Viewport unavailable"}</small>
      </div>
      <div class="visitor-live-seen">
        <i aria-hidden="true"></i>
        <strong>${escapeEditorAttribute(visitorLastSeenLabel(visitor.lastSeen))}</strong>
      </div>
    `;

    list.appendChild(row);
  }
}

function renderVisitorsPage() {
  const panel = document.querySelector("#chat-panel");
  if (!panel) return;

  panel.className = "chat-panel visitors-panel";
  panel.innerHTML = `
    <div class="visitors-view">
      <header class="visitors-header">
        <div>
          <div class="eyebrow"><i aria-hidden="true"></i> Live website presence</div>
          <div class="visitors-title-row">
            <h1>Visitors</h1>
            <span id="visitors-count" class="visitors-count">0</span>
          </div>
          <p>People currently browsing Well College Global. Presence refreshes automatically and drops off shortly after a visitor leaves.</p>
        </div>
        <div class="visitors-header-actions">
          <span id="visitors-updated">Live presence</span>
          <button id="visitors-refresh" type="button">Refresh</button>
        </div>
      </header>
      <div id="visitors-loading" class="visitors-loading" hidden>Refreshing active visitors…</div>
      <section id="visitors-list" class="visitors-list" aria-live="polite"></section>
      <p class="visitors-privacy-note">IP addresses are used only for this short-lived active-presence view and are not written into the historical analytics event table.</p>
    </div>
  `;

  document.querySelector("#visitors-refresh")?.addEventListener("click", () => {
    loadVisitors();
  });

  paintVisitors();
}

async function loadVisitors({ silent = false } = {}) {
  if (state.visitorsLoading) return;
  state.visitorsLoading = true;
  if (!silent) paintVisitors();

  try {
    const result = await apiRequest("/visitors");
    state.visitors = Array.isArray(result.visitors) ? result.visitors : [];
    state.visitorsGeneratedAt = result.generatedAt || new Date().toISOString();
  } catch (error) {
    if (error.status !== 401 && error.status !== 403 && !silent) {
      showToast(error?.message || "Unable to load active visitors.", "error");
    }
  } finally {
    state.visitorsLoading = false;
    paintVisitors();
  }
}

function renderDashboard() {
  app.innerHTML = `
    <main id="dashboard" class="dashboard is-${state.currentView}">
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
          <button class="nav-button" type="button" data-dashboard-view="visitors">
            ${visitorsIcon()}
            <span>Visitors</span>
            <b id="visitors-nav-badge" class="nav-badge" hidden>0</b>
          </button>
          <button class="nav-button" type="button" data-dashboard-view="messages">
            ${inboxIcon()}
            <span>Messages</span>
            <b id="messages-nav-badge" class="nav-badge" hidden>0</b>
          </button>
          <button class="nav-button" type="button" data-dashboard-view="editor">
            ${editorIcon()}
            <span>Web Editor</span>
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
          <button class="all-chats-entry" type="button" data-message-section="all">
            <span class="all-chats-copy">
              <strong>All chats</strong>
              <small>Active chats across staff</small>
            </span>
            <span class="all-chats-right">
              <b id="all-chats-count" class="section-count">0</b>
              <span id="all-chats-avatars" class="all-chats-avatars" aria-hidden="true"></span>
            </span>
          </button>

          <div class="message-section-tabs" role="group" aria-label="Message queues">
            <button class="message-section-button is-active" type="button" data-message-section="current">
              <span>Current</span>
              <b id="current-count">0</b>
            </button>
            <button class="message-section-button" type="button" data-message-section="waiting">
              <span>Waiting</span>
              <b id="waiting-count">0</b>
            </button>
          </div>

          <label class="search-wrap">
            ${searchIcon()}
            <input id="conversation-search" type="search" placeholder="Search conversations" autocomplete="off" />
          </label>
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

  document.querySelectorAll("[data-dashboard-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setDashboardView(button.dataset.dashboardView);
    });
  });
  document.querySelector("#notification-permission-button")?.addEventListener(
    "click",
    requestDesktopNotifications
  );
  updatePrimaryNavigation();
  renderNotificationControl();
  renderAnalyticsDashboard();

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

  document.querySelectorAll("[data-message-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.messageSection = button.dataset.messageSection || "current";
      document.querySelectorAll("[data-message-section]").forEach((item) => {
        item.classList.toggle(
          "is-active",
          item.dataset.messageSection === state.messageSection
        );
      });
      renderConversationList();
    });
  });

  renderRealtimeStatus();
  setDashboardView(state.currentView, { historyMode: "replace" });
}

async function initialiseDashboard() {
  await Promise.all([loadInbox(), loadAnalytics()]);
  subscribeRealtime();
}

window.addEventListener("popstate", () => {
  if (!state.user) return;
  setDashboardView(dashboardViewFromPath(), { historyMode: "none" });
});

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

    const activeConversationIds = new Set(
      state.conversations.map((conversation) => conversation.id)
    );
    let removedVisitorOverride = false;
    for (const conversationId of state.visitorNameOverrides.keys()) {
      if (!activeConversationIds.has(conversationId)) {
        state.visitorNameOverrides.delete(conversationId);
        removedVisitorOverride = true;
      }
    }
    if (removedVisitorOverride) saveVisitorNameOverrides();

    state.agents = new Map(
      (result.agents || []).map((agent) => [agent.user_id, agent])
    );
    state.readAt = new Map(
      (result.reads || []).map((row) => [row.conversation_id, row.last_read_at])
    );
    state.lastMessages = new Map();
    state.unreadCounts = new Map();
    state.visitorNames = new Map();

    for (const message of incomingMessages) {
      if (message.sender_type === "visitor") {
        const decodedName = decodeVisitorMessage(message).name;
        if (decodedName && !state.visitorNames.has(message.conversation_id)) {
          state.visitorNames.set(message.conversation_id, decodedName);
        }
      }
      if (!state.lastMessages.has(message.conversation_id)) {
        state.lastMessages.set(message.conversation_id, message);
      }

      if (message.sender_type === "visitor") {
        state.knownVisitorMessageIds.add(message.id);

        const readAt = state.readAt.get(message.conversation_id);
        const unread =
          !readAt ||
          new Date(message.created_at).getTime() > new Date(readAt).getTime();

        if (unread) {
          state.unread.add(message.conversation_id);
          state.unreadCounts.set(
            message.conversation_id,
            (state.unreadCounts.get(message.conversation_id) || 0) + 1
          );
        }
      }
    }

    for (const conversation of state.conversations) {
      if (!state.unreadCounts.get(conversation.id)) {
        state.unread.delete(conversation.id);
      }
    }

    refreshCurrentVisitorIdentity();

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

        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id).push(message);
      }

      for (const [conversationId, messages] of grouped) {
        const conversation = state.conversations.find(
          (item) => item.id === conversationId
        );

        if (
          conversation?.joined_agent_id &&
          conversation.joined_agent_id !== state.user?.id
        ) {
          continue;
        }

        const newest = messages[0];
        const isNewChat = !previousIds.has(conversationId);
        showDesktopChatNotification(
          isNewChat ? "New website chat" : "New support message",
          newest ? visibleMessageBody(newest) : "A visitor sent a message.",
          conversationId
        );
      }
    }

    renderMessageBadge();

    if (
      state.selectedId &&
      !state.conversations.some((item) => item.id === state.selectedId)
    ) {
      state.selectedId = null;
      state.messages = [];
      document.querySelector("#dashboard")?.classList.remove("has-selection");

      if (state.currentView === "messages") {
        renderDashboardChatEmpty();
      } else {
        renderAnalyticsDashboard();
      }
    }

    state.pollFailures = 0;
    state.realtimeStatus = "live";
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) {
      state.pollFailures += 1;
      state.realtimeStatus =
        state.pollFailures >= 3 ? "error" : "connecting";

      if (!silent) {
        showToast(error?.message || "Unable to load support inbox.", "error");
      }
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
    const aDate = new Date(
      state.lastMessages.get(a.id)?.created_at || a.updated_at || a.created_at
    ).getTime() || 0;
    const bDate = new Date(
      state.lastMessages.get(b.id)?.created_at || b.updated_at || b.created_at
    ).getTime() || 0;
    return bDate - aDate;
  });
}

function conversationOwner(conversation) {
  if (!conversation?.joined_agent_id) return null;
  return state.agents.get(conversation.joined_agent_id) || null;
}

function conversationIsMine(conversation) {
  return Boolean(
    conversation?.joined_agent_id &&
    conversation.joined_agent_id === state.user?.id
  );
}

function conversationMatchesSection(conversation) {
  if (conversation.status !== "open") return false;

  if (state.messageSection === "waiting") {
    return !conversation.joined_agent_id;
  }

  if (state.messageSection === "all") {
    return Boolean(conversation.joined_agent_id);
  }

  return conversationIsMine(conversation);
}

function conversationMatchesSearch(conversation) {
  if (!state.search) return true;

  const last = state.lastMessages.get(conversation.id);
  const owner = conversationOwner(conversation);

  return [
    conversation.id,
    conversation.page_path,
    conversation.client_ip,
    conversation.visitor_city,
    conversation.visitor_region,
    conversation.visitor_country,
    visitorName(conversation),
    owner?.display_name,
    last?.body
  ].some((value) =>
    String(value || "").toLowerCase().includes(state.search)
  );
}

function renderAllChatsAvatars() {
  const container = document.querySelector("#all-chats-avatars");
  if (!container) return;
  container.replaceChildren();

  const assignedIds = [
    ...new Set(
      state.conversations
        .filter((conversation) =>
          conversation.status === "open" && conversation.joined_agent_id
        )
        .map((conversation) => conversation.joined_agent_id)
    )
  ].slice(0, 4);

  for (const userId of assignedIds) {
    const agent = state.agents.get(userId);
    const avatar = document.createElement("span");
    avatar.className = "queue-avatar";
    renderAvatarInto(avatar, agent?.avatar_url, agent?.display_name || "W");
    container.appendChild(avatar);
  }

  if (!assignedIds.length) {
    const empty = document.createElement("span");
    empty.className = "queue-avatar is-empty";
    empty.textContent = "0";
    container.appendChild(empty);
  }
}

function renderConversationList() {
  const list = document.querySelector("#conversation-list");
  if (!list) return;

  const current = state.conversations.filter(
    (conversation) =>
      conversation.status === "open" && conversationIsMine(conversation)
  );
  const waiting = state.conversations.filter(
    (conversation) =>
      conversation.status === "open" && !conversation.joined_agent_id
  );
  const assigned = state.conversations.filter(
    (conversation) =>
      conversation.status === "open" && conversation.joined_agent_id
  );

  const openCount = document.querySelector("#open-count");
  const currentCount = document.querySelector("#current-count");
  const waitingCount = document.querySelector("#waiting-count");
  const allCount = document.querySelector("#all-chats-count");

  if (openCount) openCount.textContent = String(current.length + waiting.length);
  if (currentCount) currentCount.textContent = String(current.length);
  if (waitingCount) waitingCount.textContent = String(waiting.length);
  if (allCount) allCount.textContent = String(assigned.length);

  const waitingTab = document.querySelector('[data-message-section="waiting"]');
  waitingTab?.classList.toggle("has-waiting", waiting.length > 0);
  waitingCount?.classList.toggle("has-waiting", waiting.length > 0);

  document.querySelectorAll("[data-message-section]").forEach((item) => {
    item.classList.toggle(
      "is-active",
      item.dataset.messageSection === state.messageSection
    );
  });

  renderAllChatsAvatars();

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

  const matches = sortedConversations()
    .filter(conversationMatchesSection)
    .filter(conversationMatchesSearch);

  list.replaceChildren();

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";

    if (state.search) {
      empty.textContent = "No conversations match your search.";
    } else if (state.messageSection === "waiting") {
      empty.textContent = "No visitors are waiting for a staff member.";
    } else if (state.messageSection === "all") {
      empty.textContent = "No staff are handling chats right now.";
    } else {
      empty.textContent = "You do not have any current chats.";
    }

    list.appendChild(empty);
    return;
  }

  for (const conversation of matches) {
    const last = state.lastMessages.get(conversation.id);
    const owner = conversationOwner(conversation);
    const unreadCount = state.unreadCounts.get(conversation.id) || 0;
    const isUnread = unreadCount > 0;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    button.classList.toggle("is-selected", state.selectedId === conversation.id);
    button.classList.toggle("is-unread", isUnread);
    button.classList.toggle(
      "is-waiting",
      conversation.status === "open" && !conversation.joined_agent_id
    );
    button.classList.toggle(
      "is-other-staff",
      Boolean(conversation.joined_agent_id && !conversationIsMine(conversation))
    );
    button.dataset.conversationId = conversation.id;

    const top = document.createElement("div");
    top.className = "conversation-top";

    const nameWrap = document.createElement("span");
    nameWrap.className = "conversation-name-wrap";

    if (isUnread) {
      const unread = document.createElement("span");
      unread.className = "unread-dot is-inline";
      unread.setAttribute("aria-label", "Unread message");
      nameWrap.appendChild(unread);
    }

    const name = document.createElement("span");
    name.className = "conversation-name";
    name.textContent = visitorName(conversation);
    nameWrap.appendChild(name);

    const time = document.createElement("time");
    time.className = "conversation-time";
    time.dateTime = last?.created_at || conversation.created_at;
    time.textContent = formatTime(last?.created_at || conversation.created_at);

    top.append(nameWrap, time);

    const preview = document.createElement("div");
    preview.className = "conversation-preview";
    preview.textContent = last ? visibleMessageBody(last) : "Conversation started";

    const meta = document.createElement("div");
    meta.className = "conversation-meta";

    const path = document.createElement("span");
    path.className = "conversation-path";
    path.textContent = `Current page: ${simplifiedVisitorPage(conversation)}`;
    meta.appendChild(path);

    if (conversation.joined_agent_id) {
      const ownerPill = document.createElement("span");
      ownerPill.className = "conversation-owner";

      const avatar = document.createElement("span");
      avatar.className = "conversation-owner-avatar";
      renderAvatarInto(
        avatar,
        owner?.avatar_url,
        owner?.display_name || (conversationIsMine(conversation) ? state.agent?.display_name : "W")
      );

      const ownerName = document.createElement("span");
      ownerName.textContent = conversationIsMine(conversation)
        ? "You"
        : owner?.display_name || "Staff";

      ownerPill.append(avatar, ownerName);
      meta.appendChild(ownerPill);
    } else {
      const chip = document.createElement("span");
      chip.className = "status-chip is-waiting";
      chip.textContent = "Waiting";
      meta.appendChild(chip);
    }

    button.append(top, preview, meta);
    button.addEventListener("click", () => selectConversation(conversation.id));
    list.appendChild(button);
  }
}

function currentConversation() {
  return state.conversations.find(
    (conversation) => conversation.id === state.selectedId
  ) || null;
}

async function markConversationJoined(id) {
  const conversation = state.conversations.find((item) => item.id === id);

  if (
    !conversation ||
    conversation.status !== "open" ||
    conversation.joined_agent_id ||
    !state.user
  ) {
    return conversation || null;
  }

  const result = await apiRequest("/join", {
    method: "POST",
    body: { conversationId: id }
  });

  if (result.conversation) {
    upsertConversation(result.conversation);
  }

  if (result.message) {
    appendMessage(result.message);
  }

  return result.conversation || null;
}

async function markConversationRead(id, { force = false } = {}) {
  if (!id || !state.user) return;

  const messages = state.selectedId === id ? state.messages : [];
  const latestVisitor = [...messages]
    .reverse()
    .find((message) => message.sender_type === "visitor");

  const previousRead = state.readAt.get(id);
  if (
    !force &&
    latestVisitor &&
    previousRead &&
    new Date(previousRead).getTime() >=
      new Date(latestVisitor.created_at).getTime()
  ) {
    return;
  }

  try {
    const result = await apiRequest("/read", {
      method: "POST",
      body: { conversationId: id }
    });

    const readAt = result.read?.last_read_at || new Date().toISOString();
    state.readAt.set(id, readAt);
    state.unread.delete(id);
    state.unreadCounts.delete(id);
    renderMessageBadge();
    renderConversationList();
  } catch {
    // Read state should never interrupt the conversation experience.
  }
}

async function selectConversation(id) {
  let conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) return;

  state.currentView = "messages";
  const dashboard = document.querySelector("#dashboard");
  dashboard?.classList.remove("is-dashboard");
  dashboard?.classList.add("is-messages");
  updatePrimaryNavigation();

  if (!conversation.joined_agent_id && conversation.status === "open") {
    try {
      const claimed = await markConversationJoined(id);

      if (claimed) {
        conversation = claimed;
        state.messageSection = "current";
      } else {
        await loadInbox({ silent: true });
        conversation = state.conversations.find((item) => item.id === id);

        if (conversation?.joined_agent_id && !conversationIsMine(conversation)) {
          state.messageSection = "all";
          showToast("Another staff member picked up this chat.");
        }
      }
    } catch (error) {
      await loadInbox({ silent: true });

      conversation = state.conversations.find((item) => item.id === id);
      if (!conversation) {
        showToast("This chat is no longer available.", "error");
        return;
      }

      if (conversation.joined_agent_id && !conversationIsMine(conversation)) {
        state.messageSection = "all";
        showToast("Another staff member picked up this chat.");
      } else {
        showToast(error?.message || "Unable to pick up this chat.", "error");
      }
    }
  }

  state.selectedId = id;
  dashboard?.classList.add("has-selection");
  renderConversationList();
  renderChatShell();
  await loadMessages(id);
  await markConversationRead(id, { force: true });
}

function renderChatShell() {
  const panel = document.querySelector("#chat-panel");
  const conversation = currentConversation();
  if (!panel || !conversation) return;

  const owner = conversationOwner(conversation);
  const mine = conversationIsMine(conversation);
  const assignedToOther = Boolean(
    conversation.joined_agent_id && !mine
  );

  panel.className = "chat-panel";
  panel.innerHTML = `
    <header class="chat-header">
      <div class="chat-person">
        <button id="mobile-back" class="mobile-back" type="button" aria-label="Back to messages">
          ${backIcon()}
        </button>
        <span id="chat-visitor-avatar" class="visitor-avatar">V</span>
        <div class="chat-person-copy">
          <div class="chat-visitor-name-row">
            <strong id="chat-visitor-name"></strong>
            <button id="chat-visitor-name-edit" class="chat-visitor-name-edit" type="button" aria-label="Edit visitor name" title="Edit visitor name">✎</button>
          </div>
          <a id="chat-source-path" class="chat-source-path" target="_blank" rel="noopener noreferrer"></a>
        </div>
      </div>
      <div class="chat-actions">
        <span id="chat-owner-chip" class="chat-owner-chip"></span>
      </div>
    </header>

    ${assignedToOther ? `
      <div class="other-staff-banner">
        <span id="other-staff-avatar" class="conversation-owner-avatar is-large"></span>
        <div>
          <strong id="other-staff-name"></strong>
          <span>You can view this active chat, but only the assigned staff member can reply or close it.</span>
        </div>
      </div>
    ` : ""}

    <div class="visitor-context-bar">
      <div class="visitor-context-main">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"></path>
          <circle cx="12" cy="10" r="2"></circle>
        </svg>
        <div>
          <strong id="visitor-location"></strong>
          <span id="visitor-context-meta"></span>
        </div>
      </div>
      ${mine ? `
        <button id="close-chat-button" class="visitor-close-chat" type="button">
          ${closeIcon()}
          <span>Close chat</span>
        </button>
      ` : ""}
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

    ${mine ? `
      <div id="close-chat-modal" class="confirm-modal" hidden>
        <button
          id="close-chat-modal-backdrop"
          class="confirm-modal-backdrop"
          type="button"
          aria-label="Cancel closing chat"
        ></button>
        <section
          class="confirm-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-chat-confirm-title"
          aria-describedby="close-chat-confirm-copy"
        >
          <div class="confirm-icon">${closeIcon()}</div>
          <h2 id="close-chat-confirm-title">Close this chat?</h2>
          <p id="close-chat-confirm-copy">
            This will end the visitor's support session and permanently delete this conversation from the support database.
          </p>
          <div class="confirm-actions">
            <button id="cancel-close-chat" class="confirm-secondary" type="button">Cancel</button>
            <button id="confirm-close-chat" class="confirm-danger" type="button">Close chat</button>
          </div>
        </section>
      </div>
    ` : ""}
  `;

  const location = visitorLocation(conversation);
  const currentVisitorName = visitorName(conversation);
  const visitorNameElement = document.querySelector("#chat-visitor-name");
  const sourcePathElement = document.querySelector("#chat-source-path");
  const visitorAvatar = document.querySelector("#chat-visitor-avatar");

  if (visitorNameElement) visitorNameElement.textContent = currentVisitorName;
  if (visitorAvatar) visitorAvatar.textContent = initials(currentVisitorName);
  if (sourcePathElement) {
    const simplifiedPage = simplifiedVisitorPage(conversation);
    sourcePathElement.textContent = `Current page: ${simplifiedPage}`;
    sourcePathElement.href = visitorSourceUrl(conversation);
    sourcePathElement.title = `Open ${simplifiedPage}`;
  }
  document.querySelector("#visitor-location").textContent = location;
  document.querySelector("#visitor-context-meta").textContent =
    visitorContextMeta(conversation) || "Temporary support context unavailable";

  const ownerChip = document.querySelector("#chat-owner-chip");
  if (ownerChip) {
    const waiting = !conversation.joined_agent_id;
    ownerChip.textContent = mine
      ? "Your chat"
      : assignedToOther
        ? `${owner?.display_name || "Staff"} is handling`
        : "Waiting";
    ownerChip.classList.toggle("is-waiting", waiting);
  }

  if (assignedToOther) {
    renderAvatarInto(
      document.querySelector("#other-staff-avatar"),
      owner?.avatar_url,
      owner?.display_name || "W"
    );
    const ownerName = document.querySelector("#other-staff-name");
    if (ownerName) {
      ownerName.textContent = `${owner?.display_name || "Another staff member"} is handling this chat`;
    }
  }

  const mapUrl = visitorMapUrl(conversation);
  const mapWrap = document.querySelector("#visitor-map-wrap");
  const map = document.querySelector("#visitor-map");
  const mapCity = document.querySelector("#visitor-map-city");

  if (mapUrl && mapWrap && map) {
    map.src = mapUrl;
    mapWrap.hidden = false;
    if (mapCity) mapCity.textContent = location;
  }

  document.querySelector("#chat-visitor-name-edit")?.addEventListener("click", () => {
    const nameElement = document.querySelector("#chat-visitor-name");
    if (!nameElement) return;

    const original = visitorName(conversation);
    nameElement.setAttribute("contenteditable", "plaintext-only");
    if (nameElement.contentEditable !== "plaintext-only") {
      nameElement.setAttribute("contenteditable", "true");
    }
    nameElement.classList.add("is-editing");
    nameElement.focus();

    const range = document.createRange();
    range.selectNodeContents(nameElement);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const finish = ({ cancel = false } = {}) => {
      if (!nameElement.hasAttribute("contenteditable")) return;

      const next = cancel
        ? original
        : cleanVisitorDisplayName(nameElement.textContent) || "Website visitor";

      if (!cancel) {
        setVisitorNameOverride(
          conversation.id,
          next === "Website visitor" ? "" : next
        );
      }

      nameElement.removeAttribute("contenteditable");
      nameElement.classList.remove("is-editing");
      nameElement.textContent = cancel ? original : visitorName(conversation);

      const avatar = document.querySelector("#chat-visitor-avatar");
      if (avatar) avatar.textContent = initials(visitorName(conversation));

      renderConversationList();
    };

    nameElement.onblur = () => finish();
    nameElement.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        nameElement.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish({ cancel: true });
      }
    };
  });

  document.querySelector("#mobile-back")?.addEventListener("click", () => {
    state.selectedId = null;
    state.messages = [];
    document.body.classList.remove("has-support-confirm-modal");
    document.querySelector("#dashboard")?.classList.remove("has-selection");
    renderConversationList();
    renderDashboardChatEmpty();
  });

  document.querySelector("#close-chat-button")?.addEventListener(
    "click",
    openCloseChatConfirm
  );
  document.querySelector("#close-chat-modal-backdrop")?.addEventListener(
    "click",
    closeCloseChatConfirm
  );
  document.querySelector("#cancel-close-chat")?.addEventListener(
    "click",
    closeCloseChatConfirm
  );
  document.querySelector("#confirm-close-chat")?.addEventListener(
    "click",
    deleteConversation
  );
  document.querySelector("#close-chat-modal")?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeCloseChatConfirm();
    }
  );

  renderComposer();
}

function messageListSignature(messages) {
  return (messages || []).map((message) => [
    message.id || "",
    message.client_message_id || message._clientMessageId || "",
    message.sender_type || "",
    message.body || "",
    message.created_at || "",
    message._sendStatus || "",
    message._sendError || ""
  ].join("\u001f")).join("\u001e");
}

function mergeServerMessages(serverMessages, conversationId) {
  const server = Array.isArray(serverMessages) ? serverMessages : [];
  const serverIds = new Set(server.map((message) => message.id).filter(Boolean));
  const serverClientIds = new Set(
    server
      .map((message) => message.client_message_id)
      .filter(Boolean)
  );

  const locals = state.messages.filter((message) => {
    if (message.conversation_id !== conversationId || !message._local) {
      return false;
    }

    if (message.id && serverIds.has(message.id)) return false;

    const clientId =
      message.client_message_id || message._clientMessageId || null;

    if (clientId && serverClientIds.has(clientId)) return false;

    return ["sending", "failed"].includes(message._sendStatus);
  });

  return [...server, ...locals].sort((a, b) => {
    const left = new Date(a.created_at || 0).getTime() || 0;
    const right = new Date(b.created_at || 0).getTime() || 0;
    return left - right;
  });
}

async function loadMessages(conversationId, { silent = false } = {}) {
  if (!conversationId || state.messagePollBusy) return;
  state.messagePollBusy = true;

  if (!silent) {
    state.loadingMessages = true;
    renderMessages();
  }

  let changed = false;

  try {
    const result = await apiRequest(
      `/messages?conversationId=${encodeURIComponent(conversationId)}`
    );

    if (state.selectedId === conversationId) {
      const merged = mergeServerMessages(
        result.messages || [],
        conversationId
      );

      changed =
        messageListSignature(merged) !==
        messageListSignature(state.messages);

      if (changed) {
        state.messages = merged;

        const last = state.messages[state.messages.length - 1];
        if (last) state.lastMessages.set(conversationId, last);
      }

      if (document.visibilityState === "visible") {
        await markConversationRead(conversationId);
      }
    }
  } catch (error) {
    if (error.status !== 401 && error.status !== 403 && !silent) {
      showToast(error?.message || "Unable to load messages.", "error");
    }
  } finally {
    state.messagePollBusy = false;
    const wasLoading = state.loadingMessages;
    state.loadingMessages = false;

    if (
      state.selectedId === conversationId &&
      (wasLoading || changed)
    ) {
      renderMessages();
    }
  }
}

function renderMessages({ forceBottom = false } = {}) {
  const viewport = document.querySelector("#messages");
  if (!viewport) return;

  const distanceFromBottom =
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  const shouldStickToBottom =
    forceBottom ||
    viewport.scrollHeight <= viewport.clientHeight ||
    distanceFromBottom < 120;

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
    if (message._sendStatus === "sending") {
      row.classList.add("is-sending");
    }
    if (message._sendStatus === "failed") {
      row.classList.add("is-failed");
    }

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
    time.textContent =
      message._sendStatus === "sending"
        ? "Sending…"
        : formatTime(message.created_at);

    meta.append(sender, time);

    const pageLink = decodeSupportPageLink(
      decodeVisitorMessage(message).body
    );

    const body = pageLink
      ? document.createElement("a")
      : document.createElement("p");

    body.className = pageLink
      ? "message-page-link"
      : "message-body";

    if (pageLink) {
      body.href = new URL(
        pageLink.path,
        "https://www.wellcollegeglobal.com"
      ).toString();
      body.target = "_blank";
      body.rel = "noopener noreferrer";
      body.innerHTML = `
        <span>Shared page</span>
        <strong>${escapeEditorAttribute(pageLink.label)}</strong>
        <i aria-hidden="true">↗</i>
      `;
    } else {
      body.textContent = visibleMessageBody(message);
    }

    bubble.append(meta, body);

    if (
      kind === "agent" &&
      message.sender_user_id === state.user?.id &&
      !message._sendStatus
    ) {
      const delivery = document.createElement("div");
      delivery.className = "message-delivery-status";
      delivery.textContent = "Sent >";
      bubble.appendChild(delivery);
    }

    if (message._sendStatus === "failed") {
      const issue =
        message._sendError || "Message failed to send.";

      const failure = document.createElement("button");
      failure.type = "button";
      failure.className = "message-send-failure";
      failure.textContent = "!";
      failure.title = issue;
      failure.dataset.error = issue;
      failure.setAttribute(
        "aria-label",
        `Message failed: ${issue}. Click to retry.`
      );
      failure.addEventListener("click", () => retryStaffMessage(message));
      bubble.appendChild(failure);
    }

    if (kind === "agent") {
      const avatar = document.createElement("span");
      avatar.className = "message-agent-avatar";
      renderAvatarInto(
        avatar,
        message.sender_avatar_url ||
          (message.sender_user_id === state.user?.id
            ? state.agent?.avatar_url
            : null),
        message.sender_display_name ||
          (message.sender_user_id === state.user?.id
            ? state.agent?.display_name
            : "W")
      );
      row.append(bubble, avatar);
    } else {
      row.appendChild(bubble);
    }

    viewport.appendChild(row);
  }

  if (shouldStickToBottom) {
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }
}

function closeSupportPagePicker() {
  state.supportPagePickerSection = "";
  const picker = document.querySelector("#support-page-picker");
  const button = document.querySelector("#support-page-picker-button");
  if (picker) {
    picker.hidden = true;
    picker.replaceChildren();
  }
  button?.setAttribute("aria-expanded", "false");
}

function renderSupportPagePicker(section = "") {
  const picker = document.querySelector("#support-page-picker");
  const button = document.querySelector("#support-page-picker-button");
  if (!picker || !button) return;

  state.supportPagePickerSection = section;
  picker.hidden = false;
  button.setAttribute("aria-expanded", "true");

  if (!section || !SUPPORT_PAGE_CATALOG[section]) {
    picker.innerHTML = `
      <div class="support-page-picker-head">
        <div>
          <strong>Share a page</strong>
          <span>Choose what you want to send</span>
        </div>
        <button type="button" data-page-picker-close aria-label="Close page picker">×</button>
      </div>
      <div class="support-page-picker-groups">
        ${Object.entries(SUPPORT_PAGE_CATALOG).map(([key, group]) => `
          <button type="button" class="support-page-picker-group" data-page-picker-section="${key}">
            <span>
              <strong>${escapeEditorAttribute(group.label)}</strong>
              <small>${escapeEditorAttribute(group.description)}</small>
            </span>
            <i aria-hidden="true">→</i>
          </button>
        `).join("")}
      </div>
    `;
  } else {
    const group = SUPPORT_PAGE_CATALOG[section];
    const groupedItems = group.items.reduce((map, item) => {
      const label = item[0];
      const path = item[1];
      const subgroup = item[2] || "";
      if (!map.has(subgroup)) map.set(subgroup, []);
      map.get(subgroup).push({ label, path });
      return map;
    }, new Map());

    picker.innerHTML = `
      <div class="support-page-picker-head">
        <button type="button" class="support-page-picker-back" data-page-picker-back aria-label="Back">←</button>
        <div>
          <strong>${escapeEditorAttribute(group.label)}</strong>
          <span>Click a page to send it</span>
        </div>
        <button type="button" data-page-picker-close aria-label="Close page picker">×</button>
      </div>
      <div class="support-page-picker-pages">
        ${[...groupedItems.entries()].map(([subgroup, items]) => `
          ${subgroup ? `<div class="support-page-picker-subheading">${escapeEditorAttribute(subgroup)}</div>` : ""}
          ${items.map((item) => `
            <button
              type="button"
              class="support-page-picker-page"
              data-page-label="${escapeEditorAttribute(item.label)}"
              data-page-path="${escapeEditorAttribute(item.path)}"
            >
              <span>${escapeEditorAttribute(item.label)}</span>
              <i aria-hidden="true">↗</i>
            </button>
          `).join("")}
        `).join("")}
      </div>
    `;
  }

  picker.querySelector("[data-page-picker-close]")?.addEventListener(
    "click",
    closeSupportPagePicker
  );

  picker.querySelector("[data-page-picker-back]")?.addEventListener(
    "click",
    () => renderSupportPagePicker("")
  );

  picker.querySelectorAll("[data-page-picker-section]").forEach((item) => {
    item.addEventListener("click", () => {
      renderSupportPagePicker(item.dataset.pagePickerSection || "");
    });
  });

  picker.querySelectorAll("[data-page-path]").forEach((item) => {
    item.addEventListener("click", () => {
      sendSupportPageLink(
        item.dataset.pageLabel || "Website page",
        item.dataset.pagePath || "/"
      );
    });
  });
}

function renderComposer() {
  const slot = document.querySelector("#composer-slot");
  const conversation = currentConversation();
  if (!slot || !conversation) return;

  if (!conversationIsMine(conversation)) {
    const owner = conversationOwner(conversation);
    slot.innerHTML = `
      <div class="readonly-composer">
        <span class="conversation-owner-avatar is-large" id="readonly-owner-avatar"></span>
        <div>
          <strong>${owner?.display_name || "Another staff member"} is handling this conversation</strong>
          <span>Read-only view · messages stay live as the conversation continues.</span>
        </div>
      </div>
    `;

    renderAvatarInto(
      document.querySelector("#readonly-owner-avatar"),
      owner?.avatar_url,
      owner?.display_name || "W"
    );
    return;
  }

  slot.innerHTML = `
    <form id="composer-form" class="composer">
      <div id="support-page-picker" class="support-page-picker" hidden></div>

      <div class="composer-inner">
        <button
          id="support-page-picker-button"
          class="composer-add-button"
          type="button"
          aria-label="Share a website page"
          title="Share a website page"
          aria-expanded="false"
        >+</button>

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
        <span>+ Share a page · Enter to send · Shift + Enter for a new line</span>
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

  document.querySelector("#support-page-picker-button")?.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      const picker = document.querySelector("#support-page-picker");
      if (!picker) return;

      if (!picker.hidden) {
        closeSupportPagePicker();
      } else {
        renderSupportPagePicker("");
      }
    }
  );

  form?.addEventListener("submit", sendReply);
}

function staffSendFailureCopy(error) {
  if (navigator.onLine === false) return "No connection";

  if (error?.name === "AbortError") return "Request timed out";
  if (!error?.status && /fetch|network|failed/i.test(String(error?.message || ""))) {
    return "No connection";
  }

  if (error?.status === 401) return "Session expired";
  if (error?.status === 403) return "You no longer have access to this chat";
  if (error?.status === 409) return "This chat is no longer available";
  if (error?.status === 429) return "Too many requests";
  if (error?.status >= 500) return "Support service unavailable";

  return String(error?.message || "Unable to send message").slice(0, 180);
}

function optimisticStaffMessage(conversation, body, clientMessageId) {
  return {
    id: `local:${clientMessageId}`,
    conversation_id: conversation.id,
    sender_type: "agent",
    sender_user_id: state.user.id,
    sender_display_name:
      state.agent?.display_name || "Well College Global Support",
    sender_avatar_url: state.agent?.avatar_url || null,
    client_message_id: clientMessageId,
    body,
    created_at: new Date().toISOString(),
    _clientMessageId: clientMessageId,
    _local: true,
    _sendStatus: "sending",
    _sendError: ""
  };
}

function replaceOptimisticStaffMessage(clientMessageId, serverMessage) {
  const index = state.messages.findIndex((message) =>
    (
      message.client_message_id ||
      message._clientMessageId
    ) === clientMessageId
  );

  if (index >= 0) {
    state.messages[index] = serverMessage;
  } else if (
    serverMessage?.id &&
    !state.messages.some((message) => message.id === serverMessage.id)
  ) {
    state.messages.push(serverMessage);
  }

  if (serverMessage) {
    state.lastMessages.set(serverMessage.conversation_id, serverMessage);
  }

  renderMessages({ forceBottom: true });
  renderConversationList();
}

function markOptimisticStaffMessageFailed(clientMessageId, error) {
  const message = state.messages.find((item) =>
    (
      item.client_message_id ||
      item._clientMessageId
    ) === clientMessageId
  );

  if (!message) return;

  message._local = true;
  message._sendStatus = "failed";
  message._sendError = staffSendFailureCopy(error);

  renderMessages({ forceBottom: true });
}

async function deliverStaffMessage(message) {
  const clientMessageId =
    message.client_message_id || message._clientMessageId;

  try {
    const result = await apiRequest("/send", {
      method: "POST",
      body: {
        conversationId: message.conversation_id,
        clientMessageId,
        body: message.body
      }
    });

    if (result.message) {
      replaceOptimisticStaffMessage(
        clientMessageId,
        result.message
      );
    }
  } catch (error) {
    markOptimisticStaffMessageFailed(clientMessageId, error);
  }
}

function retryStaffMessage(message) {
  const conversation = currentConversation();
  if (
    !message ||
    message._sendStatus !== "failed" ||
    !conversation ||
    conversation.id !== message.conversation_id ||
    !conversationIsMine(conversation)
  ) {
    return;
  }

  message._sendStatus = "sending";
  message._sendError = "";
  renderMessages({ forceBottom: true });
  deliverStaffMessage(message);
}

function sendSupportPageLink(label, path) {
  const conversation = currentConversation();

  if (
    !conversation ||
    conversation.status !== "open" ||
    !state.user ||
    !conversationIsMine(conversation)
  ) {
    return;
  }

  const body = encodeSupportPageLink(label, path);
  const clientMessageId = crypto.randomUUID();
  const optimistic = optimisticStaffMessage(
    conversation,
    body,
    clientMessageId
  );

  state.messages.push(optimistic);
  state.lastMessages.set(conversation.id, optimistic);
  closeSupportPagePicker();

  renderMessages({ forceBottom: true });
  renderConversationList();
  deliverStaffMessage(optimistic);
}

function sendReply(event) {
  event.preventDefault();

  const input = document.querySelector("#message-input");
  const button = document.querySelector("#send-button");
  const body = String(input?.value || "").trim();
  const conversation = currentConversation();

  if (
    !body ||
    !conversation ||
    conversation.status !== "open" ||
    !state.user ||
    !conversationIsMine(conversation)
  ) return;

  if (body.length > MAX_MESSAGE_LENGTH) return;

  const clientMessageId = crypto.randomUUID();
  const optimistic = optimisticStaffMessage(
    conversation,
    body,
    clientMessageId
  );

  state.messages.push(optimistic);
  state.lastMessages.set(conversation.id, optimistic);

  if (input) {
    input.value = "";
    input.style.height = "auto";
  }

  if (button) button.disabled = true;

  renderMessages({ forceBottom: true });
  renderConversationList();
  input?.focus();

  deliverStaffMessage(optimistic);
}

function appendMessage(message) {
  if (!message?.id) return;

  if (message.sender_type === "visitor") {
    const decodedName = decodeVisitorMessage(message).name;
    if (decodedName) state.visitorNames.set(message.conversation_id, decodedName);
  }

  const clientMessageId = message.client_message_id || null;

  if (clientMessageId) {
    const optimisticIndex = state.messages.findIndex((item) =>
      (
        item.client_message_id ||
        item._clientMessageId
      ) === clientMessageId
    );

    if (optimisticIndex >= 0) {
      state.messages[optimisticIndex] = message;
      state.lastMessages.set(message.conversation_id, message);
      renderMessages({ forceBottom: true });
      renderConversationList();
      return;
    }
  }

  state.lastMessages.set(message.conversation_id, message);

  if (state.selectedId === message.conversation_id) {
    if (!state.messages.some((item) => item.id === message.id)) {
      state.messages.push(message);
      renderMessages({ forceBottom: true });
    }
    state.unread.delete(message.conversation_id);
  } else if (message.sender_type === "visitor") {
    state.unread.add(message.conversation_id);
  }

  renderConversationList();
  refreshCurrentVisitorIdentity();
}

function openCloseChatConfirm() {
  const conversation = currentConversation();
  if (!conversation || !conversationIsMine(conversation)) return;

  const modal = document.querySelector("#close-chat-modal");
  const confirmButton = document.querySelector("#confirm-close-chat");
  if (!modal) return;

  modal.hidden = false;
  document.body.classList.add("has-support-confirm-modal");
  requestAnimationFrame(() => confirmButton?.focus());
}

function closeCloseChatConfirm() {
  const modal = document.querySelector("#close-chat-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("has-support-confirm-modal");
  document.querySelector("#close-chat-button")?.focus();
}
async function deleteConversation() {
  const conversation = currentConversation();
  if (!conversation) return;

  const button = document.querySelector("#confirm-close-chat");
  if (button) {
    button.disabled = true;
    button.textContent = "Closing…";
  }

  try {
    await apiRequest("/close", {
      method: "POST",
      body: { conversationId: conversation.id }
    });

    state.conversations = state.conversations.filter((item) => item.id !== conversation.id);
    state.lastMessages.delete(conversation.id);
    state.visitorNames.delete(conversation.id);
    clearVisitorNameOverride(conversation.id);
    state.unread.delete(conversation.id);
    state.unreadCounts.delete(conversation.id);
    state.readAt.delete(conversation.id);
    state.selectedId = null;
    state.messages = [];

    document.body.classList.remove("has-support-confirm-modal");
    document.querySelector("#dashboard")?.classList.remove("has-selection");
    renderConversationList();
    renderDashboardChatEmpty();
    showToast("Chat closed and deleted.");
  } catch (error) {
    showToast(error?.message || "Unable to close this chat.", "error");

    const currentButton = document.querySelector("#confirm-close-chat");
    if (currentButton) {
      currentButton.disabled = false;
      currentButton.textContent = "Close chat";
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
  state.pollFailures = 0;
  state.realtimeStatus = "connecting";
  renderRealtimeStatus();

  const pollInbox = async () => {
    if (!state.user) return;

    await loadInbox({ silent: true });

    if (state.selectedId) {
      await loadMessages(state.selectedId, { silent: true });
    }

    const backoff = Math.min(
      1600 * Math.pow(1.7, Math.max(0, state.pollFailures)),
      8000
    );
    const delay =
      document.visibilityState === "hidden"
        ? Math.max(Math.round(backoff), 5000)
        : Math.round(backoff);

    state.pollTimer = window.setTimeout(pollInbox, delay);
  };

  const handleVisibility = () => {
    if (!state.user || document.visibilityState !== "visible") return;
    if (state.pollTimer) window.clearTimeout(state.pollTimer);
    state.pollTimer = window.setTimeout(pollInbox, 120);
  };

  document.addEventListener("visibilitychange", handleVisibility);
  state.dashboardVisibilityHandler = handleVisibility;
  state.pollTimer = window.setTimeout(pollInbox, 500);

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
  if (state.dashboardVisibilityHandler) {
    document.removeEventListener(
      "visibilitychange",
      state.dashboardVisibilityHandler
    );
  }
  state.dashboardVisibilityHandler = null;
  state.pollTimer = null;
  state.messagePollTimer = null;
  state.analyticsTimer = null;
  state.pollBusy = false;
  state.messagePollBusy = false;
  state.pollFailures = 0;
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
  state.agents = new Map();
  state.readAt = new Map();
  state.messageSection = "current";
  state.knownVisitorMessageIds = new Set();
  state.notificationsReady = false;
  state.analytics = null;
  state.editorStatus = null;
  state.editorMode = "beta";
  state.editorPage = "/";
  state.editorDirty = false;
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
