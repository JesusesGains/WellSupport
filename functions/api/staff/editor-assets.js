import { requireStaff, sessionResponse } from "./_utils.js";
import {
  BETA_BRANCH,
  MAIN_BRANCH,
  REPOSITORY,
  githubRequest
} from "./_github.js";

function assetKind(path) {
  const value = String(path || "").toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/.test(value)) return "image";
  if (/\.(mp4|webm|mov)$/.test(value)) return "video";
  if (/\.pdf$/.test(value)) return "pdf";
  return "file";
}

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  const url = new URL(request.url);
  const target = url.searchParams.get("target") === "production" ? "production" : "beta";
  const branch = target === "production" ? MAIN_BRANCH : BETA_BRANCH;

  try {
    const branchInfo = await githubRequest(
      env,
      `/repos/${REPOSITORY}/branches/${encodeURIComponent(branch)}`
    );
    const treeSha = branchInfo.commit?.commit?.tree?.sha;
    if (!treeSha) throw new Error("Unable to resolve website asset tree.");

    const tree = await githubRequest(
      env,
      `/repos/${REPOSITORY}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`
    );

    const assets = (Array.isArray(tree.tree) ? tree.tree : [])
      .filter(
        (item) =>
          item?.type === "blob" &&
          typeof item.path === "string" &&
          item.path.startsWith("assets/")
      )
      .slice(0, 600)
      .map((item) => ({
        path: item.path,
        name: item.path.split("/").pop(),
        size: Number(item.size || 0),
        kind: assetKind(item.path),
        url: `https://www.wellcollegeglobal.com/${item.path}`
      }));

    return sessionResponse({ target, branch, assets }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to list website assets." },
      session,
      error.status || 500
    );
  }
}
