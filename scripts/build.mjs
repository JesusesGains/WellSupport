import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const dist = resolve(root, "dist");

const DEFAULT_SUPABASE_URL = "https://fmlrtcofnbqdotpvuaem.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_my0myBoo-Kdu4tMCOsdKiQ_l0uuIHpR";

const supabaseUrl = String(process.env.VITE_SUPPORT_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
const publishableKey = String(process.env.VITE_SUPPORT_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY).trim();

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "assets"), { recursive: true });

await cp(resolve(root, "index.html"), resolve(dist, "index.html"));
await cp(resolve(root, "assets"), resolve(dist, "assets"), { recursive: true });
await cp(resolve(root, "public"), dist, { recursive: true });

const template = await readFile(resolve(root, "config.template.js"), "utf8");
const config = template
  .replace("__SUPABASE_URL__", JSON.stringify(supabaseUrl).slice(1, -1))
  .replace("__SUPABASE_PUBLISHABLE_KEY__", JSON.stringify(publishableKey).slice(1, -1));

await writeFile(resolve(dist, "config.js"), config, "utf8");

console.log(
  supabaseUrl && publishableKey
    ? "Well Support built with Supabase browser configuration."
    : "Well Support built without Supabase configuration; sign-in will show a setup notice."
);
