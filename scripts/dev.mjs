import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const child = spawn(process.execPath, ["scripts/build.mjs"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

await new Promise((resolvePromise, rejectPromise) => {
  child.once("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error("Build failed.")));
});

const root = resolve(process.cwd(), "dist");
const port = Number(process.env.PORT || 5173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  const rawPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const safePath = normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
  let file = join(root, safePath === "/" ? "index.html" : safePath);

  if (!file.startsWith(root) || !existsSync(file)) {
    file = join(root, "index.html");
  } else {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
  }

  response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
  createReadStream(file).pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Well Support available at http://localhost:${port}`);
});
