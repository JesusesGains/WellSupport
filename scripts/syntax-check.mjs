import { readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const ignored = new Set([".git", "dist", "node_modules", ".wrangler"]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && /\.(?:js|mjs)$/i.test(entry.name)) files.push(path);
  }
  return files;
}

const files = await walk(root);
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    failures.push(
      `${relative(root, file)}\n${String(result.stderr || result.stdout || "Syntax check failed.").trim()}`
    );
  }
}

if (failures.length) {
  throw new Error(`WellSupport JavaScript syntax check failed:\n\n${failures.join("\n\n")}`);
}

console.log(`WellSupport JavaScript syntax check passed across ${files.length} files.`);
