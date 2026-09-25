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
  joinPromises: new Map(),
  currentView: dashboardViewFromPath(),
  analytics: null,
  analyticsDays: 30,
  analyticsLoading: false,
  analyticsTimer: null,
  analyticsCache: new Map(),
  analyticsRequestId: 0,
  analyticsError: "",
  analyticsTabs: {},
  analyticsExpanded: new Set(),
  analyticsTrendObserver: null,
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
  editorStyleDrafts: {},
  editorOrderDrafts: {},
  editorElementDrafts: [],
  editorTool: "select",
  editorStatusRenderKey: "",
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
  editorPreviewResizeObserver: null,
  editorPreviewResizeHandler: null,
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
  editorNavigationTarget: "",
  editorNavigationHeaderOrder: [],
  editorNavigationGroupOrder: [],
  editorNavigationDirty: false,
  editorNavigationLoading: false,
  editorNavigationDrag: null,
  editorLayoutTarget: "",
  editorLayoutOrders: {},
  editorLayoutDirty: false,
  editorLayoutLoading: false,
  editorAssetsOpen: false,
  editorAssets: [],
  editorAssetsLoaded: false,
  editorAssetsLoading: false,
  editorAssetDrafts: [],
  editorAssetUploadBusy: false,
  editorAssetUploadTargetSelector: "",
  editorPreviewMode: "visual",
  editorCodeSource: null,
  editorCodeSourceKey: "",
  editorCodeLoading: false,
  editorCodeDraft: "",
  editorCodeOriginal: "",
  editorCodeDirty: false,
  editorCodeSaving: false,
  editorCodePreviewTimer: null,
  editorSourcePreviewPosted: false,
  editorFrameReloadRequested: false,
  editorHistoryOpen: false,
  editorVersionHistory: [],
  editorAuditHistory: [],
  editorHistoryLoading: false,
  editorSharedDraftLoadedSha: "",
  editorSharedDraftRevision: 0,
  editorSharedDraftAvailable: null,
  editorSharedDraftConflict: false,
  editorSharedDraftTimer: null,
  editorSharedDraftSaving: false,
  editorAutosaveEnabled: localStorage.getItem("well-editor-autosave") === "1",
  editorAutosaveConfirmed: localStorage.getItem("well-editor-autosave-confirmed") === "1",
  editorSessionSaving: false,
  editorSessionSavedAt: "",
  editorSessionSavedSignature: "",
  editorInspectorTab: sessionStorage.getItem("well-editor-inspector-tab") || "inspector",
  editorPageSearch: "",
  editorSourceDrafts: {},
  editorCodeKind: "html",
  editorCodeCssPath: "",
  editorRemoteDraftTimer: null,
  editorDevtoolsTab: "elements",
  editorDevtoolsData: null,
  editorDockRatio: (() => {
    const value = Number(sessionStorage.getItem("well-editor-dock-ratio") || 0.58);
    return Number.isFinite(value) ? Math.min(0.72, Math.max(0.28, value)) : 0.58;
  })(),
  supportPagePickerSection: ""
};

function configured() {
  return true;
}

function staffCan(permission) {
  return Boolean(
    Array.isArray(state.agent?.permissions) &&
    state.agent.permissions.includes(String(permission || ""))
  );
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
    if (
      response.status === 401 ||
      (response.status === 403 && payload?.code !== "insufficient_role")
    ) {
      cleanupRealtime();
      state.agent = null;
      state.user = null;
      state.conversations = [];
      state.messages = [];
      state.selectedId = null;
      renderAccessError(response.status === 403 ? payload?.error || "Access denied." : "");
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
    const label = decodeURIComponent(payload.slice(0, separator))
      .trim()
      .slice(0, 140);
    const path = decodeURIComponent(payload.slice(separator + 1))
      .trim()
      .slice(0, 500);

    if (!label || !path.startsWith("/") || path.startsWith("//")) {
      return null;
    }

    if (/[ -<>\\]/.test(path)) {
      return null;
    }

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

function renderAccessError(message = "Your Cloudflare Access session could not be verified.") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card" aria-labelledby="staff-access-title">
        <div class="auth-brand">
          <img class="auth-logo" src="/well-college-logo.png" alt="Well College Global" />
        </div>
        <h1 id="staff-access-title">Staff access</h1>
        <p>Well Support is protected by Cloudflare Access. There is no separate dashboard password.</p>
        <div class="auth-error" role="status">${message}</div>
        <div class="auth-form">
          <button id="access-retry" class="auth-submit" type="button">Try again</button>
          <button id="access-logout" class="auth-submit auth-submit-secondary" type="button">Sign out of Cloudflare Access</button>
        </div>
      </section>
    </main>
  `;

  document.querySelector("#access-retry")?.addEventListener("click", () => {
    window.location.reload();
  });

  document.querySelector("#access-logout")?.addEventListener("click", () => {
    window.location.assign("/cdn-cgi/access/logout");
  });
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

function devtoolsIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3"></path><path d="m16 9 4 3-4 3"></path><path d="m14 5-4 14"></path></svg>`;
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
  const allowedViews = ["dashboard", "visitors", "messages"];
  if (staffCan("editor")) allowedViews.push("editor");
  const resolvedView = allowedViews.includes(view) ? view : "dashboard";

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
    const cached = state.analyticsCache.get(state.analyticsDays);
    if (!state.analytics) {
      if (!state.analyticsLoading) loadAnalytics();
    } else if (!cached || Date.now() - cached.fetchedAt > ANALYTICS_REFRESH_MS) {
      loadAnalytics({ silent: true });
    }
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
  const previousRenderKey = state.editorStatusRenderKey;

  try {
    const result = await apiRequest("/editor-status");
    state.editorStatus = result.status || null;
  } catch (error) {
    state.editorStatus = {
      connected: false,
      error: error?.message || "Unable to load website publishing status."
    };
    if (!quiet) showToast(state.editorStatus.error, "error");
  } finally {
    state.editorLoading = false;
    const comparison = state.editorStatus?.comparison || {};
    state.editorStatusRenderKey = [
      state.editorStatus?.connected === true ? "1" : "0",
      state.editorStatus?.main?.sha || "",
      state.editorStatus?.beta?.sha || "",
      Number(comparison.aheadBy || 0),
      Number(comparison.behindBy || 0),
      state.editorStatus?.beta?.previewGate?.state || "",
      state.editorStatus?.beta?.previewGate?.conclusion || ""
    ].join(":");

    if (state.currentView === "editor") {
      const hasFrame = Boolean(document.querySelector("#web-editor-frame"));

      if (!hasFrame || !previousRenderKey) {
        // Initial hydration may build the editor once. After that, status
        // polling must not replace the iframe or reset scroll/selection.
        renderWebEditor();
      } else if (previousRenderKey !== state.editorStatusRenderKey) {
        postCurrentEditorDraftToPreview();
      }
    }
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

function cloneEditorStyleDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([selector, styles]) => [
      selector,
      styles && typeof styles === "object" && !Array.isArray(styles)
        ? { ...styles }
        : {}
    ])
  );
}


function cloneEditorOrderDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([parent, children]) => [
      parent,
      Array.isArray(children) ? [...children] : []
    ])
  );
}


function cloneEditorElementDrafts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && item.type === "text")
    .slice(0, 40)
    .map((item) => ({ ...item }));
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
    attributes: cloneEditorAttributeDrafts(config.attributes),
    styles: cloneEditorStyleDrafts(config.styles),
    order: cloneEditorOrderDrafts(config.order),
    elements: cloneEditorElementDrafts(config.elements)
  };
}

function currentEditorDraftSnapshot() {
  return {
    heading: state.editorHeadingDraft || "",
    copy: state.editorCopyDraft || "",
    accent: state.editorAccentDraft || "",
    font: state.editorFontDraft || "",
    text: { ...state.editorTextDrafts },
    attributes: cloneEditorAttributeDrafts(state.editorAttributeDrafts),
    styles: cloneEditorStyleDrafts(state.editorStyleDrafts),
    order: cloneEditorOrderDrafts(state.editorOrderDrafts),
    elements: cloneEditorElementDrafts(state.editorElementDrafts)
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
  state.editorStyleDrafts = draft.styles;
  state.editorOrderDrafts = draft.order;
  state.editorElementDrafts = draft.elements;
}

function storeCurrentEditorDraft() {
  if (state.editorMode !== "beta") return;

  state.editorPendingPages = {
    ...state.editorPendingPages,
    [state.editorPage]: currentEditorDraftSnapshot()
  };
  state.editorDirty = Object.keys(state.editorPendingPages).length > 0;
  scheduleSharedEditorDraft();
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
  let count = Object.keys(state.editorPendingPages || {}).length;
  if (state.editorNavigationDirty) count += 1;
  if (state.editorLayoutDirty) count += 1;
  if (state.editorBannerDirty) count += 1;
  count += state.editorAssetDrafts.length;
  return count;
}

const EDITOR_LINK_DESTINATIONS = [
  ["index.html", "Home"],
  ["qualifications.html", "Qualifications"],
  ["short-courses.html", "Short Courses"],
  ["enrol.html", "Enrol & Pay"],
  ["enrol.html#enrol-free-courses", "Enrol & Pay · Free courses section"],
  ["free-courses.html", "Free Courses & Samplers"],
  ["pathways-to-health-coaching.html", "Pathways to Health Coaching · Free live session"],
  ["free-coaching-webinar-series.html", "Free Coaching Webinar Series"],
  ["about.html", "About Well College Global"],
  ["testimonials.html", "Graduate Stories"],
  ["faqs.html", "Frequently Asked Questions"],
  ["contact.html", "Contact"],
  ["questionnaire.html", "Could Health Coaching Fit You?"],
  ["apply.html", "Request Course Details"],
  ["session-bookings.html", "Book a Free Clarity Session"],
  ["well-collective-blog.html", "Well Collective Blog"],
  ["find-a-coach.html", "Find a Health Coach"],
  ["study-pathways.html", "Study Pathways"],
  ["accreditation-registration--insurance-options.html", "Accreditation, Registration & Insurance"],
  ["health-coaching-electives.html", "Health Coaching Electives"],
  ["nutrition-and-health.html", "Nutrition & Health Courses"],
  ["holistic-health-courses.html", "Holistic Health Courses"],
  ["psychology-and-coaching-courses.html", "Psychology & Coaching Courses"],
  ["business-courses.html", "Business Courses for Coaches"],
  ["diploma-in-nutrition-and-health-coaching.html", "Diploma in Nutrition & Health Coaching"],
  ["womens-health-and-wellness-coach-certification.html", "Women’s Health & Wellness Coach Certification"],
  ["icf-certified-coaching-professional-program.html", "ICF Certified Coaching Professional Program"],
  ["diploma-lifestyle-coaching.html", "Diploma in Coaching for Lifestyle & Wellbeing"],
  ["holisticwellnesspractitioner.html", "Bio Optimise Holistic Wellness Practitioner"],
  ["the-ultimate-triple-qualification.html", "The Ultimate Triple Qualification"],
  ["wellness-coaching-for-professionals.html", "Wellness Coaching for Professionals"],
  ["professional-certificate-in-meal-planning.html", "Professional Certificate in Meal Planning"],
  ["coach-gap-training.html", "Coach Gap Training"],
  ["elcas-approved-provider.html", "ELCAS Approved Courses"],
  ["vedicwellnessstudies.html", "Vedic Wellness Studies"],
  ["human-nutrition.html", "Human Nutrition"],
  ["biomarkers.html", "Biomarker & Functional Tests"],
  ["ayurvedic-lifestyle.html", "Ayurvedic Lifestyle"],
  ["sports-nutrition-for-optimal-performance.html", "Sports Nutrition for Optimal Performance"],
  ["pregnancynutrition.html", "Nutrition for Conception, Pregnancy & Lactation"],
  ["early-childhood-nutrition.html", "Early Childhood Nutrition"],
  ["gut--microbiome-online-course.html", "Gut & Microbiome"],
  ["botanical-healing.html", "Botanical Healing"],
  ["meal-planning-for-healthy-living.html", "Meal Planning for Healthy Living"],
  ["non-diet-approach.html", "Non-Diet Approach"],
  ["nutrition-psychology.html", "Nutrition Psychology"],
  ["super-nutrition.html", "Super Nutrition"],
  ["womens-health-and-hormones.html", "Women’s Health & Hormones"],
  ["weight-management-nutrition.html", "Weight Management Nutrition"],
  ["integrative-wellness-techniques.html", "Integrative Wellness Techniques"],
  ["coaching-clients-holistically.html", "Coaching Clients Holistically"],
  ["holistic_wellness_intro.html", "Introduction to Holistic Wellness"],
  ["mental-health--trauma-awareness.html", "Mental Health & Trauma Awareness"],
  ["wellbeing-management-and-coaching-practices.html", "Wellbeing Management & Coaching Practices"],
  ["cultivating-confidence.html", "Cultivating Confidence"],
  ["psychology-and-wellbeing-foundations.html", "Psychology & Wellbeing Foundations"],
  ["coaching-supervision-and-mentoring.html", "Coach Supervision & Mentoring"],
  ["coaching-practicum.html", "Coaching Practicum"],
  ["motivational-techniques.html", "Motivational Techniques"],
  ["creating-healthy-lifestyle-courses-and-programs.html", "Creating Healthy Lifestyle Courses & Programs"],
  ["grow-your-coaching-business.html", "Grow Your Coaching Business"],
  ["professional-practice-and-business-ready-workshops.html", "Professional Practice & Business Ready Workshops"],
  ["continuing-ed-courses.html", "Continuing Education Courses"],
  ["construction-wellbeing.html", "Construction Wellbeing"],
  ["feel-look-live-well.html", "Feel Well. Look Well. Live Well."],
  ["terms-and-conditions.html", "Terms, Privacy & Enrolment Conditions"]
];

function normaliseEditorLinkDestination(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(?:https?:|mailto:|tel:|#)/i.test(raw)) return raw;
  if (raw === "/") return "index.html";
  return raw.replace(/^\/+/, "");
}

function editorLinkDestinationOptions(currentValue) {
  const current = normaliseEditorLinkDestination(currentValue);
  const known = new Set(EDITOR_LINK_DESTINATIONS.map(([href]) => href));
  const options = [
    '<option value="">Choose a page…</option>'
  ];

  if (current && !known.has(current)) {
    options.push(
      `<option value="${escapeEditorAttribute(current)}" selected>Current custom link · ${escapeEditorAttribute(current)}</option>`
    );
  }

  for (const [href, label] of EDITOR_LINK_DESTINATIONS) {
    options.push(
      `<option value="${escapeEditorAttribute(href)}" ${current === href ? "selected" : ""}>${escapeEditorAttribute(label)}</option>`
    );
  }

  return options.join("");
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

function publishEditorBanner() {
  state.editorBannerDirty = true;
  state.editorDirty = editorPendingChangeCount() > 0;
  showToast("Banner changes are staged locally. Publish beta preview to build them.");
}

async function deleteEditorBannerItem(index) {
  if (!Number.isInteger(index) || !state.editorBannerItems[index]) return;

  state.editorBannerItems = state.editorBannerItems.filter(
    (_, itemIndex) => itemIndex !== index
  );
  state.editorBannerDirty = true;
  state.editorDirty = editorPendingChangeCount() > 0;
  state.editorBannerPendingDeleteIndex = null;
  document.body.classList.remove("has-support-confirm-modal");

  renderWebEditor();
  showToast("Banner removed from the live draft. Publish beta preview to build it.");
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
    return true;
  } catch (error) {
    showToast(error?.message || "Unable to update the preview website.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Update preview from live site";
    }
    return false;
  }
}

async function publishWebEditorDraft(payload) {
  const button = document.querySelector("#web-editor-preview-submit");
  if (button) {
    button.disabled = true;
    button.textContent = "Building beta preview…";
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

    state.editorPendingPages = {};
    state.editorHistory = [];
    state.editorFuture = [];
    state.editorNavigationDirty = false;
    state.editorLayoutDirty = false;
    state.editorBannerDirty = false;
    state.editorAssetDrafts = [];
    state.editorAssetsLoaded = false;
    state.editorDirty = false;
    state.editorDraftKey = "";
    await clearSharedEditorDraft();
    showToast("Beta preview published. One GitHub commit/build was created from the staged draft.");
    await loadWebEditorStatus({ quiet: true });
    state.editorNavigationTarget = "";
    state.editorLayoutTarget = "";
    await Promise.all([
      loadEditorNavigation({ quiet: true }),
      loadEditorLayout({ quiet: true }),
      loadEditorAssets({ quiet: true })
    ]);
    if (state.currentView === "editor") renderWebEditor();
  } catch (error) {
    showToast(error?.message || "Unable to publish these changes to the preview site.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Publish beta preview";
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
      body: {
        confirm: "PROMOTE_BETA_TO_MAIN",
        reviewedBetaSha: state.editorStatus?.beta?.sha || ""
      }
    });

    state.editorStatus = result.status || state.editorStatus;
    state.editorDirty = false;
    document.body.classList.remove("has-support-confirm-modal");
    showToast("Preview approved. The live website deployment is starting.");
    renderWebEditor();
  } catch (error) {
    showToast(error?.message || "Unable to publish the preview website.", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "Publish preview to live site";
    }
  }
}

const EDITOR_HEADER_NAV_LABELS = {
  qualifications: "Qualifications",
  "short-courses": "Short Courses",
  about: "About us",
  testimonials: "Testimonials",
  more: "More"
};

const EDITOR_SHORT_COURSE_GROUPS = [
  "Nutrition & health",
  "Holistic health",
  "Psychology & coaching",
  "Business"
];

function sameStringSet(value, allowed) {
  if (!Array.isArray(value) || value.length !== allowed.length) return false;
  const clean = value.map((item) => String(item || ""));
  const unique = new Set(clean);
  return unique.size === allowed.length &&
    allowed.every((item) => unique.has(item));
}


async function loadEditorLayout({ quiet = false } = {}) {
  if (state.editorLayoutLoading || !state.editorStatus?.connected) return;

  const target = state.editorMode === "production" ? "production" : "beta";
  state.editorLayoutLoading = true;

  try {
    const result = await apiRequest(
      `/editor-layout?target=${encodeURIComponent(target)}`
    );
    state.editorLayoutTarget = target;
    state.editorLayoutOrders =
      result.layoutOrders && typeof result.layoutOrders === "object"
        ? Object.fromEntries(
            Object.entries(result.layoutOrders).map(([scope, order]) => [
              scope,
              Array.isArray(order) ? [...order] : []
            ])
          )
        : {};
    state.editorLayoutDirty = false;
  } catch (error) {
    if (!quiet) showToast(error?.message || "Unable to load website layout source.", "error");
  } finally {
    state.editorLayoutLoading = false;
  }
}

async function loadEditorAssets({ quiet = false } = {}) {
  if (state.editorAssetsLoading || !state.editorStatus?.connected) return;

  state.editorAssetsLoading = true;
  try {
    const target = state.editorMode === "production" ? "production" : "beta";
    const result = await apiRequest(
      `/editor-assets?target=${encodeURIComponent(target)}`
    );
    state.editorAssets = Array.isArray(result.assets) ? result.assets : [];
    state.editorAssetsLoaded = true;
  } catch (error) {
    if (!quiet) showToast(error?.message || "Unable to load website assets.", "error");
  } finally {
    state.editorAssetsLoading = false;
    if (state.currentView === "editor") postEditorAssetsToPreview();
  }
}

function editorAssetPublicUrl(path) {
  return new URL(
    String(path || "").replace(/^\/+/, ""),
    "https://www.wellcollegeglobal.com/"
  ).toString();
}

function editorAssetPreviewMap() {
  return Object.fromEntries(
    state.editorAssetDrafts.flatMap((asset) => [
      [asset.publicUrl, asset.previewUrl],
      [`/${asset.path}`, asset.previewUrl]
    ])
  );
}

function editorImageAssetOptions() {
  const draftOptions = state.editorAssetDrafts
    .filter((asset) => asset.kind === "image")
    .map((asset) => ({
      path: asset.path,
      value: `/${asset.path}`,
      preview: asset.previewUrl,
      previews: [asset.previewUrl].filter(Boolean),
      name: asset.name || asset.path.split("/").pop() || "Image",
      draft: true
    }));

  const existingOptions = state.editorAssets
    .filter((asset) => asset.kind === "image")
    .map((asset) => {
      const previews = [...new Set(
        [
          ...(Array.isArray(asset.previewUrls) ? asset.previewUrls : []),
          asset.url,
          editorAssetPublicUrl(asset.path)
        ].filter(Boolean)
      )];

      return {
        path: asset.path,
        value: `/${asset.path}`,
        preview: previews[0] || "",
        previews,
        name: asset.name || asset.path.split("/").pop() || "Image",
        draft: false
      };
    });

  const seen = new Set();
  return [...draftOptions, ...existingOptions].filter((asset) => {
    if (!asset.path || seen.has(asset.path)) return false;
    seen.add(asset.path);
    return true;
  });
}

function currentEditorPreviewPayload() {
  const comparison = state.editorStatus?.comparison || {};
  const editable =
    state.editorMode === "beta" &&
    state.editorStatus?.connected === true &&
    Number(comparison.behindBy || 0) <= 0;

  return {
    heading: state.editorHeadingDraft || "",
    copy: state.editorCopyDraft || "",
    accent: state.editorAccentDraft || "",
    font: state.editorFontDraft || "",
    text: { ...state.editorTextDrafts },
    attributes: cloneEditorAttributeDrafts(state.editorAttributeDrafts),
    styles: cloneEditorStyleDrafts(state.editorStyleDrafts),
    order: cloneEditorOrderDrafts(state.editorOrderDrafts),
    elements: cloneEditorElementDrafts(state.editorElementDrafts),
    linkDestinations: EDITOR_LINK_DESTINATIONS.map(([href, label]) => ({ href, label })),
    headerOrder: [...state.editorNavigationHeaderOrder],
    shortCourseGroupOrder: [...state.editorNavigationGroupOrder],
    layoutOrders: Object.fromEntries(
      Object.entries(state.editorLayoutOrders || {}).map(([scope, order]) => [
        scope,
        Array.isArray(order) ? [...order] : []
      ])
    ),
    banner: {
      intervalMs: Number(state.editorBannerInterval || 5200),
      items: state.editorBannerItems.map((item) => ({ ...item }))
    },
    assetPreviewMap: editorAssetPreviewMap(),
    assetOptions: editorImageAssetOptions(),
    editable
  };
}

function postCurrentEditorDraftToPreview() {
  const frame = document.querySelector("#web-editor-frame");
  if (!frame?.contentWindow) return false;

  frame.contentWindow.postMessage(
    {
      type: "WCG_EDITOR_PREVIEW",
      payload: currentEditorPreviewPayload()
    },
    "https://wellwebsite.pages.dev"
  );
  return true;
}

function postEditorAssetsToPreview() {
  const frame = document.querySelector("#web-editor-frame");
  frame?.contentWindow?.postMessage(
    {
      type: "WCG_EDITOR_ASSETS",
      assetOptions: editorImageAssetOptions(),
      assetPreviewMap: editorAssetPreviewMap()
    },
    "https://wellwebsite.pages.dev"
  );

  const count = document.querySelector("#editor-assets-toggle small");
  if (count) {
    count.textContent =
      `${state.editorAssetDrafts.length ? `${state.editorAssetDrafts.length} staged · ` : ""}${state.editorAssets.length} existing`;
  }
}

function editorAssetKind(path = "") {
  const value = String(path).toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/.test(value)) return "image";
  if (/\.(mp4|webm|mov)$/.test(value)) return "video";
  if (/\.pdf$/.test(value)) return "pdf";
  return "file";
}

function cleanEditorAssetName(name) {
  const source = String(name || "asset").normalize("NFKD");
  const dot = source.lastIndexOf(".");
  const extension = dot > 0
    ? source.slice(dot + 1).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 10)
    : "";
  const base = (dot > 0 ? source.slice(0, dot) : source)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "asset";
  return { base, extension };
}

async function stageEditorAssetFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;

  let runningBytes = state.editorAssetDrafts.reduce(
    (total, item) => total + Number(item.size || 0),
    0
  );
  const staged = [];
  state.editorAssetUploadBusy = true;

  try {
    for (const [index, file] of files.entries()) {
      if (!(file instanceof File)) continue;

      const safeType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
      const safeExtension = /\.(?:jpe?g|png|webp)$/i.test(file.name || "");
      if (!safeType || !safeExtension) {
        showToast(`${file.name} must be a JPG, PNG, or WebP image.`, "error");
        continue;
      }

      if (file.size > 6 * 1024 * 1024) {
        showToast(`${file.name} is larger than the 6 MB asset limit.`, "error");
        continue;
      }
      if (runningBytes + file.size > 20 * 1024 * 1024) {
        showToast("Draft assets are limited to 20 MB per publish.", "error");
        break;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error("Unable to read asset."));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
      });

      const comma = dataUrl.indexOf(",");
      if (comma < 0) continue;

      const { base, extension } = cleanEditorAssetName(file.name);
      const suffix = `${Date.now().toString(36)}-${index + 1}`;
      const path = `assets/uploads/${suffix}-${base}${extension ? `.${extension}` : ""}`;

      staged.push({
        path,
        name: file.name,
        type: file.type || "",
        size: file.size,
        contentBase64: dataUrl.slice(comma + 1),
        previewUrl: dataUrl,
        publicUrl: editorAssetPublicUrl(path),
        kind: editorAssetKind(path)
      });
      runningBytes += file.size;
    }

    if (staged.length) {
      state.editorAssetDrafts = [...state.editorAssetDrafts, ...staged];
      state.editorDirty = editorPendingChangeCount() > 0;
      showToast(
        `${staged.length} asset${staged.length === 1 ? "" : "s"} staged locally. Publish beta preview to upload.`
      );
      postEditorAssetsToPreview();
    }
  } catch (error) {
    showToast(error?.message || "Unable to stage that asset.", "error");
  } finally {
    state.editorAssetUploadBusy = false;
  }
}

async function loadEditorNavigation({ quiet = false } = {}) {
  if (state.editorNavigationLoading || !state.editorStatus?.connected) return;

  const target = state.editorMode === "production" ? "production" : "beta";
  state.editorNavigationLoading = true;

  try {
    const result = await apiRequest(
      `/editor-navigation?target=${encodeURIComponent(target)}`
    );

    state.editorNavigationTarget = target;
    state.editorNavigationHeaderOrder = Array.isArray(result.headerOrder)
      ? [...result.headerOrder]
      : [];
    state.editorNavigationGroupOrder = Array.isArray(result.shortCourseGroupOrder)
      ? [...result.shortCourseGroupOrder]
      : [];
    state.editorNavigationDirty = false;
  } catch (error) {
    if (!quiet) {
      showToast(
        error?.message || "Unable to load header navigation order.",
        "error"
      );
    }
  } finally {
    state.editorNavigationLoading = false;
  }
}

function saveEditorNavigationOrder() {
  if (state.editorMode !== "beta" || !state.editorNavigationDirty) return;
  state.editorDirty = editorPendingChangeCount() > 0;
  showToast("Header order is staged locally. Publish beta preview to build it.");
}


function editorNavigationItemMarkup(key, label, editable) {
  return `
    <div
      class="editor-nav-order-item"
      data-editor-nav-key="${escapeEditorAttribute(key)}"
      draggable="${editable ? "true" : "false"}"
    >
      <span class="editor-nav-drag-handle" aria-hidden="true">⋮⋮</span>
      <strong>${escapeEditorAttribute(label)}</strong>
      <span class="editor-nav-order-hint">${editable ? "Drag to reorder" : "Live order"}</span>
    </div>
  `;
}

function bindEditorNavigationSortable(list, orderKey, editable) {
  if (!list || !editable) return;

  list.addEventListener("dragstart", (event) => {
    const item = event.target?.closest?.("[data-editor-nav-key]");
    if (!item) return;

    state.editorNavigationDrag = {
      orderKey,
      key: String(item.dataset.editorNavKey || "")
    };
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.editorNavigationDrag.key);
  });

  list.addEventListener("dragover", (event) => {
    if (state.editorNavigationDrag?.orderKey !== orderKey) return;
    const dragging = list.querySelector(".is-dragging");
    const target = event.target?.closest?.("[data-editor-nav-key]");
    if (!dragging || !target || target === dragging) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    list.insertBefore(dragging, before ? target : target.nextSibling);
  });

  const finish = () => {
    const dragging = list.querySelector(".is-dragging");
    dragging?.classList.remove("is-dragging");

    if (state.editorNavigationDrag?.orderKey !== orderKey) return;

    const nextOrder = [...list.querySelectorAll("[data-editor-nav-key]")]
      .map((item) => String(item.dataset.editorNavKey || ""))
      .filter(Boolean);

    if (orderKey === "header") {
      state.editorNavigationHeaderOrder = nextOrder;
    } else {
      state.editorNavigationGroupOrder = nextOrder;
    }

    state.editorNavigationDrag = null;
    state.editorNavigationDirty = true;

    state.editorDirty = editorPendingChangeCount() > 0;

    const save = document.querySelector("#editor-navigation-save");
    if (save) {
      save.disabled = true;
      save.textContent = "Staged · publish top right";
    }

    document.querySelector("#web-editor-preview-submit")?.removeAttribute("disabled");
  };

  list.addEventListener("drop", (event) => {
    event.preventDefault();
    finish();
  });
  list.addEventListener("dragend", finish);
}



async function loadSharedEditorDraft({ quiet = false, force = false } = {}) {
  const betaSha = state.editorStatus?.beta?.sha || "";
  if (
    !betaSha ||
    state.editorMode !== "beta" ||
    (!force && state.editorSharedDraftLoadedSha === betaSha)
  ) return;

  try {
    const result = await apiRequest("/editor-draft");
    state.editorSharedDraftAvailable = result.available !== false;
    state.editorSharedDraftLoadedSha = betaSha;
    const draft = result.draft;

    if (!draft || draft.base_sha !== betaSha) {
      state.editorSharedDraftRevision = 0;
      state.editorSharedDraftConflict = false;
      state.editorSessionSavedSignature = editorWorkspaceSignature();
      refreshEditorSessionChrome();
      return;
    }

    const payload =
      draft.payload && typeof draft.payload === "object" && !Array.isArray(draft.payload)
        ? draft.payload
        : {};

    const remoteSignature = JSON.stringify(normaliseSharedWorkspace(payload));
    const localSignature = editorWorkspaceSignature();
    const hasUnsavedLocal =
      Boolean(state.editorSessionSavedSignature) &&
      localSignature !== state.editorSessionSavedSignature;

    if (force && hasUnsavedLocal && remoteSignature !== state.editorSessionSavedSignature) {
      state.editorSharedDraftConflict = true;
      if (!quiet) {
        showToast("Another staff member changed the saved draft while you have unsaved edits.", "error");
      }
      refreshEditorSessionChrome();
      return;
    }

    applySharedEditorWorkspace(payload);
    state.editorSharedDraftRevision = Number(draft.revision || 0);
    state.editorSharedDraftConflict = false;
    state.editorSessionSavedAt = String(draft.updated_at || "");
    state.editorSessionSavedSignature = editorWorkspaceSignature();
  } catch (error) {
    if (error.status === 503) {
      state.editorSharedDraftAvailable = false;
      state.editorSharedDraftLoadedSha = betaSha;
    } else if (!quiet) {
      showToast(error?.message || "Unable to load the saved website draft.", "error");
    }
  } finally {
    refreshEditorSessionChrome();
    if (state.currentView === "editor") {
      if (!postCurrentEditorDraftToPreview()) renderWebEditor();
    }
  }
}

function sharedEditorPages() {
  return Object.fromEntries(
    Object.entries(state.editorPendingPages || {}).map(([path, draft]) => [
      path,
      editorDraftFromConfig(draft)
    ])
  );
}

function normaliseSharedWorkspace(payload = {}) {
  const pages =
    payload.pages && typeof payload.pages === "object" && !Array.isArray(payload.pages)
      ? Object.fromEntries(
          Object.entries(payload.pages).map(([path, pageDraft]) => [
            path,
            editorDraftFromConfig(pageDraft)
          ])
        )
      : {};

  const navigation =
    payload.navigation && typeof payload.navigation === "object" && !Array.isArray(payload.navigation)
      ? payload.navigation
      : {};
  const layoutOrders =
    payload.layoutOrders && typeof payload.layoutOrders === "object" && !Array.isArray(payload.layoutOrders)
      ? Object.fromEntries(
          Object.entries(payload.layoutOrders).map(([scope, order]) => [
            scope,
            Array.isArray(order) ? [...order] : []
          ])
        )
      : {};
  const banner =
    payload.banner && typeof payload.banner === "object" && !Array.isArray(payload.banner)
      ? payload.banner
      : {};
  const sourceDrafts =
    payload.sourceDrafts && typeof payload.sourceDrafts === "object" && !Array.isArray(payload.sourceDrafts)
      ? Object.fromEntries(
          Object.entries(payload.sourceDrafts)
            .filter(([, draft]) => draft && typeof draft === "object" && !Array.isArray(draft))
            .map(([path, draft]) => [
              path,
              {
                path,
                kind: draft.kind === "css" ? "css" : "html",
                content: String(draft.content || ""),
                originalSha: String(draft.originalSha || "")
              }
            ])
        )
      : {};

  return {
    pages,
    navigation: {
      headerOrder: Array.isArray(navigation.headerOrder) ? [...navigation.headerOrder] : [],
      shortCourseGroupOrder: Array.isArray(navigation.shortCourseGroupOrder)
        ? [...navigation.shortCourseGroupOrder]
        : []
    },
    layoutOrders,
    banner: {
      intervalMs: Number(banner.intervalMs || 5200),
      items: Array.isArray(banner.items) ? banner.items.map((item) => ({ ...item })) : []
    },
    sourceDrafts
  };
}

function sharedEditorWorkspace() {
  return normaliseSharedWorkspace({
    pages: sharedEditorPages(),
    navigation: {
      headerOrder: state.editorNavigationHeaderOrder,
      shortCourseGroupOrder: state.editorNavigationGroupOrder
    },
    layoutOrders: state.editorLayoutOrders,
    banner: {
      intervalMs: Number(state.editorBannerInterval || 5200),
      items: state.editorBannerItems
    },
    sourceDrafts: state.editorSourceDrafts
  });
}

function applySharedEditorWorkspace(payload = {}) {
  const workspace = normaliseSharedWorkspace(payload);
  state.editorPendingPages = workspace.pages;
  if (workspace.navigation.headerOrder.length) {
    state.editorNavigationHeaderOrder = workspace.navigation.headerOrder;
    state.editorNavigationDirty = true;
  }
  if (workspace.navigation.shortCourseGroupOrder.length) {
    state.editorNavigationGroupOrder = workspace.navigation.shortCourseGroupOrder;
    state.editorNavigationDirty = true;
  }
  if (Object.keys(workspace.layoutOrders).length) {
    state.editorLayoutOrders = workspace.layoutOrders;
    state.editorLayoutDirty = true;
  }
  if (workspace.banner.items.length || Number(workspace.banner.intervalMs) !== 5200) {
    state.editorBannerItems = workspace.banner.items;
    state.editorBannerInterval = workspace.banner.intervalMs;
    state.editorBannerDirty = true;
  }
  state.editorSourceDrafts = workspace.sourceDrafts;
  state.editorDirty = editorPendingChangeCount() > 0 || Object.keys(state.editorSourceDrafts).length > 0;
  state.editorDraftKey = "";
}

function editorWorkspaceSignature() {
  return JSON.stringify(sharedEditorWorkspace());
}

function editorUnsavedSessionCount() {
  if (!state.editorSessionSavedSignature) return 0;
  if (editorWorkspaceSignature() === state.editorSessionSavedSignature) return 0;
  return Math.max(
    1,
    editorPendingChangeCount() +
      Object.keys(state.editorSourceDrafts || {}).length
  );
}

function refreshEditorSessionChrome() {
  const count = editorUnsavedSessionCount();
  const status = document.querySelector("#editor-session-status");
  const save = document.querySelector("#editor-session-save");
  const autosave = document.querySelector("#editor-autosave-toggle");

  if (status) {
    if (state.editorSharedDraftConflict) {
      status.textContent = "Draft conflict";
      status.className = "editor-session-status is-conflict";
    } else if (state.editorSessionSaving || state.editorSharedDraftSaving) {
      status.textContent = "Saving…";
      status.className = "editor-session-status is-saving";
    } else if (count) {
      status.textContent = `${count} unsaved change${count === 1 ? "" : "s"}`;
      status.className = "editor-session-status is-unsaved";
    } else if (state.editorSessionSavedAt) {
      const savedAt = new Date(state.editorSessionSavedAt);
      status.textContent = Number.isNaN(savedAt.getTime())
        ? "Saved"
        : `Saved ${savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      status.className = "editor-session-status is-saved";
    } else {
      status.textContent = "Saved";
      status.className = "editor-session-status is-saved";
    }
  }

  if (save) {
    save.disabled =
      state.editorMode !== "beta" ||
      state.editorSessionSaving ||
      state.editorSharedDraftSaving ||
      state.editorSharedDraftConflict ||
      count < 1;
  }

  if (autosave) {
    autosave.classList.toggle("is-active", state.editorAutosaveEnabled);
    autosave.setAttribute("aria-pressed", state.editorAutosaveEnabled ? "true" : "false");
    const label = autosave.querySelector("span");
    if (label) label.textContent = state.editorAutosaveEnabled ? "Autosave on" : "Autosave off";
  }
}

function markEditorWorkspaceChanged() {
  refreshEditorSessionChrome();
  if (state.editorAutosaveEnabled) scheduleSharedEditorDraft();
}

function scheduleSharedEditorDraft() {
  if (!state.editorAutosaveEnabled) return;
  if (state.editorSharedDraftTimer) window.clearTimeout(state.editorSharedDraftTimer);
  state.editorSharedDraftTimer = window.setTimeout(
    () => saveSharedEditorDraft({ quiet: true }),
    900
  );
}

async function saveSharedEditorDraft({ quiet = false } = {}) {
  state.editorSharedDraftTimer = null;
  if (
    state.editorMode !== "beta" ||
    state.editorSharedDraftSaving ||
    state.editorSharedDraftAvailable === false ||
    state.editorSharedDraftConflict
  ) return false;

  const betaSha = state.editorStatus?.beta?.sha || "";
  if (!betaSha) return false;

  state.editorSharedDraftSaving = true;
  state.editorSessionSaving = true;
  refreshEditorSessionChrome();

  try {
    const workspace = sharedEditorWorkspace();
    const result = await apiRequest("/editor-draft", {
      method: "POST",
      body: {
        baseSha: betaSha,
        revision: state.editorSharedDraftRevision || 0,
        ...workspace
      }
    });
    if (result.available === false) {
      state.editorSharedDraftAvailable = false;
      if (!quiet) showToast("Saved draft storage is not available.", "error");
      return false;
    }
    state.editorSharedDraftAvailable = true;
    state.editorSharedDraftLoadedSha = betaSha;
    state.editorSharedDraftRevision = Number(
      result.draft?.revision || state.editorSharedDraftRevision || 0
    );
    state.editorSessionSavedAt = String(result.draft?.updated_at || new Date().toISOString());
    state.editorSessionSavedSignature = editorWorkspaceSignature();
    if (!quiet) {
      showToast("Draft saved. This does not publish the beta preview or live website.");
    }
    return true;
  } catch (error) {
    if (error.status === 409) {
      state.editorSharedDraftConflict = true;
      showToast("Another staff member changed the saved draft. Reload before saving more changes.", "error");
    } else if (error.status === 503) {
      state.editorSharedDraftAvailable = false;
      if (!quiet) showToast("Saved draft storage is not enabled.", "error");
    } else if (!quiet) {
      showToast(error?.message || "Unable to save the website draft.", "error");
    }
    return false;
  } finally {
    state.editorSharedDraftSaving = false;
    state.editorSessionSaving = false;
    refreshEditorSessionChrome();
  }
}

async function clearSharedEditorDraft() {
  if (state.editorSharedDraftTimer) window.clearTimeout(state.editorSharedDraftTimer);
  state.editorSharedDraftTimer = null;
  try {
    await apiRequest("/editor-draft", { method: "DELETE", body: {} });
  } catch {
    // Optional saved-draft storage must not block a successful publish.
  }
  state.editorSharedDraftLoadedSha = state.editorStatus?.beta?.sha || "";
  state.editorSharedDraftRevision = 0;
  state.editorSharedDraftConflict = false;
  state.editorSessionSavedAt = "";
  state.editorSessionSavedSignature = editorWorkspaceSignature();
  refreshEditorSessionChrome();
}


async function loadEditorVersionHistory({ quiet = false } = {}) {
  if (state.editorHistoryLoading || !staffCan("editor")) return;
  state.editorHistoryLoading = true;
  if (state.currentView === "editor" && state.editorHistoryOpen) renderWebEditor();

  try {
    const result = await apiRequest("/editor-history");
    state.editorVersionHistory = Array.isArray(result.commits) ? result.commits : [];
    state.editorAuditHistory = Array.isArray(result.audit) ? result.audit : [];
  } catch (error) {
    if (!quiet) showToast(error?.message || "Unable to load website history.", "error");
  } finally {
    state.editorHistoryLoading = false;
    if (state.currentView === "editor" && state.editorHistoryOpen) renderWebEditor();
  }
}

async function stageEditorProductionRestore(sourceSha) {
  if (!staffCan("publish")) return;
  if (editorPendingChangeCount() > 0) {
    showToast("Discard or publish local editor changes before staging a restore.", "error");
    return;
  }

  const commit = state.editorVersionHistory.find((item) => item.sha === sourceSha);
  const label = commit?.message || sourceSha.slice(0, 7);
  if (!window.confirm(`Stage “${label}” as a new beta preview? Production will not change yet.`)) {
    return;
  }

  try {
    const result = await apiRequest("/editor-restore", {
      method: "POST",
      body: {
        confirm: "STAGE_PRODUCTION_RESTORE",
        sourceSha,
        expectedMainSha: state.editorStatus?.main?.sha || ""
      }
    });

    state.editorStatus = result.status || state.editorStatus;
    state.editorDraftKey = "";
    state.editorCodeSource = null;
    state.editorCodeSourceKey = "";
    state.editorAssetsLoaded = false;
    state.editorNavigationTarget = "";
    state.editorLayoutTarget = "";
    showToast("Previous production version staged on beta-main. Review the Cloudflare preview before publishing live.");
    renderWebEditor();
  } catch (error) {
    showToast(error?.message || "Unable to stage that website version.", "error");
  }
}

async function loadEditorCodeSource({ quiet = false, force = false } = {}) {
  if (!state.editorStatus?.connected || state.editorCodeLoading) return;

  const target = state.editorMode === "production" ? "production" : "beta";
  const key = `${target}:${state.editorPage}:${target === "beta"
    ? state.editorStatus?.beta?.sha || ""
    : state.editorStatus?.main?.sha || ""}`;

  if (!force && state.editorCodeSourceKey === key && state.editorCodeSource) return;

  state.editorCodeLoading = true;
  if (state.currentView === "editor" && state.editorPreviewMode === "code") {
    renderWebEditor();
  }

  try {
    const result = await apiRequest(
      `/editor-source?target=${encodeURIComponent(target)}&page=${encodeURIComponent(state.editorPage || "/")}`
    );
    state.editorCodeSource = result;
    state.editorCodeSourceKey = key;
    state.editorCodeOriginal = String(result?.html?.content || "");
    state.editorCodeDraft = state.editorCodeOriginal;
    state.editorCodeDirty = false;
  } catch (error) {
    state.editorCodeSource = {
      error: error?.message || "Unable to load website source."
    };
    state.editorCodeSourceKey = key;
    state.editorCodeOriginal = "";
    state.editorCodeDraft = "";
    state.editorCodeDirty = false;
    if (!quiet) showToast(state.editorCodeSource.error, "error");
  } finally {
    state.editorCodeLoading = false;
    if (state.currentView === "editor" && state.editorPreviewMode === "code") {
      renderWebEditor();
    }
  }
}

function editorCodeContent() {
  return String(
    state.editorCodeDraft ||
    state.editorCodeSource?.html?.content ||
    ""
  );
}

function editorCodeFileLabel() {
  return state.editorCodeSource?.html?.path || "HTML";
}

function highlightHtmlTag(tag) {
  if (/^<!--/.test(tag)) {
    return `<span class="html-comment">${escapeEditorAttribute(tag)}</span>`;
  }
  if (/^<!doctype/i.test(tag)) {
    return `<span class="html-doctype">${escapeEditorAttribute(tag)}</span>`;
  }

  const match = tag.match(/^(<\/?)([A-Za-z][A-Za-z0-9:-]*)([\s\S]*?)(\/?>)$/);
  if (!match) return escapeEditorAttribute(tag);

  const [, open, name, rawAttrs, close] = match;
  let attrs = "";
  let cursor = 0;
  const attrPattern = /(\s+)([A-Za-z_:][A-Za-z0-9:._-]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g;
  let attrMatch;

  while ((attrMatch = attrPattern.exec(rawAttrs))) {
    attrs += escapeEditorAttribute(rawAttrs.slice(cursor, attrMatch.index));
    attrs += escapeEditorAttribute(attrMatch[1]);
    attrs += `<span class="html-attr">${escapeEditorAttribute(attrMatch[2])}</span>`;
    attrs += `<span class="html-punct">${escapeEditorAttribute(attrMatch[3])}</span>`;
    attrs += `<span class="html-string">${escapeEditorAttribute(attrMatch[4])}</span>`;
    cursor = attrPattern.lastIndex;
  }

  attrs += escapeEditorAttribute(rawAttrs.slice(cursor));

  return [
    `<span class="html-punct">${escapeEditorAttribute(open)}</span>`,
    `<span class="html-tag">${escapeEditorAttribute(name)}</span>`,
    attrs,
    `<span class="html-punct">${escapeEditorAttribute(close)}</span>`
  ].join("");
}

function highlightHtmlSource(source) {
  const text = String(source || "");
  const pattern = /<!--[\s\S]*?-->|<!DOCTYPE[\s\S]*?>|<\/?[A-Za-z][^>]*>/gi;
  let result = "";
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    result += escapeEditorAttribute(text.slice(cursor, match.index));
    result += highlightHtmlTag(match[0]);
    cursor = pattern.lastIndex;
  }

  result += escapeEditorAttribute(text.slice(cursor));
  return result;
}
const CODE_HIGHLIGHT_BUFFER_LINES = 40;
const codeHighlightCache = new WeakMap();

function codeLineStarts(text) {
  const starts = [0];
  let index = text.indexOf("\n");
  while (index !== -1) {
    starts.push(index + 1);
    index = text.indexOf("\n", index + 1);
  }
  return starts;
}

function lineForOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

// Moves a highlight window's first line back out of any tag or comment that
// spans into it, so the tokenizer never starts halfway through one.
function safeHighlightStartLine(text, starts, line) {
  let offset = starts[line];
  const commentOpen = text.lastIndexOf("<!--", offset);
  if (commentOpen !== -1) {
    const commentClose = text.indexOf("-->", commentOpen);
    if (commentClose === -1 || commentClose + 3 > offset) offset = commentOpen;
  }
  const tagOpen = text.lastIndexOf("<", offset);
  if (tagOpen > text.lastIndexOf(">", offset)) offset = Math.min(offset, tagOpen);
  return Math.max(lineForOffset(starts, offset), line - 400, 0);
}

// Highlights only the lines around the textarea's viewport. Re-highlighting a
// whole page source on every keystroke forced a full layout of thousands of
// spans; the visible window keeps typing and scrolling cost constant.
function paintCodeHighlight(input, highlight, { force = false } = {}) {
  const code = highlight?.querySelector("code");
  if (!(input instanceof HTMLTextAreaElement) || !code) return;

  let cache = codeHighlightCache.get(highlight);
  if (!cache) {
    cache = {
      text: null,
      starts: [0],
      from: 0,
      to: 0,
      lineHeight: Number.parseFloat(getComputedStyle(input).lineHeight) || 19.44
    };
    codeHighlightCache.set(highlight, cache);
  }

  const text = input.value;
  const textChanged = cache.text !== text;
  if (textChanged) {
    cache.text = text;
    cache.starts = codeLineStarts(text);
  }

  const { starts, lineHeight } = cache;
  const firstVisible = Math.max(0, Math.floor(input.scrollTop / lineHeight) - 1);
  const lastVisible = Math.min(
    starts.length,
    firstVisible + Math.ceil(input.clientHeight / lineHeight) + 2
  );

  if (force || textChanged || firstVisible < cache.from || lastVisible > cache.to) {
    const from = safeHighlightStartLine(
      text,
      starts,
      Math.max(0, firstVisible - CODE_HIGHLIGHT_BUFFER_LINES)
    );
    const to = Math.min(starts.length, lastVisible + CODE_HIGHLIGHT_BUFFER_LINES);
    const end = to < starts.length ? starts[to] : text.length;
    code.innerHTML = highlightHtmlSource(text.slice(starts[from], end));
    cache.from = from;
    cache.to = to;
  }

  highlight.scrollTop = 0;
  highlight.scrollLeft = 0;
  code.style.transform =
    `translate(${-input.scrollLeft}px, ${cache.from * lineHeight - input.scrollTop}px)`;
}

function escapeSourceRegExp(value) {
  const specials = new Set(["\\", "^", "$", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|"]);
  return [...String(value || "")].map((character) =>
    specials.has(character) ? "\\" + character : character
  ).join("");
}
function sourceTagAttribute(tagSource, name) {
  const lower = String(tagSource || "").toLowerCase();
  const needle = String(name || "").toLowerCase() + "=";
  let index = lower.indexOf(needle);
  if (index < 0) {
    index = lower.indexOf(String(name || "").toLowerCase() + " =");
  }
  if (index < 0) return "";

  const equals = lower.indexOf("=", index);
  if (equals < 0) return "";
  let cursor = equals + 1;
  while (/\s/.test(tagSource[cursor] || "")) cursor += 1;
  const quote = tagSource[cursor];
  if (quote === "\"" || quote === "'") {
    const close = tagSource.indexOf(quote, cursor + 1);
    return close >= 0 ? tagSource.slice(cursor + 1, close) : "";
  }
  let close = cursor;
  while (close < tagSource.length && !/[\s>]/.test(tagSource[close])) close += 1;
  return tagSource.slice(cursor, close);
}

function sourceOpeningTags(source, tag) {
  const html = String(source || "");
  const lower = html.toLowerCase();
  const needle = "<" + String(tag || "").toLowerCase();
  const output = [];
  let cursor = 0;

  while (needle.length > 1 && output.length < 500) {
    const start = lower.indexOf(needle, cursor);
    if (start < 0) break;
    const afterName = lower[start + needle.length] || "";
    if (afterName && /[a-z0-9:-]/i.test(afterName)) {
      cursor = start + needle.length;
      continue;
    }
    const end = html.indexOf(">", start);
    if (end < 0) break;
    output.push({ start, end: end + 1, source: html.slice(start, end + 1) });
    cursor = end + 1;
  }

  return output;
}

function sourceRangeForSelection(source, hint) {
  const html = String(source || "");
  if (!html || !hint || typeof hint !== "object") return null;

  const tag = String(hint.tag || "").toLowerCase();
  if (!tag) return null;

  const id = String(hint.id || hint.attributes?.id || "").trim();
  const className = String(hint.className || hint.attributes?.class || "").trim();
  const attributes = hint.attributes && typeof hint.attributes === "object" ? hint.attributes : {};
  const tags = sourceOpeningTags(html, tag);
  let chosen = null;

  if (id) {
    chosen = tags.find((item) => sourceTagAttribute(item.source, "id") === id) || null;
  }

  if (!chosen && className) {
    const wanted = className.split(/\s+/).filter(Boolean);
    chosen = tags.find((item) => {
      const actual = sourceTagAttribute(item.source, "class").split(/\s+/).filter(Boolean);
      return wanted.some((name) => actual.includes(name));
    }) || null;
  }

  if (!chosen) {
    for (const name of ["href", "src", "alt", "data-wcg-editor-layout-key"]) {
      const value = String(attributes[name] || "").trim();
      if (!value) continue;
      chosen = tags.find((item) => sourceTagAttribute(item.source, name) === value) || null;
      if (chosen) break;
    }
  }

  if (!chosen && hint.text) {
    const firstWords = String(hint.text).trim().split(/\s+/).filter(Boolean).slice(0, 5);
    if (firstWords.length) {
      const first = firstWords[0].toLowerCase();
      const lower = html.toLowerCase();
      let textIndex = lower.indexOf(first);
      while (textIndex >= 0 && !chosen) {
        for (let index = tags.length - 1; index >= 0; index -= 1) {
          if (tags[index].start <= textIndex) {
            chosen = tags[index];
            break;
          }
        }
        textIndex = lower.indexOf(first, textIndex + first.length);
      }
    }
  }

  if (!chosen && hint.openingTag) {
    const direct = html.indexOf(String(hint.openingTag || "").trim());
    if (direct >= 0) {
      const close = html.indexOf(">", direct);
      if (close >= 0) chosen = { start: direct, end: close + 1 };
    }
  }

  if (!chosen) return null;

  let end = chosen.end;
  if (!["img","br","hr","input","meta","link","source"].includes(tag)) {
    const closeTag = "</" + tag + ">";
    const close = html.toLowerCase().indexOf(closeTag, chosen.end);
    if (close >= 0 && close - chosen.start <= 3200) end = close + closeTag.length;
  }

  return { start: chosen.start, end: Math.max(chosen.start + 1, end) };
}
function revealCodeSelection(hint) {
  if (state.editorPreviewMode !== "code") return;
  const input = document.querySelector("#editor-code-input");
  const editor = document.querySelector(".editor-code-editor");
  if (!(input instanceof HTMLTextAreaElement) || !editor) return;

  const range = sourceRangeForSelection(input.value, hint);
  if (!range) return;

  input.focus({ preventScroll: true });
  input.setSelectionRange(range.start, range.end);
  const before = input.value.slice(0, range.start);
  const lineIndex = before.split("\n").length - 1;
  const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight) || 19.4;
  input.scrollTop = Math.max(0, lineIndex * lineHeight - input.clientHeight * 0.28);
  const firstLineStart = before.lastIndexOf("\n") + 1;
  input.scrollLeft = Math.max(0, (range.start - firstLineStart) * 7.2 - input.clientWidth * 0.18);
  input.dispatchEvent(new Event("scroll"));

  editor.classList.remove("is-source-flash");
  void editor.offsetWidth;
  editor.classList.add("is-source-flash");
  window.setTimeout(() => editor.classList.remove("is-source-flash"), 900);
}

async function saveEditorCodeSource() {
  if (
    state.editorMode !== "beta" ||
    state.editorCodeSaving ||
    !state.editorCodeDirty
  ) {
    return;
  }

  const expectedBetaSha = state.editorStatus?.beta?.sha || "";
  const expectedFileSha = state.editorCodeSource?.html?.sha || "";
  if (!expectedBetaSha || !expectedFileSha) {
    showToast("Reload the page source before saving.", "error");
    return;
  }

  state.editorCodeSaving = true;
  const button = document.querySelector("#editor-code-save");
  if (button) {
    button.disabled = true;
    button.textContent = "Building preview…";
  }

  try {
    const result = await apiRequest("/editor-code-save", {
      method: "POST",
      body: {
        page: state.editorPage,
        expectedBetaSha,
        expectedFileSha,
        content: state.editorCodeDraft
      }
    });

    state.editorCodeOriginal = state.editorCodeDraft;
    state.editorCodeDirty = false;
    state.editorCodeSource = null;
    state.editorCodeSourceKey = "";
    state.editorStatus = null;
    state.editorDraftKey = "";

    await loadWebEditorStatus({ quiet: true });
    await loadEditorCodeSource({ quiet: true, force: true });

    showToast(
      `HTML saved to beta-main as ${String(result.commitSha || "").slice(0, 7)}. Review the Cloudflare preview before publishing live.`
    );
  } catch (error) {
    showToast(error?.message || "Unable to save HTML source.", "error");
  } finally {
    state.editorCodeSaving = false;
    if (state.currentView === "editor") renderWebEditor();
  }
}


function editorDevtoolsContentMarkup() {
  const data = state.editorDevtoolsData;
  const tab = state.editorDevtoolsTab;

  if (!data || data.panel !== tab) {
    return `<div class="editor-devtools-empty">Select an element in the preview or refresh this panel.</div>`;
  }

  if (tab === "elements") {
    const target = data.target;
    if (!target) return `<div class="editor-devtools-empty">No DOM node selected.</div>`;

    return `
      <div class="editor-devtools-elements">
        <div class="editor-devtools-node-head">
          <code>${escapeEditorAttribute(target.selector || target.tag || "element")}</code>
          <span>${escapeEditorAttribute(target.box ? `${target.box.width} × ${target.box.height}` : "")}</span>
        </div>
        <pre><code>${escapeEditorAttribute(target.outerHTML || "")}</code></pre>
        ${Array.isArray(target.children) && target.children.length ? `
          <div class="editor-devtools-children">
            <strong>Children</strong>
            ${target.children.map((child) => `
              <code>${escapeEditorAttribute(child.selector || child.tag || "")}</code>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  if (tab === "styles") {
    const computed = data.computed && typeof data.computed === "object"
      ? Object.entries(data.computed)
      : [];
    const rules = Array.isArray(data.rules) ? data.rules : [];

    return `
      <div class="editor-devtools-styles">
        <section>
          <h4>Matched CSS rules</h4>
          ${data.inlineStyle ? `
            <article class="editor-devtools-rule">
              <div><code>element.style</code></div>
              <pre><code>${escapeEditorAttribute(data.inlineStyle)}</code></pre>
            </article>
          ` : ""}
          ${rules.length
            ? rules.map((rule) => `
                <article class="editor-devtools-rule">
                  <div>
                    <code>${escapeEditorAttribute(rule.selector || "")}</code>
                    <span>${escapeEditorAttribute(rule.source || "")}</span>
                  </div>
                  <pre><code>${escapeEditorAttribute(rule.cssText || "")}</code></pre>
                </article>
              `).join("")
            : `<div class="editor-devtools-empty is-small">No readable matching stylesheet rules.</div>`}
        </section>
        <section>
          <h4>Computed</h4>
          <div class="editor-devtools-computed">
            ${computed.map(([property, value]) => `
              <div><code>${escapeEditorAttribute(property)}</code><span>${escapeEditorAttribute(value)}</span></div>
            `).join("")}
          </div>
        </section>
      </div>
    `;
  }

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const perf = data.performance || {};
  return `
    <div class="editor-devtools-console">
      <div class="editor-devtools-console-meta">
        <span>DOM nodes: <b>${Number(perf.domNodes || 0)}</b></span>
        <span>Resources: <b>${Number(perf.resources || 0)}</b></span>
      </div>
      ${entries.length
        ? entries.map((entry) => `
            <div class="editor-devtools-console-row is-${escapeEditorAttribute(entry.level || "log")}">
              <span>${escapeEditorAttribute(entry.level || "log")}</span>
              <code>${escapeEditorAttribute(entry.text || "")}</code>
              <time>${escapeEditorAttribute(entry.time ? formatTime(entry.time) : "")}</time>
            </div>
          `).join("")
        : `<div class="editor-devtools-empty">No console messages captured in this preview session.</div>`}
    </div>
  `;
}

function renderEditorDevtoolsDock() {
  const content = document.querySelector("#editor-devtools-content");
  if (content) content.innerHTML = editorDevtoolsContentMarkup();

  document.querySelectorAll("[data-editor-devtools-tab]").forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.editorDevtoolsTab === state.editorDevtoolsTab
    );
  });
}

function editorDeviceIcon(device) {
  if (device === "mobile") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"></rect><path d="M11 18.5h2"></path></svg>`;
  }
  if (device === "tablet") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="2.5" width="15" height="19" rx="2"></rect><path d="M11 18.5h2"></path></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="12.5" rx="1.5"></rect><path d="M8.5 20h7M12 16.5V20"></path></svg>`;
}

function syncElementAttributes(target, source, keep = []) {
  for (const { name } of [...target.attributes]) {
    if (!keep.includes(name) && !source.hasAttribute(name)) target.removeAttribute(name);
  }
  for (const { name, value } of [...source.attributes]) {
    if (!keep.includes(name) && target.getAttribute(name) !== value) {
      target.setAttribute(name, value);
    }
  }
}

// Replaces the editor chrome with freshly rendered markup while keeping the
// live preview <iframe> attached to the document. Detaching or recreating an
// iframe always reloads the whole website, so instead of swapping the kept
// node into the new tree, every new node is moved around the kept one.
function patchEditorPanel(panel, markup, reuseFrame) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const fresh = template.content;

  const oldBrowser = reuseFrame ? panel.querySelector("#web-editor-browser") : null;
  const oldFrame = oldBrowser?.querySelector(":scope > #web-editor-frame");
  const newBrowser = fresh.querySelector("#web-editor-browser");
  const newFrame = newBrowser?.querySelector(":scope > #web-editor-frame");

  const chain = (node, root) => {
    const nodes = [];
    for (let current = node; current && current !== root; current = current.parentNode) {
      nodes.push(current);
    }
    return nodes;
  };
  const oldChain = oldFrame ? chain(oldFrame, panel) : [];
  const newChain = newFrame ? chain(newFrame, fresh) : [];
  const sameShape =
    oldChain.length > 0 &&
    oldChain.length === newChain.length &&
    oldChain.every((node, index) => node.tagName === newChain[index].tagName) &&
    oldChain[oldChain.length - 1].parentNode === panel;

  if (!sameShape) {
    panel.replaceChildren(fresh);
    return false;
  }

  const newFrameNode = newChain[0];
  syncElementAttributes(oldFrame, newFrameNode, ["src", "data-frame-key"]);

  for (let level = 1; level <= oldChain.length; level += 1) {
    const oldParent = level < oldChain.length ? oldChain[level] : panel;
    const newParent = level < newChain.length ? newChain[level] : fresh;
    const keptOld = oldChain[level - 1];
    const keptNew = newChain[level - 1];

    if (oldParent !== panel) {
      // Inline sizes (viewport scale, dock split) are recomputed after render.
      syncElementAttributes(oldParent, newParent, ["style"]);
    }

    // The collaboration notes dock is owned by editor-collab.js; keep it.
    const notesDock = [...oldParent.children].find((child) => child.id === "editor-notes-panel") || null;
    for (const child of [...oldParent.childNodes]) {
      if (child !== keptOld && child !== notesDock) child.remove();
    }

    let before = true;
    for (const child of [...newParent.childNodes]) {
      if (child === keptNew) {
        before = false;
        continue;
      }
      oldParent.insertBefore(child, before ? keptOld : notesDock);
    }
  }

  return true;
}

function renderWebEditor() {
  if (state.editorPreviewMode === "devtools") state.editorPreviewMode = "visual";
  const panel = document.querySelector("#chat-panel");
  if (!panel) return;

  // Re-renders keep the loaded website unless the page or environment changed,
  // a reload was explicitly requested, or a code-view source preview replaced
  // the rendered page and the user has returned to the visual editor.
  const frameKey = `${state.editorMode}:${state.editorPage}`;
  const existingFrame = panel.querySelector("#web-editor-frame");
  const leavingSourcePreview =
    state.editorSourcePreviewPosted && state.editorPreviewMode !== "code";
  const reuseFrame =
    Boolean(existingFrame) &&
    existingFrame.dataset.frameKey === frameKey &&
    !state.editorFrameReloadRequested &&
    !leavingSourcePreview;
  state.editorFrameReloadRequested = false;
  if (leavingSourcePreview) state.editorSourcePreviewPosted = false;

  if (state.editorCodePreviewTimer) {
    window.clearTimeout(state.editorCodePreviewTimer);
    state.editorCodePreviewTimer = null;
  }

  state.editorPreviewResizeObserver?.disconnect?.();
  state.editorPreviewResizeObserver = null;
  if (state.editorPreviewResizeHandler) {
    window.removeEventListener("resize", state.editorPreviewResizeHandler);
    state.editorPreviewResizeHandler = null;
  }

  const productionPreviewOrigin = "https://wellwebsite.pages.dev";
  const betaPreviewOrigin = "https://beta-main.wellwebsite.pages.dev";
  const publicOrigin = "https://www.wellcollegeglobal.com";
  const connected = state.editorStatus?.connected === true;
  const comparison = state.editorStatus?.comparison || {};
  const betaBehind = Number(comparison.behindBy || 0) > 0;
  const betaAhead = Number(comparison.aheadBy || 0) > 0;
  const canEnterEdit = state.editorMode === "beta" && connected;
  const editable = canEnterEdit && !betaBehind;
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
  const markup = `
    <div class="web-editor-fullscreen">
      <input
        id="editor-assets-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
      />
      <header class="editor-fullscreen-topbar">
        <div class="editor-fullscreen-topbar-left">
          <button id="web-editor-exit" class="editor-topbar-icon-button" type="button" aria-label="Exit website editor" title="Back">←</button>

          <div class="editor-fullscreen-title">
            <strong>Well Website Editor</strong>
          </div>

          <select id="web-editor-page" class="editor-header-select" aria-label="Website page" hidden>
            <option value="/">Home</option>
            <option value="/qualifications.html">Qualifications</option>
            <option value="/short-courses.html">Short Courses</option>
            <option value="/about.html">About</option>
            <option value="/testimonials.html">Testimonials</option>
            <option value="/faqs.html">FAQs</option>
            <option value="/contact.html">Contact</option>
          </select>

          <div class="editor-mode-switcher" role="group" aria-label="Website environment">
            <button type="button" data-editor-environment="beta" class="${state.editorMode === "beta" ? "is-active" : ""}">BETA</button>
            <button type="button" data-editor-environment="production" class="${state.editorMode === "production" ? "is-active" : ""}">PRODUCTION</button>
          </div>

          <div class="editor-view-toolbar" role="group" aria-label="Editor surface">
            <button class="${state.editorPreviewMode === "visual" ? "is-active" : ""}" type="button" data-editor-preview-mode="visual">Visual</button>
            <button class="${state.editorPreviewMode === "code" ? "is-active" : ""}" type="button" data-editor-preview-mode="code">&lt;/&gt; Code</button>
          </div>

          ${state.editorPreviewMode === "visual" ? `
            <div class="editor-interaction-toolbar" role="group" aria-label="Website interaction mode">
              <button
                class="${state.editorMode === "production" || state.editorTool === "view" ? "is-active" : ""}"
                type="button"
                data-editor-interaction="view"
                title="Navigate the website without editing"
                aria-label="View and navigate website"
              >↖ <span>View</span></button>
              <button
                class="${state.editorMode === "beta" && state.editorTool !== "view" ? "is-active" : ""}"
                type="button"
                data-editor-interaction="edit"
                title="${betaBehind ? "Update the beta preview and enter Edit mode" : "Click website content to edit it"}"
                aria-label="Edit website"
                ${canEnterEdit ? "" : "disabled"}
              >✦ <span>Edit</span></button>
            </div>

            <div
              class="editor-tool-toolbar ${state.editorMode === "beta" && state.editorTool !== "view" ? "is-expanded" : "is-collapsed"}"
              role="group"
              aria-label="Edit tools"
            >
              <button
                class="${state.editorTool === "text-box" ? "is-active" : ""}"
                type="button"
                data-editor-tool="text-box"
                title="Draw a new text area"
                aria-label="Draw a new text area"
                ${editable ? "" : "disabled"}
              >✎ <span>Text</span></button>
            </div>

            <div class="editor-notes-mode-slot" aria-label="Page notes"></div>
          ` : ""}

          <div class="editor-device-toolbar is-icons" role="group" aria-label="Preview device size">
            ${[["desktop", "Desktop"], ["tablet", "Tablet"], ["mobile", "Phone"]].map(([device, label]) => `
              <button
                class="${state.editorDevice === device ? "is-active" : ""}"
                type="button"
                data-editor-device="${device}"
                aria-label="${label} preview"
                aria-pressed="${state.editorDevice === device}"
                title="${label}"
              >${editorDeviceIcon(device)}</button>
            `).join("")}
          </div>
        </div>

        <div class="editor-fullscreen-topbar-right">
          <div class="editor-history-actions" role="group" aria-label="Undo and redo">
            <button id="web-editor-undo" class="editor-topbar-icon-button" type="button" aria-label="Undo last change" title="Undo" ${canUndo ? "" : "disabled"}>↶</button>
            <button id="web-editor-redo" class="editor-topbar-icon-button" type="button" aria-label="Redo change" title="Redo" ${canRedo ? "" : "disabled"}>↷</button>
            <button
              id="web-editor-discard"
              class="editor-topbar-icon-button"
              type="button"
              aria-label="Discard this page's unpublished changes"
              title="Discard this page's changes"
              ${editable ? "" : "disabled"}
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>
          </div>

          ${connected && betaBehind ? `
            <button id="web-editor-sync" class="editor-topbar-button" type="button">Update preview</button>
          ` : ""}

          ${connected && betaAhead && !betaBehind && staffCan("publish") ? `
            <button id="web-editor-promote" class="editor-topbar-button is-promote" type="button">Publish preview live</button>
          ` : ""}

          <button
            id="web-editor-refresh"
            class="editor-topbar-icon-button"
            type="button"
            aria-label="${state.editorPreviewMode === "code" ? "Reload page source" : "Reload website preview"}"
            title="${state.editorPreviewMode === "code" ? "Reload code" : "Reload preview"}"
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"></path><path d="M20 4v7h-7"></path></svg></button>
          <a id="web-editor-open-page" class="editor-topbar-icon-button" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg></a>

          ${state.editorPreviewMode === "code" ? `
            <button
              id="editor-code-save"
              class="editor-topbar-button is-primary"
              type="button"
              ${editable && state.editorCodeDirty && !state.editorCodeSaving ? "" : "disabled"}
            >${state.editorCodeSaving ? "Building preview…" : "Save code to beta preview"}</button>
          ` : `
            <button
              id="web-editor-preview-submit"
              class="editor-topbar-button is-primary"
              type="button"
              ${editable && state.editorDirty ? "" : "disabled"}
            >Publish beta preview</button>
          `}
        </div>
      </header>

      <div class="editor-fullscreen-body">
        <main class="editor-live-workspace">
          <div class="editor-preview-placeholder is-fullscreen ${state.editorPreviewMode === "code" ? "has-code-dock" : ""}">
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

            ${state.editorPreviewMode === "code" ? `
              <button
                class="editor-dock-resizer"
                type="button"
                aria-label="Resize code editor"
                title="Drag to resize"
              ></button>
              <aside class="editor-code-dock">
                <div class="editor-preview-browser-bar">
                  <i></i><i></i><i></i>
                  <span>${escapeEditorAttribute(editorCodeFileLabel())}</span>
                  <b class="${state.editorMode === "beta" ? "is-beta" : ""}">${state.editorMode === "beta" ? "BETA HTML" : "LIVE HTML"}</b>
                </div>
                <div class="editor-code-meta">
                  <span>HTML</span>
                  <small>${state.editorMode === "beta"
                    ? state.editorCodeDirty
                      ? "Unsaved source changes · save to build a new beta preview"
                      : "beta-main source · editable"
                    : "main source · read only"}</small>
                </div>
                <div class="editor-code-editor">
                  <pre id="editor-code-highlight" class="editor-code-highlight" aria-hidden="true"><code>${state.editorCodeLoading
                    ? "Loading source…"
                    : state.editorCodeSource?.error
                      ? escapeEditorAttribute(state.editorCodeSource.error)
                      : ""}</code></pre>
                  <textarea
                    id="editor-code-input"
                    class="editor-code-input"
                    spellcheck="false"
                    autocomplete="off"
                    autocapitalize="off"
                    wrap="off"
                    ${editable ? "" : "readonly"}
                    aria-label="HTML source editor"
                  >${escapeEditorAttribute(editorCodeContent())}</textarea>
                </div>
              </aside>
            ` : ""}

            ${state.editorPreviewMode === "devtools" ? `
              <button
                class="editor-dock-resizer"
                type="button"
                aria-label="Resize DevTools"
                title="Drag to resize"
              ></button>
              <section class="editor-devtools-dock">
                <header class="editor-devtools-toolbar">
                  <div class="editor-devtools-tabs" role="tablist" aria-label="DevTools panels">
                    <button class="${state.editorDevtoolsTab === "elements" ? "is-active" : ""}" type="button" data-editor-devtools-tab="elements">Elements</button>
                    <button class="${state.editorDevtoolsTab === "styles" ? "is-active" : ""}" type="button" data-editor-devtools-tab="styles">Styles</button>
                    <button class="${state.editorDevtoolsTab === "console" ? "is-active" : ""}" type="button" data-editor-devtools-tab="console">Console</button>
                  </div>
                  <div class="editor-devtools-actions">
                    <span class="editor-devtools-label">DevTools</span>
                    <button id="editor-devtools-refresh" type="button" title="Refresh inspector">↻</button>
                    ${state.editorDevtoolsTab === "console" ? `<button id="editor-devtools-clear" type="button" title="Clear console">⌫</button>` : ""}
                  </div>
                </header>
                <div id="editor-devtools-content" class="editor-devtools-content">
                  ${editorDevtoolsContentMarkup()}
                </div>
              </section>
            ` : ""}
          </div>
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
        <p id="editor-banner-delete-copy">This removes the selected rolling banner from the website view you are editing.</p>
        <div class="confirm-actions">
          <button id="cancel-editor-banner-delete" class="confirm-secondary" type="button">Cancel</button>
          <button id="confirm-editor-banner-delete" class="confirm-danger" type="button">Delete banner</button>
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
        <p>This publishes only the exact beta commit shown below. If beta changes after review, publishing will be blocked.</p>
        <code class="editor-promote-sha">${escapeEditorAttribute(state.editorStatus?.beta?.sha || "Preview SHA unavailable")}</code>
        ${state.editorStatus?.beta?.previewGate?.required ? `
          <p class="editor-promote-gate ${state.editorStatus.beta.previewGate.passed ? "is-passed" : "is-blocked"}">
            Required check: ${escapeEditorAttribute(state.editorStatus.beta.previewGate.name || "preview")} ·
            ${escapeEditorAttribute(state.editorStatus.beta.previewGate.passed ? "passed" : state.editorStatus.beta.previewGate.state || "pending")}
          </p>
        ` : ""}
        <div class="confirm-actions">
          <button id="cancel-editor-promote" class="confirm-secondary" type="button">Cancel</button>
          <button id="confirm-editor-promote" class="confirm-danger" type="button">Publish preview to live site</button>
        </div>
      </section>
    </div>
  `;
  const reusedFrame = patchEditorPanel(panel, markup, reuseFrame);

  const pageSelect = document.querySelector("#web-editor-page");
  const frame = document.querySelector("#web-editor-frame");
  const browser = document.querySelector("#web-editor-browser");
  const previewCanvas = document.querySelector(".editor-preview-placeholder.is-fullscreen");
  const dockResizer = document.querySelector(".editor-dock-resizer");

  const applyDockRatio = () => {
    if (!previewCanvas) return;
    const ratio = Math.min(0.72, Math.max(0.28, Number(state.editorDockRatio || 0.58)));
    previewCanvas.style.setProperty("--editor-dock-left", `${ratio * 100}%`);
    previewCanvas.style.setProperty("--editor-dock-right", `${(1 - ratio) * 100}%`);
  };

  applyDockRatio();

  if (dockResizer && previewCanvas) {
    const beginDockResize = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      dockResizer.setPointerCapture?.(event.pointerId);
      document.body.classList.add("is-resizing-editor-dock");

      const onMove = (moveEvent) => {
        const rect = previewCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const stacked = window.matchMedia("(max-width: 760px)").matches;
        const span = stacked ? rect.height : rect.width;
        const usable = Math.max(1, span - 9);
        const rightMinimum = previewCanvas.classList.contains("has-code-dock")
          ? (stacked ? 260 : 360)
          : (stacked ? 240 : 320);
        const leftMinimum = stacked ? 260 : 320;
        const minRatio = Math.min(0.48, leftMinimum / usable);
        const maxRatio = Math.max(0.52, 1 - rightMinimum / usable);

        const rawRatio = stacked
          ? (Math.min(rect.bottom, Math.max(rect.top, moveEvent.clientY)) - rect.top) / span
          : (Math.min(rect.right, Math.max(rect.left, moveEvent.clientX)) - rect.left) / span;

        state.editorDockRatio = Math.min(maxRatio, Math.max(minRatio, rawRatio));
        sessionStorage.setItem("well-editor-dock-ratio", String(state.editorDockRatio));
        applyDockRatio();
        syncPreviewViewport();
      };

      const finish = () => {
        document.body.classList.remove("is-resizing-editor-dock");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    };

    dockResizer.addEventListener("pointerdown", beginDockResize);
  }
  const openPage = document.querySelector("#web-editor-open-page");
  const previewPath = document.querySelector("#web-editor-preview-path");
  const browserUrl = document.querySelector("#web-editor-browser-url");
  const publishButton = document.querySelector("#web-editor-preview-submit");
  const selectedItem = document.querySelector("#editor-selected-item");
  const pickedValue = document.querySelector("#editor-picked-colour-value");
  const pickedSwatch = document.querySelector("#editor-picked-colour-swatch");
  const applyPickedAccent = document.querySelector("#editor-apply-picked-accent");
  const bannerInterval = document.querySelector("#editor-banner-interval");
  const bannerList = document.querySelector("#editor-banner-list");
  const bannerSave = document.querySelector("#editor-banner-save");
  const headerOrderList = document.querySelector("#editor-header-order-list");
  const shortCourseOrderList = document.querySelector("#editor-short-course-order-list");
  const codeInput = document.querySelector("#editor-code-input");
  const codeHighlight = document.querySelector("#editor-code-highlight");

  const codeReady =
    Boolean(codeInput && codeHighlight) &&
    !state.editorCodeLoading &&
    !state.editorCodeSource?.error;

  // Scrolling repositions the overlay in the same frame; edits are coalesced
  // into one paint per frame so key repeat and pastes never queue up work.
  const syncCodeEditorScroll = () => {
    if (codeReady) paintCodeHighlight(codeInput, codeHighlight);
  };

  let codePaintFrame = 0;
  const refreshCodeHighlight = () => {
    if (!codeReady || codePaintFrame) return;
    codePaintFrame = window.requestAnimationFrame(() => {
      codePaintFrame = 0;
      if (codeInput.isConnected) paintCodeHighlight(codeInput, codeHighlight);
    });
  };
  if (codeReady) paintCodeHighlight(codeInput, codeHighlight, { force: true });

  const postCodeSourcePreview = () => {
    if (
      state.editorPreviewMode !== "code" ||
      !frame?.contentWindow
    ) {
      return;
    }

    const source = editorCodeContent();
    if (!source.trim()) return;

    frame.contentWindow.postMessage(
      {
        type: "WCG_EDITOR_SOURCE_PREVIEW",
        source
      },
      frameOrigin()
    );
    state.editorSourcePreviewPosted = true;
  };

  const scheduleCodeSourcePreview = () => {
    if (state.editorCodePreviewTimer) {
      window.clearTimeout(state.editorCodePreviewTimer);
    }
    state.editorCodePreviewTimer = window.setTimeout(() => {
      state.editorCodePreviewTimer = null;
      postCodeSourcePreview();
    }, 480);
  };

  codeInput?.addEventListener("input", () => {
    state.editorCodeDraft = codeInput.value;
    state.editorCodeDirty = state.editorCodeDraft !== state.editorCodeOriginal;
    refreshCodeHighlight();
    scheduleCodeSourcePreview();

    // Only touch surrounding chrome when its state actually changes; a write
    // per keystroke invalidates layout around the (large) textarea.
    const save = document.querySelector("#editor-code-save");
    const canSave = editable && state.editorCodeDirty && !state.editorCodeSaving;
    if (save && save.disabled === canSave) save.disabled = !canSave;

    const meta = document.querySelector(".editor-code-meta small");
    if (meta && state.editorMode === "beta") {
      const status = state.editorCodeDirty
        ? "Unsaved source changes · live preview updates after you pause typing"
        : "beta-main source · editable";
      if (meta.textContent !== status) meta.textContent = status;
    }
  });

  codeInput?.addEventListener("scroll", syncCodeEditorScroll, { passive: true });

  codeInput?.addEventListener("wheel", (event) => {
    const maxTop = Math.max(0, codeInput.scrollHeight - codeInput.clientHeight);
    const maxLeft = Math.max(0, codeInput.scrollWidth - codeInput.clientWidth);
    if (!maxTop && !maxLeft) return;

    const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const beforeTop = codeInput.scrollTop;
    const beforeLeft = codeInput.scrollLeft;

    if (horizontal && maxLeft) {
      codeInput.scrollLeft = Math.min(maxLeft, Math.max(0, codeInput.scrollLeft + event.deltaX + event.deltaY));
    } else if (maxTop) {
      codeInput.scrollTop = Math.min(maxTop, Math.max(0, codeInput.scrollTop + event.deltaY));
    }

    if (
      codeInput.scrollTop !== beforeTop ||
      codeInput.scrollLeft !== beforeLeft
    ) {
      event.preventDefault();
      syncCodeEditorScroll();
    }
  }, { passive: false });

  codeInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !editable) return;
    event.preventDefault();
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    codeInput.setRangeText("  ", start, end, "end");
    codeInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  document.querySelector("#editor-code-save")?.addEventListener("click", saveEditorCodeSource);

  if (pageSelect) pageSelect.value = state.editorPage;

  const navigationTarget =
    state.editorMode === "production" ? "production" : "beta";
  if (
    connected &&
    state.editorNavigationTarget !== navigationTarget &&
    !state.editorNavigationLoading
  ) {
    window.setTimeout(() => loadEditorNavigation({ quiet: true }), 0);
  }

  if (
    connected &&
    state.editorLayoutTarget !== navigationTarget &&
    !state.editorLayoutLoading
  ) {
    window.setTimeout(() => loadEditorLayout({ quiet: true }), 0);
  }

  if (connected && !state.editorAssetsLoaded && !state.editorAssetsLoading) {
    window.setTimeout(() => loadEditorAssets({ quiet: true }), 0);
  }

  if (
    connected &&
    state.editorMode === "beta" &&
    state.editorSharedDraftLoadedSha !== (state.editorStatus?.beta?.sha || "")
  ) {
    window.setTimeout(() => loadSharedEditorDraft({ quiet: true }), 0);
  }

  if (
    connected &&
    state.editorPreviewMode === "code" &&
    !state.editorCodeLoading
  ) {
    const codeTarget = state.editorMode === "production" ? "production" : "beta";
    const expectedCodeKey = `${codeTarget}:${state.editorPage}:${codeTarget === "beta"
      ? state.editorStatus?.beta?.sha || ""
      : state.editorStatus?.main?.sha || ""}`;
    if (state.editorCodeSourceKey !== expectedCodeKey) {
      window.setTimeout(() => loadEditorCodeSource({ quiet: true }), 0);
    }
  }

  // Keep the in-editor canvas on the public website origin. Cloudflare preview
  // deployments can be protected by Access / anti-framing headers, which makes
  // beta-main unreliable inside an iframe. Draft changes are applied locally
  // over this canvas; the real beta deployment remains available through
  // "Open beta review" after the user explicitly publishes.
  const frameOrigin = () => productionPreviewOrigin;

  const reviewOrigin = () =>
    state.editorMode === "beta"
      ? betaPreviewOrigin
      : productionPreviewOrigin;

  const framePageUrl = () =>
    new URL(state.editorPage || "/", frameOrigin()).toString();

  const reviewPageUrl = () =>
    new URL(state.editorPage || "/", reviewOrigin()).toString();

  const iframeUrl = (cacheBust = false) => {
    const url = new URL(framePageUrl());
    url.searchParams.set("wcgEditor", "1");
    if (cacheBust) url.searchParams.set("_preview", String(Date.now()));
    return url.toString();
  };

  const previewViewportForDevice = () => {
    if (state.editorDevice === "mobile") return { width: 390, minHeight: 844 };
    if (state.editorDevice === "tablet") return { width: 820, minHeight: 1024 };
    return { width: 1440, minHeight: 900 };
  };

  const syncPreviewViewport = () => {
    if (!browser || !previewCanvas) return;

    const viewport = previewViewportForDevice();
    const docked =
      previewCanvas.classList.contains("has-code-dock") ||
      previewCanvas.classList.contains("has-devtools-dock");
    const renderedBrowserRect = browser.getBoundingClientRect();
    const availableWidth = docked
      ? Math.max(280, renderedBrowserRect.width)
      : Math.max(280, previewCanvas.clientWidth - 4);
    const availableHeight = docked
      ? Math.max(420, renderedBrowserRect.height)
      : Math.max(420, previewCanvas.clientHeight - 4);
    const scale = Math.min(1, availableWidth / viewport.width);
    const sourceHeight = Math.max(
      viewport.minHeight,
      Math.round(availableHeight / Math.max(scale, 0.1))
    );

    browser.style.width = `${viewport.width}px`;
    browser.style.height = `${sourceHeight}px`;
    browser.style.setProperty("--editor-preview-scale", String(scale));
    browser.dataset.sourceWidth = String(viewport.width);
  };

  const draftPayload = () => currentEditorPreviewPayload();

  const setDirty = () => {
    if (!editable) return;

    storeCurrentEditorDraft();
    state.editorDirty = editorPendingChangeCount() > 0;

    if (publishButton) {
      const count = editorPendingChangeCount();
      publishButton.disabled = count < 1;
      publishButton.textContent = "Publish beta preview";
    }
  };

  const postDraft = () => {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        type: "WCG_EDITOR_PREVIEW",
        payload: draftPayload()
      },
      frameOrigin()
    );
  };

  const requestColours = () => {
    frame?.contentWindow?.postMessage(
      { type: "WCG_EDITOR_SCAN_COLOURS" },
      frameOrigin()
    );
  };

  const requestDevtools = (panel = state.editorDevtoolsTab) => {
    frame?.contentWindow?.postMessage(
      { type: "WCG_EDITOR_DEVTOOLS_REQUEST", panel },
      frameOrigin()
    );
  };

  const renderSelectedItem = () => {
    if (!selectedItem) return;

    const selectedText = state.editorSelectedText;
    const selectedObject = state.editorSelectedObject;

    if (!selectedText && !selectedObject) {
      selectedItem.innerHTML = `
        <div class="editor-selection-empty">
          <strong>Nothing selected</strong>
          <span>${editable
            ? "Move over the website preview and click the item you want to change."
            : "Choose Edit preview above to make changes."}</span>
        </div>
      `;
      return;
    }

    if (selectedText) {
      selectedItem.innerHTML = `
        <div class="editor-selection-summary">
          <span class="editor-selection-type">Text</span>
          <strong>${escapeEditorAttribute(
            String(selectedText.text || "").trim().slice(0, 120) || "Selected text"
          )}</strong>
          <small>${editable
            ? "Type directly on the selected text in the website preview."
            : "This is a read-only view of the live website."}</small>
        </div>
      `;
      return;
    }

    const selector = String(selectedObject.selector || "");
    const tag = String(selectedObject.tag || "").toLowerCase();
    const attributes =
      state.editorAttributeDrafts?.[selector] ||
      selectedObject.attributes ||
      {};

    if (tag === "img") {
      selectedItem.innerHTML = `
        <div class="editor-selection-summary">
          <span class="editor-selection-type">Image</span>
          <strong>Image selected</strong>
          <small>Change the image address or its accessibility description.</small>
        </div>
        <label class="editor-selection-field">
          <span>Image URL</span>
          <input
            type="text"
            data-editor-object-field="src"
            value="${escapeEditorAttribute(attributes.src || "")}"
            ${editable ? "" : "disabled"}
          >
        </label>
        <label class="editor-selection-field">
          <span>Image description</span>
          <input
            type="text"
            data-editor-object-field="alt"
            value="${escapeEditorAttribute(attributes.alt || "")}"
            ${editable ? "" : "disabled"}
          >
        </label>
      `;
    } else {
      selectedItem.innerHTML = `
        <div class="editor-selection-summary">
          <span class="editor-selection-type">Link</span>
          <strong>Link selected</strong>
          <small>Change where this button or link sends visitors.</small>
        </div>
        <label class="editor-selection-field">
          <span>Link destination</span>
          <select
            data-editor-object-field="href"
            ${editable ? "" : "disabled"}
          >
            ${editorLinkDestinationOptions(attributes.href || "")}
          </select>
          <small class="editor-selection-field-hint">Choose a Well College page. The link updates instantly in the live draft.</small>
        </label>
      `;
    }

    selectedItem.querySelectorAll("[data-editor-object-field]").forEach((input) => {
      input.addEventListener("focus", () => {
        if (!input.dataset.historyCaptured) {
          recordEditorHistory();
          input.dataset.historyCaptured = "1";
        }
      });

      const applyObjectFieldChange = () => {
        if (!editable || !selector) return;

        const field = input.dataset.editorObjectField;
        state.editorAttributeDrafts = {
          ...state.editorAttributeDrafts,
          [selector]: {
            ...(state.editorAttributeDrafts[selector] || selectedObject.attributes || {}),
            [field]: String(input.value || "").slice(0, 2000)
          }
        };

        state.editorSelectedObject = {
          ...selectedObject,
          attributes: {
            ...(selectedObject.attributes || {}),
            ...(state.editorAttributeDrafts[selector] || {})
          }
        };

        setDirty();
        postDraft();
      };

      input.addEventListener("input", applyObjectFieldChange);
      if (input.tagName === "SELECT") {
        input.addEventListener("change", applyObjectFieldChange);
      }
    });
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
        ? `${colours.length} found`
        : "No colours found";
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
    const frameUrl = framePageUrl();
    const reviewUrl = reviewPageUrl();
    const parsed = new URL(frameUrl);
    const display =
      state.editorMode === "beta"
        ? `Browser preview · ${parsed.pathname || "/"}`
        : parsed.hostname + parsed.pathname;

    if (openPage) {
      const label =
        state.editorMode === "beta"
          ? "Open the beta review site in a new tab"
          : "Open the live page in a new tab";
      openPage.hidden = false;
      openPage.href = reviewUrl;
      openPage.title = label;
      openPage.setAttribute("aria-label", label);
    }
    if (previewPath) previewPath.textContent = display;
    if (browserUrl) browserUrl.textContent = display;
    if (reload && frame) {
      frame.dataset.frameKey = frameKey;
      state.editorSourcePreviewPosted = false;
      frame.src = iframeUrl(cacheBust);
    }
  };

  syncPreviewViewport();
  if (previewCanvas && typeof ResizeObserver !== "undefined") {
    state.editorPreviewResizeObserver = new ResizeObserver(syncPreviewViewport);
    state.editorPreviewResizeObserver.observe(previewCanvas);
  } else {
    state.editorPreviewResizeHandler = syncPreviewViewport;
    window.addEventListener("resize", syncPreviewViewport, { passive: true });
  }

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
        frame?.contentWindow?.postMessage(
          { type: "WCG_EDITOR_TOOL", tool: state.editorTool },
          frameOrigin()
        );
        if (state.editorPreviewMode === "devtools") {
          requestDevtools();
        }
      }, 30);
      return;
    }

    if (event.data.type === "WCG_EDITOR_DEVTOOLS_DATA") {
      state.editorDevtoolsData = {
        ...event.data,
        type: undefined
      };
      renderEditorDevtoolsDock();
      return;
    }

    if (event.data.type === "WCG_EDITOR_COLOURS") {
      state.editorColours = Array.isArray(event.data.colours)
        ? event.data.colours
        : [];
      renderColours();
      return;
    }

    if (event.data.type === "WCG_EDITOR_NAVIGATION_ORDER" && editable) {
      const kind = String(event.data.kind || "");
      const order = Array.isArray(event.data.order)
        ? event.data.order.map((item) => String(item || ""))
        : [];

      if (
        kind === "header" &&
        sameStringSet(order, Object.keys(EDITOR_HEADER_NAV_LABELS))
      ) {
        state.editorNavigationHeaderOrder = [...order];
      } else if (
        kind === "groups" &&
        sameStringSet(order, EDITOR_SHORT_COURSE_GROUPS)
      ) {
        state.editorNavigationGroupOrder = [...order];
      } else {
        return;
      }

      state.editorNavigationDirty = true;
      state.editorDirty = editorPendingChangeCount() > 0;

      const list =
        kind === "header"
          ? document.querySelector("#editor-header-order-list")
          : document.querySelector("#editor-short-course-order-list");

      if (list) {
        const nodes = new Map(
          [...list.querySelectorAll("[data-editor-nav-key]")].map((node) => [
            String(node.dataset.editorNavKey || ""),
            node
          ])
        );
        for (const key of order) {
          const node = nodes.get(key);
          if (node) list.appendChild(node);
        }
      }

      const save = document.querySelector("#editor-navigation-save");
      if (save) save.textContent = "Staged · publish top right";

      const publish = document.querySelector("#web-editor-preview-submit");
      if (publish) publish.disabled = false;
      postDraft();
      return;
    }

    if (event.data.type === "WCG_EDITOR_LAYOUT_ORDER" && editable) {
      const scope = String(event.data.scope || "");
      const order = Array.isArray(event.data.order)
        ? event.data.order.map((item) => String(item || ""))
        : [];
      const baseline = state.editorLayoutOrders?.[scope];

      if (!scope || !Array.isArray(baseline) || !sameStringSet(order, baseline)) {
        return;
      }

      state.editorLayoutOrders = {
        ...state.editorLayoutOrders,
        [scope]: [...order]
      };
      state.editorLayoutDirty = true;
      state.editorDirty = editorPendingChangeCount() > 0;

      const publish = document.querySelector("#web-editor-preview-submit");
      if (publish) publish.disabled = false;
      postDraft();
      return;
    }

    if (event.data.type === "WCG_EDITOR_ELEMENTS_CHANGE" && editable) {
      recordEditorHistory();
      state.editorElementDrafts = cloneEditorElementDrafts(event.data.elements);
      storeCurrentEditorDraft();
      state.editorDirty = editorPendingChangeCount() > 0;
      const publish = document.querySelector("#web-editor-preview-submit");
      if (publish) publish.disabled = false;
      return;
    }

    if (event.data.type === "WCG_EDITOR_TOOL_CHANGED") {
      state.editorTool = ["text-box", "view"].includes(event.data.tool)
        ? event.data.tool
        : "select";

      const isView = state.editorTool === "view";

      document.querySelectorAll("[data-editor-interaction]").forEach((item) => {
        item.classList.toggle(
          "is-active",
          isView
            ? item.dataset.editorInteraction === "view"
            : item.dataset.editorInteraction === "edit"
        );
      });

      const palette = document.querySelector(".editor-tool-toolbar");
      palette?.classList.toggle("is-collapsed", isView);
      palette?.classList.toggle("is-expanded", !isView);

      document.querySelectorAll("[data-editor-tool]").forEach((button) => {
        button.classList.toggle(
          "is-active",
          !isView && button.dataset.editorTool === state.editorTool
        );
      });
      return;
    }

    if (event.data.type === "WCG_EDITOR_OPEN_ASSET_UPLOAD" && editable) {
      state.editorAssetUploadTargetSelector = String(event.data.selector || "");
      const input = document.querySelector("#editor-assets-input");
      if (input instanceof HTMLInputElement) {
        input.value = "";
        input.click();
      }
      return;
    }

    if (event.data.type === "WCG_EDITOR_TEXT_SELECTED") {
      state.editorSelectedObject = null;
      state.editorSelectedText = {
        selector: String(event.data.selector || ""),
        text: String(event.data.text || ""),
        tag: String(event.data.tag || ""),
        sourceHint:
          event.data.sourceHint && typeof event.data.sourceHint === "object"
            ? { ...event.data.sourceHint }
            : null
      };
      renderSelectedItem();
      if (state.editorPreviewMode === "code") {
        revealCodeSelection(state.editorSelectedText.sourceHint);
      }
      if (state.editorPreviewMode === "devtools") requestDevtools();
      return;
    }

    if (event.data.type === "WCG_EDITOR_OBJECT_SELECTED") {
      state.editorSelectedText = null;
      state.editorSelectedObject = {
        selector: String(event.data.selector || ""),
        tag: String(event.data.tag || ""),
        selectionKind: String(event.data.selectionKind || "object"),
        attributes:
          event.data.attributes && typeof event.data.attributes === "object"
            ? { ...event.data.attributes }
            : {},
        sourceHint:
          event.data.sourceHint && typeof event.data.sourceHint === "object"
            ? { ...event.data.sourceHint }
            : null
      };
      renderSelectedItem();
      if (state.editorPreviewMode === "code") {
        revealCodeSelection(state.editorSelectedObject.sourceHint);
      }
      if (state.editorPreviewMode === "devtools") requestDevtools();
      return;
    }

    if (event.data.type === "WCG_EDITOR_ATTRIBUTE_CHANGE" && editable) {
      const selector = String(event.data.selector || "");
      const field = String(event.data.field || "");
      const value = String(event.data.value || "").slice(0, 2000);
      if (!selector || !["src", "alt", "href"].includes(field)) return;

      recordEditorHistory();
      state.editorAttributeDrafts = {
        ...state.editorAttributeDrafts,
        [selector]: {
          ...(state.editorAttributeDrafts[selector] || {}),
          [field]: value
        }
      };
      storeCurrentEditorDraft();
      state.editorDirty = editorPendingChangeCount() > 0;

      const publish = document.querySelector("#web-editor-preview-submit");
      if (publish) publish.disabled = false;
      return;
    }

    if (event.data.type === "WCG_EDITOR_STYLE_CHANGE" && editable) {
      const selector = String(event.data.selector || "");
      const styles =
        event.data.styles &&
        typeof event.data.styles === "object" &&
        !Array.isArray(event.data.styles)
          ? event.data.styles
          : {};
      if (!selector) return;

      const allowed = new Set([
        "backgroundColor",
        "color",
        "minHeight",
        "width",
        "height",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderRadius",
        "objectFit"
      ]);
      const nextStyles = {};
      for (const [name, value] of Object.entries(styles)) {
        if (!allowed.has(name)) continue;
        nextStyles[name] = String(value || "").slice(0, 40);
      }
      if (!Object.keys(nextStyles).length) return;

      recordEditorHistory();
      state.editorStyleDrafts = {
        ...state.editorStyleDrafts,
        [selector]: {
          ...(state.editorStyleDrafts[selector] || {}),
          ...nextStyles
        }
      };
      storeCurrentEditorDraft();
      state.editorDirty = editorPendingChangeCount() > 0;

      const publish = document.querySelector("#web-editor-preview-submit");
      if (publish) publish.disabled = false;
      return;
    }

    if (event.data.type === "WCG_EDITOR_DOM_ORDER" && editable) {
      const parentSelector = String(event.data.parentSelector || "");
      const childSelectors = Array.isArray(event.data.childSelectors)
        ? event.data.childSelectors.map((item) => String(item || "")).filter(Boolean)
        : [];

      if (!parentSelector || childSelectors.length < 2) return;

      recordEditorHistory();
      state.editorOrderDrafts = {
        ...state.editorOrderDrafts,
        [parentSelector]: childSelectors
      };
      storeCurrentEditorDraft();
      state.editorDirty = editorPendingChangeCount() > 0;

      const publish = document.querySelector("#web-editor-preview-submit");
      if (publish) publish.disabled = false;
      return;
    }

    if (event.data.type === "WCG_EDITOR_TEXT_CHANGE" && editable) {
      const selector = String(event.data.selector || "");
      const text = String(event.data.text || "").slice(0, 4000);
      if (!selector) return;

      recordEditorHistory();

      state.editorTextDrafts = {
        ...state.editorTextDrafts,
        [selector]: text
      };
      state.editorSelectedObject = null;
      state.editorSelectedText = {
        selector,
        text,
        tag: String(event.data.tag || "")
      };
      setDirty();
      renderSelectedItem();
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
      state.editorTool = next === "production" ? "view" : "select";
      state.editorDirty =
        next === "beta" && editorPendingChangeCount() > 0;
      state.editorDraftKey = "";
      state.editorColours = [];
      state.editorSelectedText = null;
      state.editorSelectedObject = null;
      state.editorBannerTarget = next === "production" ? "production" : "beta";
      state.editorBannerDirty = false;
      state.editorBannerKey = "";
      state.editorBannerOpenId = "";
      state.editorNavigationTarget = "";
      state.editorNavigationHeaderOrder = [];
      state.editorNavigationGroupOrder = [];
      state.editorNavigationDirty = false;
      state.editorNavigationDrag = null;
      state.editorLayoutTarget = "";
      state.editorLayoutOrders = {};
      state.editorLayoutDirty = false;
      state.editorAssetsLoaded = false;
      state.editorAssets = [];
      state.editorCodeSource = null;
      state.editorCodeSourceKey = "";
      state.editorCodeDraft = "";
      state.editorCodeOriginal = "";
      state.editorCodeDirty = false;
      if (next !== "beta") state.editorAssetDrafts = [];
      renderWebEditor();
    });
  });

  pageSelect?.addEventListener("change", () => {
    state.editorPage = pageSelect.value || "/";
    state.editorDirty =
      state.editorMode === "beta" && editorPendingChangeCount() > 0;
    state.editorDraftKey = "";
    state.editorColours = [];
    state.editorSelectedText = null;
    state.editorSelectedObject = null;
    state.editorCodeSource = null;
    state.editorCodeSourceKey = "";
    state.editorCodeDraft = "";
    state.editorCodeOriginal = "";
    state.editorCodeDirty = false;
    renderWebEditor();
  });

  bindEditorNavigationSortable(
    headerOrderList,
    "header",
    editable
  );
  bindEditorNavigationSortable(
    shortCourseOrderList,
    "groups",
    editable
  );
  document.querySelector("#editor-navigation-save")
    ?.addEventListener("click", saveEditorNavigationOrder);

    bannerInterval?.addEventListener("change", () => {
    state.editorBannerInterval = Number(bannerInterval.value || 5200);
    state.editorBannerDirty = true;
    state.editorDirty = editorPendingChangeCount() > 0;
    postDraft();
    const publish = document.querySelector("#web-editor-preview-submit");
    if (publish) publish.disabled = false;
    if (bannerSave) bannerSave.textContent = "Staged · publish top right";
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
    state.editorDirty = editorPendingChangeCount() > 0;
    postDraft();
    const publish = document.querySelector("#web-editor-preview-submit");
    if (publish) publish.disabled = false;
    if (bannerSave) bannerSave.textContent = "Staged · publish top right";
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
      copy.textContent = `“${item.message}” will be removed from the ${state.editorMode === "production" ? "live website" : "preview website"} when you confirm.`;
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
    state.editorDirty = editorPendingChangeCount() > 0;
    renderWebEditor();
    window.setTimeout(postDraft, 30);
  });

  bannerSave?.addEventListener("click", publishEditorBanner);

  if (frame) frame.onload = () => {
    window.setTimeout(() => {
      postDraft();
      frame?.contentWindow?.postMessage(
        { type: "WCG_EDITOR_TOOL", tool: state.editorTool },
        frameOrigin()
      );
      if (state.editorPreviewMode === "code") {
        postCodeSourcePreview();
      }
      requestColours();
    }, 80);
  };

  document.querySelector("#editor-history-toggle")?.addEventListener("click", () => {
    state.editorHistoryOpen = !state.editorHistoryOpen;
    renderWebEditor();
    if (
      state.editorHistoryOpen &&
      !state.editorVersionHistory.length &&
      !state.editorHistoryLoading
    ) {
      window.setTimeout(() => loadEditorVersionHistory({ quiet: true }), 0);
    }
  });

  document.querySelector(".editor-version-list")?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-editor-restore-sha]");
    const sha = String(button?.dataset?.editorRestoreSha || "");
    if (sha) stageEditorProductionRestore(sha);
  });

  document.querySelector("#editor-assets-input")?.addEventListener("change", async (event) => {
    const input = event.target;
    const before = state.editorAssetDrafts.length;
    const targetSelector = state.editorAssetUploadTargetSelector;
    await stageEditorAssetFiles(input?.files);

    const staged = state.editorAssetDrafts.slice(before);
    const firstImage = staged.find((asset) => asset.kind === "image");

    if (targetSelector && firstImage) {
      recordEditorHistory();
      const srcValue = `/${firstImage.path}`;
      state.editorAttributeDrafts = {
        ...state.editorAttributeDrafts,
        [targetSelector]: {
          ...(state.editorAttributeDrafts[targetSelector] || {}),
          src: srcValue
        }
      };
      storeCurrentEditorDraft();

      if (state.editorSelectedObject?.selector === targetSelector) {
        state.editorSelectedObject = {
          ...state.editorSelectedObject,
          attributes: {
            ...(state.editorSelectedObject.attributes || {}),
            src: srcValue
          }
        };
      }

      state.editorDirty = editorPendingChangeCount() > 0;
      document.querySelector("#web-editor-preview-submit")?.removeAttribute("disabled");

      frame?.contentWindow?.postMessage(
        {
          type: "WCG_EDITOR_APPLY_IMAGE",
          selector: targetSelector,
          src: srcValue
        },
        frameOrigin()
      );
    }

    state.editorAssetUploadTargetSelector = "";
    if (input instanceof HTMLInputElement) input.value = "";
  });

  document.querySelector("#editor-assets-grid")?.addEventListener("click", async (event) => {
    const copyButton = event.target?.closest?.("[data-editor-asset-copy]");
    if (copyButton) {
      const link = String(copyButton.dataset.editorAssetCopy || "");
      try {
        await navigator.clipboard.writeText(link);
        showToast("Asset link copied.");
      } catch {
        showToast(link);
      }
      return;
    }

    const useButton = event.target?.closest?.("[data-editor-asset-use]");
    if (!useButton || state.editorSelectedObject?.tag !== "img") return;

    const selector = String(state.editorSelectedObject.selector || "");
    const src = String(useButton.dataset.editorAssetUse || "");
    if (!selector || !src) return;

    recordEditorHistory();
    state.editorAttributeDrafts = {
      ...state.editorAttributeDrafts,
      [selector]: {
        ...(state.editorAttributeDrafts[selector] || state.editorSelectedObject.attributes || {}),
        src
      }
    };
    state.editorSelectedObject = {
      ...state.editorSelectedObject,
      attributes: {
        ...(state.editorSelectedObject.attributes || {}),
        src
      }
    };
    setDirty();
    postDraft();
    renderSelectedItem();
    showToast("Asset applied to the live draft.");
  });

  document.querySelectorAll("[data-editor-preview-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const requested = button.dataset.editorPreviewMode;
      const mode = ["visual", "code"].includes(requested)
        ? requested
        : "visual";
      if (mode === state.editorPreviewMode) return;
      state.editorPreviewMode = mode;
      renderWebEditor();
      if (mode === "code") {
        window.setTimeout(() => loadEditorCodeSource({ quiet: true }), 0);
      }
    });
  });

  document.querySelectorAll("[data-editor-devtools-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.editorDevtoolsTab;
      state.editorDevtoolsTab = ["elements", "styles", "console"].includes(tab)
        ? tab
        : "elements";
      state.editorDevtoolsData = null;
      renderEditorDevtoolsDock();
      requestDevtools();
    });
  });

  document.querySelector("#editor-devtools-refresh")?.addEventListener("click", () => {
    requestDevtools();
  });

  document.querySelector("#editor-devtools-clear")?.addEventListener("click", () => {
    frame?.contentWindow?.postMessage(
      { type: "WCG_EDITOR_DEVTOOLS_CLEAR_CONSOLE" },
      frameOrigin()
    );
  });

  document.querySelectorAll("[data-editor-device]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editorDevice = button.dataset.editorDevice || "desktop";
      if (browser) browser.dataset.device = state.editorDevice;

      document.querySelectorAll("[data-editor-device]").forEach((item) => {
        const active = item.dataset.editorDevice === state.editorDevice;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      syncPreviewViewport();
    });
  });

  document.querySelectorAll("[data-editor-interaction]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextMode =
        button.dataset.editorInteraction === "view" ? "view" : "edit";

      // View is always available. Edit is always clickable on a connected
      // BETA workspace. If beta-main is behind main, sync it first instead
      // of dead-disabling the Edit button.
      if (nextMode === "edit" && !canEnterEdit) return;

      if (nextMode === "edit" && betaBehind) {
        state.editorTool = "select";
        showToast("Updating the beta preview before editing…");
        await syncWebEditorBeta();
        return;
      }

      state.editorTool = nextMode === "view" ? "view" : "select";

      document.querySelectorAll("[data-editor-interaction]").forEach((item) => {
        item.classList.toggle(
          "is-active",
          nextMode === "view"
            ? item.dataset.editorInteraction === "view"
            : item.dataset.editorInteraction === "edit"
        );
      });

      const palette = document.querySelector(".editor-tool-toolbar");
      palette?.classList.toggle("is-collapsed", nextMode === "view");
      palette?.classList.toggle("is-expanded", nextMode !== "view");

      document.querySelectorAll("[data-editor-tool]").forEach((item) => {
        item.classList.remove("is-active");
      });

      // Clear stale editor selection state when entering navigation mode.
      if (nextMode === "view") {
        state.editorSelectedText = null;
        state.editorSelectedObject = null;
        renderSelectedItem();
      }

      frame?.contentWindow?.postMessage(
        { type: "WCG_EDITOR_TOOL", tool: state.editorTool },
        frameOrigin()
      );
    });
  });

  document.querySelectorAll("[data-editor-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!editable) return;
      state.editorTool = button.dataset.editorTool === "text-box" ? "text-box" : "select";
      document.querySelectorAll("[data-editor-interaction]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.editorInteraction === "edit");
      });
      document.querySelector(".editor-tool-toolbar")?.classList.remove("is-collapsed");
      document.querySelector(".editor-tool-toolbar")?.classList.add("is-expanded");
      document.querySelectorAll("[data-editor-tool]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.editorTool === state.editorTool);
      });
      frame?.contentWindow?.postMessage(
        { type: "WCG_EDITOR_TOOL", tool: state.editorTool },
        frameOrigin()
      );
    });
  });

  document.querySelector("#web-editor-refresh")?.addEventListener("click", () => {
    if (state.editorPreviewMode === "code") {
      if (
        state.editorCodeDirty &&
        !window.confirm("Discard unsaved HTML changes and reload the current source?")
      ) {
        return;
      }

      state.editorCodeSource = null;
      state.editorCodeSourceKey = "";
      state.editorCodeDraft = "";
      state.editorCodeOriginal = "";
      state.editorCodeDirty = false;
      // The preview is showing the discarded source; load the real page again.
      if (state.editorSourcePreviewPosted) state.editorFrameReloadRequested = true;
      loadEditorCodeSource({ force: true });
      return;
    }

    if (frame) {
      state.editorSourcePreviewPosted = false;
      frame.src = iframeUrl(true);
    }
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
    recordEditorHistory();
    state.editorAccentDraft = state.editorPickedColour.toUpperCase();
    setDirty();
    postDraft();
    window.setTimeout(requestColours, 40);
  });

  document.querySelector("#web-editor-discard")?.addEventListener("click", () => {
    if (state.editorMode !== "beta") return;
    if (!state.editorPendingPages?.[state.editorPage]) {
      showToast("This page has no unpublished changes.");
      return;
    }
    if (!window.confirm("Discard all unpublished changes on this page? This cannot be undone.")) {
      return;
    }

    const deployed = editorPageConfig("beta", state.editorPage);
    applyEditorDraftSnapshot(editorDraftFromConfig(deployed));

    const nextPending = { ...state.editorPendingPages };
    delete nextPending[state.editorPage];
    state.editorPendingPages = nextPending;

    state.editorHistory = state.editorHistory.filter(
      (entry) => entry?.pagePath !== state.editorPage
    );
    state.editorFuture = state.editorFuture.filter(
      (entry) => entry?.pagePath !== state.editorPage
    );

    state.editorDirty = editorPendingChangeCount() > 0;
    scheduleSharedEditorDraft();
    state.editorSelectedText = null;
    state.editorSelectedObject = null;

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

    renderSelectedItem();

    if (publishButton) {
      const count = editorPendingChangeCount();
      publishButton.disabled = count < 1;
      publishButton.textContent = "Publish beta preview";
    }

    showToast("Changes for this page were discarded.");
  });

  publishButton?.addEventListener("click", () => {
    if (!editable || editorPendingChangeCount() < 1) return;

    if (
      Object.keys(state.editorTextDrafts || {}).length ||
      Object.keys(state.editorAttributeDrafts || {}).length ||
      Object.keys(state.editorStyleDrafts || {}).length ||
      Object.keys(state.editorOrderDrafts || {}).length ||
      state.editorElementDrafts.length ||
      state.editorHeadingDraft ||
      state.editorCopyDraft ||
      state.editorAccentDraft ||
      state.editorFontDraft
    ) {
      storeCurrentEditorDraft();
    }

    publishWebEditorDraft({
      pages: { ...state.editorPendingPages },
      navigation: {
        headerOrder: [...state.editorNavigationHeaderOrder],
        shortCourseGroupOrder: [...state.editorNavigationGroupOrder]
      },
      layoutOrders: Object.fromEntries(
        Object.entries(state.editorLayoutOrders || {}).map(([scope, order]) => [
          scope,
          Array.isArray(order) ? [...order] : []
        ])
      ),
      banner: {
        intervalMs: Number(state.editorBannerInterval || 5200),
        items: state.editorBannerItems.map((item) => ({ ...item }))
      },
      assets: state.editorAssetDrafts.map((asset) => ({
        path: asset.path,
        contentBase64: asset.contentBase64,
        size: asset.size
      }))
    });
  });

  document.querySelector("#web-editor-undo")?.addEventListener("click", () => {
    if (!undoEditorDraft()) return;
    state.editorSelectedText = null;
    state.editorSelectedObject = null;
    postDraft();
    renderSelectedItem();
    showToast("Last change undone.");
  });

  document.querySelector("#web-editor-redo")?.addEventListener("click", () => {
    if (!redoEditorDraft()) return;
    state.editorSelectedText = null;
    state.editorSelectedObject = null;
    postDraft();
    renderSelectedItem();
    showToast("Change reapplied.");
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

  renderSelectedItem();
  renderColours();
  updatePreviewLocation({ reload: !reusedFrame });

  if (reusedFrame) {
    // Bring the already-loaded website in line with any state that changed.
    postDraft();
    frame?.contentWindow?.postMessage(
      { type: "WCG_EDITOR_TOOL", tool: state.editorTool },
      frameOrigin()
    );
    // A render cancels the pending debounced source preview; re-queue it so
    // unsaved HTML keeps showing in the kept preview.
    if (state.editorPreviewMode === "code" && state.editorCodeDirty) {
      scheduleCodeSourcePreview();
    }
  }

  document.dispatchEvent(
    new CustomEvent("wcg:editor-rendered", { detail: { reusedFrame } })
  );

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

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (Math.abs(number) < 10000) return formatNumber(Math.round(number));
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(number);
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

function formatShare(value, total) {
  const share = total > 0 ? (Number(value || 0) / total) * 100 : 0;
  if (share <= 0) return "0%";
  if (share < 1) return "<1%";
  return `${Math.round(share)}%`;
}

const ANALYTICS_RANGES = [7, 30, 90];
const ANALYTICS_REFRESH_MS = 60000;
const ANALYTICS_LIST_LIMIT = 8;
let analyticsPageNameCache = null;
let analyticsRegionNames;

function analyticsPageNames() {
  if (analyticsPageNameCache) return analyticsPageNameCache;

  const names = new Map([["/", "Home"], ["/index.html", "Home"]]);
  const add = (path, label) => {
    if (!path || !label || names.has(path)) return;
    names.set(path, label);
    // Cloudflare can report either the .html file or its pretty URL.
    if (path.endsWith(".html")) names.set(path.slice(0, -5), label);
  };

  for (const [href, label] of EDITOR_LINK_DESTINATIONS) {
    if (!href.includes("#")) add(`/${href}`, label);
  }
  for (const section of Object.values(SUPPORT_PAGE_CATALOG)) {
    for (const [label, path] of section.items || []) add(path, label);
  }

  analyticsPageNameCache = names;
  return names;
}

function analyticsPageName(path) {
  const raw = String(path || "/").split(/[?#]/)[0] || "/";
  const clean = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  const names = analyticsPageNames();
  if (names.has(clean)) return names.get(clean);

  const slug = clean.split("/").filter(Boolean).pop() || "";
  const words = slug.replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
  return words ? words.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Home";
}

function analyticsCountry(value) {
  const raw = String(value || "").trim();
  if (!/^[A-Za-z]{2}$/.test(raw)) return { name: raw || "Unknown", flag: "" };

  const code = raw.toUpperCase();
  if (analyticsRegionNames === undefined) {
    try {
      analyticsRegionNames = new Intl.DisplayNames(undefined, { type: "region" });
    } catch {
      analyticsRegionNames = null;
    }
  }

  let name = code;
  try {
    name = analyticsRegionNames?.of(code) || code;
  } catch {
    // Unknown region codes fall back to the raw code.
  }
  return { name, flag: countryFlagEmoji(code) };
}

function capitalise(value) {
  return String(value || "").replace(/^./, (letter) => letter.toUpperCase());
}

function analyticsDateLabel(value, { weekday = false } = {}) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat(undefined, {
    ...(weekday ? { weekday: "short" } : { month: "short" }),
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function analyticsLongDateLabel(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function normaliseAnalyticsDaily(rows, days) {
  const lookup = new Map(
    (rows || []).map((row) => [String(row?.date || ""), row])
  );
  const values = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  for (let offset = Math.max(0, Number(days || 30) - 1); offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    const row = lookup.get(key) || {};
    const visits = Number(row.visits ?? row.visitors ?? 0);
    const views = Number(row.views ?? 0);

    values.push({
      date: key,
      visits,
      views,
      pagesPerVisit: visits > 0 ? views / visits : 0
    });
  }

  return values;
}

function createSvgElement(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  return node;
}

function analyticsNiceTicks(max, count = 4) {
  const safeMax = Math.max(1, Number(max || 0));
  const rough = safeMax / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const top = Math.ceil(safeMax / step) * step;
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
  return ticks;
}

function linePath(points) {
  return points
    .map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
}

function renderAnalyticsSparkline(svg, values) {
  if (!svg) return;
  svg.replaceChildren();
  const data = values.map((value) => Math.max(0, Number(value || 0)));
  if (data.length < 2 || !data.some(Boolean)) return;

  const width = 100;
  const height = 28;
  const max = Math.max(...data, 1);
  const points = data.map((value, index) => [
    (index / (data.length - 1)) * width,
    height - 2 - (value / max) * (height - 4)
  ]);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.appendChild(createSvgElement("path", {
    d: linePath(points),
    class: "analytics-spark-line",
    "vector-effect": "non-scaling-stroke"
  }));
}

function renderAnalyticsTrend(container, rows) {
  if (!container) return;
  container.replaceChildren();

  const hasData = rows.some((row) => row.visits > 0 || row.views > 0);
  if (!rows.length || !hasData) {
    const empty = document.createElement("div");
    empty.className = "analytics-empty";
    empty.textContent = state.analyticsLoading
      ? "Loading traffic…"
      : "No traffic recorded for this period yet.";
    container.appendChild(empty);
    return;
  }

  const width = Math.max(280, Math.round(container.clientWidth || 640));
  const narrow = width < 560;
  const height = narrow ? 220 : 280;
  const max = Math.max(...rows.map((row) => Math.max(row.visits, row.views)), 1);
  const ticks = analyticsNiceTicks(max, narrow ? 3 : 4);
  const top = ticks[ticks.length - 1];
  const tickLabels = ticks.map((tick) => formatCompactNumber(tick));
  const margin = {
    top: 14,
    right: narrow ? 12 : 86,
    bottom: 30,
    left: Math.max(...tickLabels.map((label) => label.length)) * 7 + 14
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const baseline = margin.top + plotHeight;
  const xAt = (index) => margin.left + (rows.length === 1
    ? plotWidth / 2
    : (index / (rows.length - 1)) * plotWidth);
  const yAt = (value) => margin.top + plotHeight - (value / top) * plotHeight;

  const totals = rows.reduce(
    (sum, row) => ({ visits: sum.visits + row.visits, views: sum.views + row.views }),
    { visits: 0, views: 0 }
  );

  const svg = createSvgElement("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    tabindex: "0",
    "aria-label": `Daily traffic from ${analyticsLongDateLabel(rows[0].date)} to ${analyticsLongDateLabel(rows[rows.length - 1].date)}: ${formatNumber(totals.visits)} visits and ${formatNumber(totals.views)} page views. Use the left and right arrow keys to read each day, or open the table below.`
  });
  svg.classList.add("analytics-trend-svg");

  ticks.forEach((tick, index) => {
    const y = yAt(tick);
    svg.appendChild(createSvgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: y,
      y2: y,
      class: index === 0 ? "analytics-axis-line" : "analytics-grid-line"
    }));
    const label = createSvgElement("text", {
      x: margin.left - 10,
      y: y + 4,
      "text-anchor": "end",
      class: "analytics-axis-label"
    });
    label.textContent = tickLabels[index];
    svg.appendChild(label);
  });

  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 86))));
  const weekday = rows.length <= 7;
  for (let index = rows.length - 1; index >= 0; index -= labelEvery) {
    const x = xAt(index);
    const anchor = x - margin.left < 24 ? "start" : width - margin.right - x < 24 ? "end" : "middle";
    const label = createSvgElement("text", {
      x,
      y: height - 9,
      "text-anchor": anchor,
      class: "analytics-axis-label"
    });
    label.textContent = analyticsDateLabel(rows[index].date, { weekday });
    svg.appendChild(label);
  }

  const visitPoints = rows.map((row, index) => [xAt(index), yAt(row.visits)]);
  const viewPoints = rows.map((row, index) => [xAt(index), yAt(row.views)]);

  svg.appendChild(createSvgElement("path", {
    d: `${linePath(visitPoints)} L${visitPoints[visitPoints.length - 1][0].toFixed(1)} ${baseline} L${visitPoints[0][0].toFixed(1)} ${baseline} Z`,
    class: "analytics-area is-visits"
  }));
  svg.appendChild(createSvgElement("path", { d: linePath(viewPoints), class: "analytics-line is-views" }));
  svg.appendChild(createSvgElement("path", { d: linePath(visitPoints), class: "analytics-line is-visits" }));

  const last = rows.length - 1;
  for (const [points, series] of [[viewPoints, "views"], [visitPoints, "visits"]]) {
    svg.appendChild(createSvgElement("circle", {
      cx: points[last][0],
      cy: points[last][1],
      r: 4,
      class: `analytics-dot is-${series}`
    }));
  }

  // Direct end labels only when the two series finish far enough apart.
  if (!narrow && Math.abs(viewPoints[last][1] - visitPoints[last][1]) >= 16) {
    for (const [points, text] of [[viewPoints, "Page views"], [visitPoints, "Visits"]]) {
      const label = createSvgElement("text", {
        x: points[last][0] + 10,
        y: points[last][1] + 4,
        class: "analytics-end-label"
      });
      label.textContent = text;
      svg.appendChild(label);
    }
  }

  const crosshair = createSvgElement("line", {
    y1: margin.top,
    y2: baseline,
    class: "analytics-crosshair"
  });
  const focusViews = createSvgElement("circle", { r: 4.5, class: "analytics-dot is-views is-focus" });
  const focusVisits = createSvgElement("circle", { r: 4.5, class: "analytics-dot is-visits is-focus" });
  const hover = createSvgElement("g", { class: "analytics-hover", visibility: "hidden" });
  hover.append(crosshair, focusViews, focusVisits);
  svg.appendChild(hover);

  const hitArea = createSvgElement("rect", {
    x: margin.left - 6,
    y: margin.top,
    width: plotWidth + 12,
    height: plotHeight,
    class: "analytics-hit-area"
  });
  svg.appendChild(hitArea);

  const tooltip = document.createElement("div");
  tooltip.className = "analytics-tooltip";
  tooltip.hidden = true;

  const tooltipDate = document.createElement("strong");
  tooltipDate.className = "analytics-tooltip-date";
  tooltip.appendChild(tooltipDate);

  const tooltipRows = [
    ["visits", "Visits"],
    ["views", "Page views"],
    ["ratio", "Pages / visit"]
  ].map(([key, text]) => {
    const row = document.createElement("div");
    row.className = `analytics-tooltip-row is-${key}`;
    const keyMark = document.createElement("i");
    keyMark.setAttribute("aria-hidden", "true");
    const value = document.createElement("b");
    const label = document.createElement("span");
    label.textContent = text;
    row.append(keyMark, value, label);
    tooltip.appendChild(row);
    return value;
  });

  let activeIndex = -1;

  const showIndex = (index) => {
    activeIndex = Math.min(rows.length - 1, Math.max(0, index));
    const row = rows[activeIndex];
    const x = xAt(activeIndex);
    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    focusViews.setAttribute("cx", x);
    focusViews.setAttribute("cy", viewPoints[activeIndex][1]);
    focusVisits.setAttribute("cx", x);
    focusVisits.setAttribute("cy", visitPoints[activeIndex][1]);
    hover.setAttribute("visibility", "visible");

    tooltipDate.textContent = analyticsLongDateLabel(row.date);
    tooltipRows[0].textContent = formatNumber(row.visits);
    tooltipRows[1].textContent = formatNumber(row.views);
    tooltipRows[2].textContent = row.visits > 0 ? formatDecimal(row.pagesPerVisit) : "—";
    tooltip.hidden = false;

    const tipWidth = tooltip.offsetWidth || 170;
    const left = x + 14 + tipWidth > width ? x - 14 - tipWidth : x + 14;
    tooltip.style.transform = `translate(${Math.max(0, left)}px, ${margin.top}px)`;
  };

  const hide = () => {
    activeIndex = -1;
    hover.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };

  const indexFromPointer = (event) => {
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (width / Math.max(1, rect.width));
    if (rows.length === 1) return 0;
    return Math.round(((x - margin.left) / plotWidth) * (rows.length - 1));
  };

  hitArea.addEventListener("pointermove", (event) => showIndex(indexFromPointer(event)));
  hitArea.addEventListener("pointerdown", (event) => showIndex(indexFromPointer(event)));
  hitArea.addEventListener("pointerleave", hide);
  svg.addEventListener("focus", () => showIndex(activeIndex < 0 ? rows.length - 1 : activeIndex));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (event.key === "Escape") {
      hide();
      return;
    }
    if (!(event.key in moves)) return;
    event.preventDefault();
    const step = moves[event.key];
    const base = activeIndex < 0 ? rows.length - 1 : activeIndex;
    showIndex(Number.isFinite(step) ? base + step : step < 0 ? 0 : rows.length - 1);
  });

  container.append(svg, tooltip);
}

function renderAnalyticsTrendTable(container, rows) {
  if (!container) return;
  container.replaceChildren();

  const table = document.createElement("table");
  table.className = "analytics-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of ["Date", "Visits", "Page views", "Pages / visit"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = text;
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);

  const body = document.createElement("tbody");
  for (const row of [...rows].reverse()) {
    const tr = document.createElement("tr");
    for (const text of [
      analyticsLongDateLabel(row.date),
      formatNumber(row.visits),
      formatNumber(row.views),
      row.visits > 0 ? formatDecimal(row.pagesPerVisit) : "—"
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }

  table.append(head, body);
  container.appendChild(table);
}

function analyticsBreakdowns(summary) {
  const metrics = summary.metrics || {};
  const visits = Number(metrics.visits || 0);
  const views = Number(metrics.pageViews || 0);
  const clicks = Number(metrics.clicks || 0);
  const exitRows = summary.exitPages || [];
  const exits = Number(metrics.exits || 0) ||
    exitRows.reduce((sum, row) => sum + Number(row?.exits || 0), 0);

  return {
    pages: {
      top: {
        tab: "Most viewed",
        column: "Views",
        total: views,
        empty: "No page views recorded yet.",
        rows: (summary.topPages || []).map((row) => ({
          label: analyticsPageName(row.path),
          detail: row.path && row.path !== "/" ? String(row.path) : "",
          value: Number(row.views || 0)
        }))
      },
      exit: {
        tab: "Exit pages",
        column: "Exits",
        total: exits,
        empty: "No page exits recorded yet.",
        rows: exitRows.map((row) => ({
          label: analyticsPageName(row.path),
          detail: `${row.path || "/"} · avg. ${formatDuration(row.avgDurationMs)} on page`,
          value: Number(row.exits || 0)
        }))
      }
    },
    sources: {
      referrers: {
        tab: "Referrers",
        column: "Visits",
        total: visits,
        empty: "No referring websites yet. Direct visits are not listed.",
        rows: (summary.referrers || []).map((row) => ({
          label: String(row.host || "Unknown").replace(/^www\./i, ""),
          value: Number(row.visitors || 0)
        }))
      },
      campaigns: {
        tab: "Campaigns",
        column: "Visits",
        total: visits,
        empty: "No UTM-tagged campaign traffic yet.",
        rows: (summary.campaigns || []).map((row) => ({
          label: row.campaign || row.source || "Untitled campaign",
          detail: [row.source, row.medium].filter(Boolean).join(" · "),
          value: Number(row.visitors || 0)
        }))
      }
    },
    locations: {
      countries: {
        tab: "Countries",
        column: "Visits",
        total: visits,
        empty: "No location data yet.",
        rows: (summary.locations || []).map((row) => {
          const country = analyticsCountry(row.country);
          const place = [row.city, row.region].filter(Boolean).join(", ");
          return {
            label: country.name,
            prefix: country.flag,
            detail: place,
            value: Number(row.visitors || 0)
          };
        })
      }
    },
    technology: {
      device: {
        tab: "Device",
        column: "Visits",
        total: visits,
        empty: "No device data yet.",
        rows: (summary.devices || []).map((row) => ({
          label: capitalise(row.device || "Unknown"),
          value: Number(row.visitors || 0)
        }))
      },
      browser: {
        tab: "Browser",
        column: "Visits",
        total: visits,
        empty: "Browser data is available from Cloudflare only.",
        rows: (summary.browsers || []).map((row) => ({
          label: row.browser || "Unknown",
          value: Number(row.visitors || 0)
        }))
      },
      os: {
        tab: "OS",
        column: "Visits",
        total: visits,
        empty: "Operating system data is available from Cloudflare only.",
        rows: (summary.operatingSystems || []).map((row) => ({
          label: row.os || "Unknown",
          value: Number(row.visitors || 0)
        }))
      }
    },
    clicks: {
      links: {
        tab: "Top clicks",
        column: "Clicks",
        total: clicks,
        empty: "No link or button clicks recorded yet.",
        rows: (summary.topClicks || []).map((row) => ({
          label: row.label || row.href || "Unlabelled control",
          detail: row.href || row.kind || "",
          value: Number(row.clicks || 0)
        }))
      }
    }
  };
}

const ANALYTICS_CARDS = [
  { id: "pages", title: "Pages", description: "What visitors read, and where they leave" },
  { id: "sources", title: "Sources", description: "Websites and campaigns sending visits" },
  { id: "locations", title: "Locations", description: "Where visits come from" },
  { id: "technology", title: "Devices", description: "What visitors browse with" },
  { id: "clicks", title: "Engagement", description: "Most-clicked links and buttons" }
];

function renderAnalyticsBreakdown(cardId, breakdown) {
  const card = document.querySelector(`[data-analytics-card="${cardId}"]`);
  if (!card || !breakdown) return;

  const tabs = Object.keys(breakdown);
  const activeTab = tabs.includes(state.analyticsTabs[cardId])
    ? state.analyticsTabs[cardId]
    : tabs[0];
  const list = breakdown[activeTab];

  const tabHost = card.querySelector(".analytics-tabs");
  if (tabHost) {
    tabHost.hidden = tabs.length < 2;
    tabHost.replaceChildren();
    for (const tab of tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = breakdown[tab].tab;
      button.setAttribute("aria-pressed", String(tab === activeTab));
      button.addEventListener("click", () => {
        state.analyticsTabs[cardId] = tab;
        renderAnalyticsBreakdown(cardId, breakdown);
      });
      tabHost.appendChild(button);
    }
  }

  const column = card.querySelector(".analytics-list-column");
  if (column) column.textContent = list.column;

  const body = card.querySelector(".analytics-list-body");
  if (!body) return;
  body.replaceChildren();

  const rows = list.rows
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "analytics-empty";
    empty.textContent = state.analyticsLoading && !state.analytics ? "Loading…" : list.empty;
    body.appendChild(empty);
    return;
  }

  const expandKey = `${cardId}:${activeTab}`;
  const expanded = state.analyticsExpanded.has(expandKey);
  const visible = expanded ? rows : rows.slice(0, ANALYTICS_LIST_LIMIT);
  const max = Math.max(...rows.map((row) => row.value), 1);

  const ol = document.createElement("ol");
  ol.className = "analytics-bar-list";

  for (const row of visible) {
    const item = document.createElement("li");
    item.className = "analytics-bar-row";
    const share = formatShare(row.value, list.total);
    item.title = `${row.label}${row.detail ? ` (${row.detail})` : ""}: ${formatNumber(row.value)} ${list.column.toLowerCase()} · ${share}`;

    const fill = document.createElement("span");
    fill.className = "analytics-bar-fill";
    fill.style.width = `${Math.max(1.5, (row.value / max) * 100)}%`;
    fill.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "analytics-bar-copy";
    const label = document.createElement("strong");
    label.textContent = row.prefix ? `${row.prefix} ${row.label}` : row.label;
    copy.appendChild(label);
    if (row.detail) {
      const detail = document.createElement("small");
      detail.textContent = row.detail;
      copy.appendChild(detail);
    }

    const value = document.createElement("b");
    value.className = "analytics-bar-value";
    value.textContent = formatNumber(row.value);

    const shareNode = document.createElement("span");
    shareNode.className = "analytics-bar-share";
    shareNode.textContent = share;

    item.append(fill, copy, value, shareNode);
    ol.appendChild(item);
  }

  body.appendChild(ol);

  if (rows.length > ANALYTICS_LIST_LIMIT) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "analytics-more";
    more.textContent = expanded ? "Show fewer" : `Show all ${rows.length}`;
    more.addEventListener("click", () => {
      if (expanded) state.analyticsExpanded.delete(expandKey);
      else state.analyticsExpanded.add(expandKey);
      renderAnalyticsBreakdown(cardId, breakdown);
    });
    body.appendChild(more);
  }
}

function renderAnalyticsDashboard() {
  const panel = document.querySelector("#chat-panel");
  if (!panel) return;

  state.analyticsTrendObserver?.disconnect();
  state.analyticsTrendObserver = null;

  panel.className = "chat-panel analytics-panel";
  panel.innerHTML = `
    <div class="analytics-view">
      <header class="analytics-header">
        <div class="eyebrow"><i aria-hidden="true"></i> Website analytics</div>
        <h1>Dashboard</h1>
        <p id="analytics-summary-line" class="analytics-summary-line">Well College Global website traffic and engagement.</p>
      </header>

      <div class="analytics-toolbar">
        <div class="analytics-range" role="group" aria-label="Date range">
          ${ANALYTICS_RANGES.map((days) => `
            <button type="button" data-analytics-days="${days}" aria-pressed="${days === state.analyticsDays}">Last ${days} days</button>
          `).join("")}
        </div>
        <button id="analytics-refresh" class="analytics-refresh" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"></path><path d="M20 4v7h-7"></path></svg>
          <span>Refresh</span>
        </button>
        <span id="analytics-status" class="analytics-status" aria-live="polite"></span>
      </div>

      <p id="analytics-source" class="analytics-source" hidden></p>

      <div class="analytics-content">
        <section class="analytics-kpis" aria-label="Key metrics">
          <article class="analytics-kpi">
            <span class="analytics-kpi-label"><i class="analytics-line-key is-visits" aria-hidden="true"></i>Visits</span>
            <strong id="kpi-visits">—</strong>
            <small id="kpi-visits-note">&nbsp;</small>
            <svg id="kpi-visits-spark" class="analytics-kpi-spark is-visits" aria-hidden="true"></svg>
          </article>
          <article class="analytics-kpi">
            <span class="analytics-kpi-label"><i class="analytics-line-key is-views" aria-hidden="true"></i>Page views</span>
            <strong id="kpi-views">—</strong>
            <small id="kpi-views-note">&nbsp;</small>
            <svg id="kpi-views-spark" class="analytics-kpi-spark is-views" aria-hidden="true"></svg>
          </article>
          <article class="analytics-kpi">
            <span class="analytics-kpi-label">Pages per visit</span>
            <strong id="kpi-ratio">—</strong>
            <small>page views ÷ visits</small>
            <svg id="kpi-ratio-spark" class="analytics-kpi-spark" aria-hidden="true"></svg>
          </article>
          <article class="analytics-kpi">
            <span class="analytics-kpi-label">Avg. time on page</span>
            <strong id="kpi-duration">—</strong>
            <small>before a visitor leaves</small>
          </article>
          <article class="analytics-kpi">
            <span class="analytics-kpi-label">Link &amp; button clicks</span>
            <strong id="kpi-clicks">—</strong>
            <small id="kpi-clicks-note">&nbsp;</small>
          </article>
        </section>

        <article class="analytics-card analytics-trend-card">
          <header class="analytics-card-head">
            <div>
              <h2>Traffic over time</h2>
              <p>Daily visits and page views</p>
            </div>
            <div class="analytics-legend" aria-hidden="true">
              <span><i class="analytics-line-key is-visits"></i>Visits</span>
              <span><i class="analytics-line-key is-views"></i>Page views</span>
            </div>
          </header>
          <div id="analytics-trend" class="analytics-trend"></div>
          <details class="analytics-table-view">
            <summary>Show daily figures as a table</summary>
            <div id="analytics-trend-table" class="analytics-table-wrap"></div>
          </details>
        </article>

        <section class="analytics-grid" aria-label="Traffic breakdowns">
          ${ANALYTICS_CARDS.map((card) => `
            <article class="analytics-card" data-analytics-card="${card.id}">
              <header class="analytics-card-head">
                <div>
                  <h2>${card.title}</h2>
                  <p>${card.description}</p>
                </div>
                <div class="analytics-tabs" role="group" aria-label="${card.title} view" hidden></div>
              </header>
              <div class="analytics-list-head" aria-hidden="true">
                <span></span>
                <span class="analytics-list-column"></span>
                <span>Share</span>
              </div>
              <div class="analytics-list-body"></div>
            </article>
          `).join("")}

          <article class="analytics-card analytics-privacy-card">
            <header class="analytics-card-head">
              <div>
                <h2>Privacy &amp; data</h2>
                <p>What is collected and how long it is kept</p>
              </div>
            </header>
            <dl class="analytics-privacy-list">
              <div><dt>Traffic</dt><dd>Cloudflare Web Analytics aggregated RUM data</dd></div>
              <div><dt>Engagement</dt><dd>First-party click, exit and UTM events only</dd></div>
              <div><dt>Analytics cookies</dt><dd>None</dd></div>
              <div><dt>Raw IP in analytics</dt><dd>Not stored in the historical event table</dd></div>
              <div><dt>Live presence</dt><dd>IP and page held only in the short-lived Visitors view</dd></div>
              <div><dt>Privacy signals</dt><dd>Global Privacy Control and Do Not Track respected</dd></div>
              <div><dt>Retention</dt><dd>Engagement events deleted after 90 days</dd></div>
              <div><dt>Support chat</dt><dd>Tab-scoped until the tab or chat closes</dd></div>
            </dl>
          </article>
        </section>
      </div>
    </div>
  `;

  panel.querySelectorAll("[data-analytics-days]").forEach((button) => {
    button.addEventListener("click", () => {
      const days = Number(button.dataset.analyticsDays);
      if (days === state.analyticsDays) return;
      state.analyticsDays = days;
      panel.querySelectorAll("[data-analytics-days]").forEach((item) => {
        item.setAttribute("aria-pressed", String(Number(item.dataset.analyticsDays) === days));
      });

      const cached = state.analyticsCache.get(days);
      if (cached) {
        state.analytics = cached.summary;
        paintAnalytics();
      }
      if (!cached || Date.now() - cached.fetchedAt > ANALYTICS_REFRESH_MS) {
        loadAnalytics({ silent: Boolean(cached) });
      }
    });
  });

  panel.querySelector("#analytics-refresh")?.addEventListener("click", () => {
    loadAnalytics({ fresh: true });
  });

  const trend = panel.querySelector("#analytics-trend");
  if (trend && typeof ResizeObserver !== "undefined") {
    let lastWidth = 0;
    let frame = 0;
    state.analyticsTrendObserver = new ResizeObserver(() => {
      if (!trend.isConnected) {
        state.analyticsTrendObserver?.disconnect();
        return;
      }
      const width = Math.round(trend.clientWidth);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const summary = state.analytics;
        if (summary) renderAnalyticsTrend(trend, normaliseAnalyticsDaily(summary.daily || [], summary.days || state.analyticsDays));
      });
    });
    state.analyticsTrendObserver.observe(trend);
  }

  paintAnalytics();
}

function paintAnalytics() {
  if (state.currentView !== "dashboard") return;

  const view = document.querySelector(".analytics-view");
  if (!view) return;

  const summary = state.analytics;
  const stale = Boolean(summary) && Number(summary.days) !== Number(state.analyticsDays);
  view.classList.toggle("is-refreshing", state.analyticsLoading && Boolean(summary));
  view.classList.toggle("is-stale", stale);

  const status = document.querySelector("#analytics-status");
  if (status) {
    status.textContent = state.analyticsLoading
      ? "Refreshing…"
      : state.analyticsError && !summary
        ? state.analyticsError
        : summary?.generatedAt
          ? `Updated ${formatTime(summary.generatedAt)}`
          : "";
    status.classList.toggle("is-error", Boolean(state.analyticsError) && !state.analyticsLoading);
  }

  const refresh = document.querySelector("#analytics-refresh");
  if (refresh) refresh.disabled = state.analyticsLoading;

  if (!summary) {
    renderAnalyticsTrend(document.querySelector("#analytics-trend"), []);
    for (const card of ANALYTICS_CARDS) {
      const body = document.querySelector(`[data-analytics-card="${card.id}"] .analytics-list-body`);
      if (body) {
        body.replaceChildren();
        const empty = document.createElement("p");
        empty.className = "analytics-empty";
        empty.textContent = state.analyticsLoading ? "Loading…" : "No data yet.";
        body.appendChild(empty);
      }
    }
    return;
  }

  const days = Number(summary.days || state.analyticsDays);
  const metrics = summary.metrics || {};
  const visits = Number(metrics.visits || 0);
  const views = Number(metrics.pageViews || 0);
  const clicks = Number(metrics.clicks || 0);

  const summaryLine = document.querySelector("#analytics-summary-line");
  if (summaryLine) {
    const topPage = summary.topPages?.[0];
    summaryLine.textContent = topPage && visits
      ? `${formatNumber(visits)} visits in the last ${days} days. Most viewed: ${analyticsPageName(topPage.path)}.`
      : `Well College Global website traffic for the last ${days} days.`;
  }

  const source = document.querySelector("#analytics-source");
  if (source) {
    const fallback = summary.trafficSource !== "cloudflare";
    source.hidden = !fallback;
    source.textContent = fallback
      ? summary.cloudflareConfigured
        ? "Cloudflare traffic is temporarily unavailable, so visits and page views below come from first-party events and may be lower than actual traffic."
        : "Cloudflare Web Analytics is not configured, so visits and page views below come from first-party events and may be lower than actual traffic."
      : "";
  }

  const text = {
    "#kpi-visits": formatNumber(visits),
    "#kpi-visits-note": `${formatNumber(Math.round(visits / Math.max(1, days)))} per day on average`,
    "#kpi-views": formatNumber(views),
    "#kpi-views-note": `${formatNumber(Math.round(views / Math.max(1, days)))} per day on average`,
    "#kpi-ratio": formatDecimal(metrics.pagesPerVisit),
    "#kpi-duration": formatDuration(metrics.avgDurationMs),
    "#kpi-clicks": formatNumber(clicks),
    "#kpi-clicks-note": visits > 0 ? `${formatDecimal(clicks / visits)} per visit` : "first-party events"
  };
  Object.entries(text).forEach(([selector, value]) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  });

  const daily = normaliseAnalyticsDaily(summary.daily || [], days);
  renderAnalyticsSparkline(document.querySelector("#kpi-visits-spark"), daily.map((row) => row.visits));
  renderAnalyticsSparkline(document.querySelector("#kpi-views-spark"), daily.map((row) => row.views));
  renderAnalyticsSparkline(document.querySelector("#kpi-ratio-spark"), daily.map((row) => row.pagesPerVisit));
  renderAnalyticsTrend(document.querySelector("#analytics-trend"), daily);
  renderAnalyticsTrendTable(document.querySelector("#analytics-trend-table"), daily);

  const breakdowns = analyticsBreakdowns(summary);
  for (const card of ANALYTICS_CARDS) {
    renderAnalyticsBreakdown(card.id, breakdowns[card.id]);
  }
}

async function loadAnalytics({ silent = false, fresh = false } = {}) {
  // Background refreshes never pile up behind an in-flight request, but an
  // explicit range change supersedes it so the newest selection always wins.
  if (silent && state.analyticsLoading) return;

  const days = state.analyticsDays;
  const requestId = (state.analyticsRequestId || 0) + 1;
  state.analyticsRequestId = requestId;
  state.analyticsLoading = true;
  if (!silent) paintAnalytics();

  try {
    const result = await apiRequest(`/analytics?days=${days}${fresh ? "&fresh=1" : ""}`);
    if (requestId !== state.analyticsRequestId) return;
    const summary = result.summary || null;
    if (summary) {
      summary.days = Number(summary.days || days);
      state.analyticsCache.set(summary.days, { summary, fetchedAt: Date.now() });
    }
    if (days === state.analyticsDays) state.analytics = summary;
    state.analyticsError = "";
  } catch (error) {
    if (requestId !== state.analyticsRequestId) return;
    if (error.status !== 401 && error.status !== 403) {
      state.analyticsError = error?.message || "Unable to load website analytics.";
      if (!silent) showToast(state.analyticsError, "error");
    }
  } finally {
    if (requestId === state.analyticsRequestId) {
      state.analyticsLoading = false;
      paintAnalytics();
    }
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
          <img class="brand-mark" src="/well-college-icon.png" alt="" aria-hidden="true" />
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
          ${staffCan("editor") ? `
          <button class="nav-button" type="button" data-dashboard-view="editor">
            ${editorIcon()}
            <span>Web Editor</span>
          </button>
          ` : ""}
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

  if (!state.profileOutsideClickBound) {
    // renderDashboard runs on every sign-in; bind the outside-click closer once.
    state.profileOutsideClickBound = true;
    document.addEventListener("click", (event) => {
      const shell = document.querySelector(".staff-profile-shell");
      if (shell && !shell.contains(event.target)) closeProfileMenu();
    });
  }
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
  // setDashboardView() already started the analytics load when the dashboard
  // is the landing view; other views fetch analytics only when opened.
  await loadInbox();
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

      // Only the Messages view shows the chat panel; other views own
      // #chat-panel and must not be replaced when a chat closes remotely.
      if (state.currentView === "messages") renderDashboardChatEmpty();
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

async function ensureConversationJoinedFromTyping(id) {
  let conversation = state.conversations.find((item) => item.id === id);
  if (!conversation || conversation.status !== "open") return null;
  if (conversationIsMine(conversation)) return conversation;
  if (conversation.joined_agent_id) return null;

  if (state.joinPromises.has(id)) return state.joinPromises.get(id);

  const promise = (async () => {
    try {
      const claimed = await markConversationJoined(id);
      if (claimed && claimed.joined_agent_id === state.user?.id) {
        state.messageSection = "current";
        const ownerChip = document.querySelector("#chat-owner-chip");
        if (ownerChip) {
          ownerChip.textContent = "Your chat";
          ownerChip.classList.remove("is-waiting");
        }
        const closeButton = document.querySelector("#close-chat-button");
        if (closeButton) closeButton.hidden = false;
        const addButton = document.querySelector("#support-page-picker-button");
        if (addButton) addButton.disabled = false;
        const input = document.querySelector("#message-input");
        if (input) input.placeholder = "Reply as Well College Global…";
        const note = document.querySelector("#composer-join-note");
        if (note) note.textContent = "You joined this chat · Enter to send";
        renderConversationList();
        return claimed;
      }

      await loadInbox({ silent: true });
      conversation = state.conversations.find((item) => item.id === id);
      if (conversation?.joined_agent_id && !conversationIsMine(conversation)) {
        state.messageSection = "all";
        showToast("Another staff member picked up this chat.");
        renderConversationList();
        renderChatShell();
      }
      return conversationIsMine(conversation) ? conversation : null;
    } catch (error) {
      showToast(error?.message || "Unable to join this chat.", "error");
      return null;
    } finally {
      state.joinPromises.delete(id);
    }
  })();

  state.joinPromises.set(id, promise);
  return promise;
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
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) return;

  state.currentView = "messages";
  const dashboard = document.querySelector("#dashboard");
  dashboard?.classList.remove("is-dashboard");
  dashboard?.classList.add("is-messages");
  updatePrimaryNavigation();

  // Viewing a waiting chat does not claim it. The first real typing action
  // claims it so the visitor only sees a joined notice when staff engages.
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
      ${!assignedToOther ? `
        <button id="close-chat-button" class="visitor-close-chat" type="button" ${mine ? "" : "hidden"}>
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

  const mine = conversationIsMine(conversation);
  const assignedToOther = Boolean(conversation.joined_agent_id && !mine);

  if (assignedToOther) {
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
          ${mine ? "" : "disabled"}
        >+</button>

        <textarea
          id="message-input"
          rows="1"
          maxlength="${MAX_MESSAGE_LENGTH}"
          placeholder="${mine ? "Reply as Well College Global…" : "Start typing to join this chat…"}"
          aria-label="Support reply"
        ></textarea>

        <button id="send-button" class="send-button" type="submit" disabled aria-label="Send reply">
          ${sendIcon()}
        </button>
      </div>

      <div class="composer-note">
        <span id="composer-join-note">${mine ? "+ Share a page · Enter to send · Shift + Enter for a new line" : "Start typing to join · viewing alone will not claim the chat"}</span>
        <span>Powered by <strong>Well College Global</strong></span>
      </div>
    </form>
  `;

  const form = document.querySelector("#composer-form");
  const input = document.querySelector("#message-input");
  const button = document.querySelector("#send-button");

  input?.addEventListener("input", async () => {
    const hasText = Boolean(input.value.trim());
    if (hasText && !conversationIsMine(currentConversation())) {
      if (button) button.disabled = true;
      const note = document.querySelector("#composer-join-note");
      if (note) note.textContent = "Joining chat…";
      await ensureConversationJoinedFromTyping(conversation.id);
    }
    if (button) {
      button.disabled = !input.value.trim() || !conversationIsMine(currentConversation());
    }
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

async function sendReply(event) {
  event.preventDefault();

  const input = document.querySelector("#message-input");
  const button = document.querySelector("#send-button");
  const body = String(input?.value || "").trim();
  let conversation = currentConversation();

  if (
    !body ||
    !conversation ||
    conversation.status !== "open" ||
    !state.user
  ) return;

  if (!conversationIsMine(conversation)) {
    conversation = await ensureConversationJoinedFromTyping(conversation.id);
  }

  if (!conversation || !conversationIsMine(conversation)) return;

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
    if (
      state.user &&
      state.currentView === "dashboard" &&
      document.visibilityState === "visible"
    ) {
      loadAnalytics({ silent: true });
    }
  }, ANALYTICS_REFRESH_MS);
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
  cleanupRealtime();
  state.agent = null;
  state.user = null;
  window.location.assign("/cdn-cgi/access/logout");
}

async function bootstrap() {
  let result;

  try {
    result = await apiRequest("/session");
  } catch (error) {
    renderAccessError(
      error?.message ||
      "Your Cloudflare Access session could not be verified."
    );
    return;
  }

  state.user = result.user;
  state.agent = result.agent;
  renderDashboard();

  try {
    await initialiseDashboard();
  } catch (error) {
    console.error("Well Support initialisation failed", error);
    showToast(
      error?.message || "Some dashboard data is temporarily unavailable.",
      "error"
    );
  }
}

bootstrap();
