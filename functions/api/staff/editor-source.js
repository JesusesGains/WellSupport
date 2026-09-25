import {
  requireStaff,
  requireStaffPermission,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  MAIN_BRANCH,
  readTextFile
} from "./_github.js";

const MAX_HTML_CHARS = 350000;
const MAX_CSS_CHARS = 650000;

function cleanPage(value) {
  const raw = String(value || "/").trim();
  if (!raw.startsWith("/") || raw.includes("?") || raw.includes("#")) return null;
  const path = raw === "/" || raw === "/index.html"
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

function localStylesheetPaths(html) {
  const paths = [];
  const seen = new Set();
  const expression = /<link\b[^>]*\brel=["'][^"']*stylesheet[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*>|<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi;
  let match;

  while ((match = expression.exec(String(html || "")))) {
    const raw = String(match[1] || match[2] || "").trim();
    if (!raw || /^(?:https?:)?\/\//i.test(raw) || raw.startsWith("data:")) continue;

    const cleaned = raw
      .split("#")[0]
      .split("?")[0]
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");

    if (
      !cleaned ||
      cleaned.includes("..") ||
      !/^[a-z0-9][a-z0-9._/-]*\.css$/i.test(cleaned) ||
      seen.has(cleaned)
    ) {
      continue;
    }

    seen.add(cleaned);
    paths.push(cleaned);
    if (paths.length >= 12) break;
  }

  if (!paths.length) paths.push("styles.css");
  return paths;
}

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  const url = new URL(request.url);
  const target = url.searchParams.get("target") === "production" ? "production" : "beta";
  const branch = target === "production" ? MAIN_BRANCH : BETA_BRANCH;
  const page = cleanPage(url.searchParams.get("page") || "/");
  if (!page) {
    return sessionResponse({ error: "Invalid website page." }, session, 400);
  }

  try {
    const htmlFile = await readTextFile(env, branch, page);
    const html = String(htmlFile.content || "").slice(0, MAX_HTML_CHARS);
    const cssPaths = localStylesheetPaths(html);
    const cssFiles = [];
    let cssChars = 0;

    for (const cssPath of cssPaths) {
      if (cssChars >= MAX_CSS_CHARS) break;
      try {
        const file = await readTextFile(env, branch, cssPath);
        const remaining = MAX_CSS_CHARS - cssChars;
        const source = String(file.content || "").slice(0, remaining);
        cssFiles.push({ path: cssPath, sha: file.sha, content: source });
        cssChars += source.length;
      } catch {
        // Ignore a missing optional stylesheet but keep the HTML available.
      }
    }

    return sessionResponse({
      target,
      branch,
      page,
      html: {
        path: page,
        sha: htmlFile.sha,
        content: html
      },
      css: {
        files: cssFiles.map(({ path, sha, content }) => ({ path, sha, content })),
        content: cssFiles
          .map((file) => `/* ===== ${file.path} ===== */\n${file.content}`)
          .join("\n\n")
      }
    }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to read website source." },
      session,
      error.status || 500
    );
  }
}
