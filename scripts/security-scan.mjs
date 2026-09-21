import { access, readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = process.cwd();
const mode = process.argv[2] || "source";
const ignored = new Set([".git", "dist", "node_modules", ".wrangler"]);
const textExtensions = new Set([
  ".css", ".html", ".js", ".json", ".md", ".mjs", ".toml", ".txt", ".yaml", ".yml"
]);

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function walk(directory, includeIgnored = false) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!includeIgnored && entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path, includeIgnored));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function browserCredentialFailures(name, source, failures) {
  if (/\bsb_publishable_[A-Za-z0-9_-]{20,}\b/.test(source)) {
    failures.push(`${name}: Supabase publishable key must not be shipped to browser assets`);
  }
  if (/\bsb_secret_[A-Za-z0-9_-]{20,}\b/.test(source)) {
    failures.push(`${name}: Supabase secret key found in browser assets`);
  }
  if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(source)) {
    failures.push(`${name}: JWT-like credential found in browser assets`);
  }
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) {
    failures.push(`${name}: dynamic code execution is forbidden in browser assets`);
  }
}

async function sourceScan() {
  const failures = [];
  const files = await walk(root);

  for (const file of files) {
    const name = relative(root, file).replaceAll("\\", "/");
    const extension = extname(file).toLowerCase();

    if (/(^|\/)\.env(?:\.|$)/.test(name)) {
      failures.push(`${name}: environment files must not be committed`);
    }

    if (/\.(?:pem|key|p12|pfx)$/i.test(name)) {
      failures.push(`${name}: private certificate/key material must not be committed`);
    }

    if (!textExtensions.has(extension)) continue;
    const source = await readFile(file, "utf8");

    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(source)) {
      failures.push(`${name}: private key material detected`);
    }
    if (/\bsb_secret_[A-Za-z0-9_-]{20,}\b/.test(source)) {
      failures.push(`${name}: Supabase secret key detected`);
    }
    if (/\bsb_publishable_[A-Za-z0-9_-]{20,}\b/.test(source)) {
      failures.push(`${name}: Supabase publishable key must come from Cloudflare env`);
    }
    if (/https:\/\/[a-z0-9]+\.supabase\.co/.test(source) && name.startsWith("functions/")) {
      failures.push(`${name}: Supabase project URL must come from Cloudflare env`);
    }
    if (/\bSUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"'\n]{20,}["']/.test(source)) {
      failures.push(`${name}: Supabase service-role credential detected`);
    }
    if (/\b(?:github_pat_[A-Za-z0-9_]{40,}|ghp_[A-Za-z0-9]{30,})\b/.test(source)) {
      failures.push(`${name}: GitHub token detected; use Cloudflare WELLWEBSITE_GITHUB_TOKEN secret instead`);
    }

    if (
      (name === "index.html" || name.startsWith("assets/") || name.startsWith("public/")) &&
      !name.endsWith("_headers")
    ) {
      browserCredentialFailures(name, source, failures);
    }
  }

  const headersPath = resolve(root, "public/_headers");
  if (!await exists(headersPath)) {
    failures.push("public/_headers: missing browser security headers");
  } else {
    const headers = await readFile(headersPath, "utf8");
    for (const required of [
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "X-Frame-Options: DENY",
      "Strict-Transport-Security:",
      "X-Robots-Tag: noindex",
      "Content-Signal: search=no"
    ]) {
      if (!headers.includes(required)) failures.push(`public/_headers: missing ${required}`);
    }
    for (const forbidden of ["cdn.jsdelivr.net", "wss://*.supabase.co", "connect-src 'self' https://*.supabase.co"]) {
      if (headers.includes(forbidden)) failures.push(`public/_headers: browser policy still allows ${forbidden}`);
    }
  }

  const robotsPath = resolve(root, "public/robots.txt");
  if (!await exists(robotsPath)) {
    failures.push("public/robots.txt: crawler deny-all file is missing");
  } else {
    const robots = await readFile(robotsPath, "utf8");
    if (!/User-agent:\s*\*\s*\nDisallow:\s*\//i.test(robots)) {
      failures.push("public/robots.txt: must disallow all crawlers");
    }
  }

  const indexPath = resolve(root, "index.html");
  if (await exists(indexPath)) {
    const index = await readFile(indexPath, "utf8");
    if (!/name=["']robots["'][^>]*noindex/i.test(index)) {
      failures.push("index.html: noindex robots meta is required");
    }
  }

  if (failures.length) {
    throw new Error(`WellSupport source security scan failed:\n${failures.join("\n")}`);
  }

  console.log(`WellSupport source security scan passed across ${files.length} files.`);
}

async function distScan() {
  const dist = resolve(root, "dist");
  if (!await exists(dist)) throw new Error("dist is missing");

  const failures = [];
  const files = await walk(dist, true);

  for (const file of files) {
    const info = await stat(file);
    const name = relative(dist, file).replaceAll("\\", "/");

    if (info.size > 25 * 1024 * 1024) {
      failures.push(`dist/${name}: exceeds Cloudflare Pages 25 MiB asset limit`);
    }

    const extension = extname(file).toLowerCase();
    if (!textExtensions.has(extension)) continue;

    const source = await readFile(file, "utf8");
    browserCredentialFailures(`dist/${name}`, source, failures);
  }

  if (await exists(resolve(dist, "config.js"))) {
    failures.push("dist/config.js: obsolete browser Supabase configuration must not exist");
  }

  if (failures.length) {
    throw new Error(`WellSupport dist security scan failed:\n${failures.join("\n")}`);
  }

  console.log(`WellSupport dist security scan passed across ${files.length} files.`);
}

if (mode === "source") await sourceScan();
else if (mode === "dist") await distScan();
else throw new Error('Usage: node scripts/security-scan.mjs "source" | "dist"');
