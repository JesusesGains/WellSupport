const GITHUB_API = "https://api.github.com";
const REPOSITORY = "JesusesGains/WellWebsite";
const MAIN_BRANCH = "main";
const BETA_BRANCH = "beta-main";
const OVERRIDES_PATH = "editor-overrides.json";

function tokenFromEnv(env) {
  const token = String(env?.WELLWEBSITE_GITHUB_TOKEN || "");
  if (!token) {
    const error = new Error("GitHub editing is not connected.");
    error.status = 503;
    error.code = "github_not_connected";
    throw error;
  }
  return token;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

export async function githubRequest(env, path, {
  method = "GET",
  body
} = {}) {
  const token = tokenFromEnv(env);
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "WellCollegeGlobal-Dashboard"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const payload = await readPayload(response);

  if (!response.ok) {
    const error = new Error(
      payload?.message || `GitHub request failed (${response.status}).`
    );
    error.status = response.status;
    error.github = payload;
    throw error;
  }

  return payload;
}

function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function readOverrides(env, branch) {
  try {
    const file = await githubRequest(
      env,
      `/repos/${REPOSITORY}/contents/${OVERRIDES_PATH}?ref=${encodeURIComponent(branch)}`
    );

    const parsed = JSON.parse(decodeBase64(file.content));
    return {
      sha: file.sha,
      data: {
        version: Number(parsed?.version || 2),
        pages:
          parsed?.pages && typeof parsed.pages === "object"
            ? parsed.pages
            : {},
        banner:
          parsed?.banner && typeof parsed.banner === "object"
            ? parsed.banner
            : null
      }
    };
  } catch (error) {
    if (error.status === 404) {
      return { sha: null, data: { version: 2, pages: {}, banner: null } };
    }
    throw error;
  }
}

export async function writeOverrides(env, branch, data, sha, message) {
  return githubRequest(
    env,
    `/repos/${REPOSITORY}/contents/${OVERRIDES_PATH}`,
    {
      method: "PUT",
      body: {
        message,
        content: encodeBase64(`${JSON.stringify(data, null, 2)}\n`),
        branch,
        ...(sha ? { sha } : {})
      }
    }
  );
}

export async function readTextFile(env, branch, path) {
  const file = await githubRequest(
    env,
    `/repos/${REPOSITORY}/contents/${path}?ref=${encodeURIComponent(branch)}`
  );

  return {
    sha: file.sha,
    content: decodeBase64(file.content)
  };
}

export async function writeTextFile(env, branch, path, content, sha, message) {
  return githubRequest(
    env,
    `/repos/${REPOSITORY}/contents/${path}`,
    {
      method: "PUT",
      body: {
        message,
        content: encodeBase64(
          String(content || "").endsWith("\n")
            ? String(content || "")
            : `${String(content || "")}\n`
        ),
        branch,
        ...(sha ? { sha } : {})
      }
    }
  );
}

export async function compareBranches(env) {
  const comparison = await githubRequest(
    env,
    `/repos/${REPOSITORY}/compare/${MAIN_BRANCH}...${BETA_BRANCH}`
  );

  return {
    status: comparison.status || "unknown",
    aheadBy: Number(comparison.ahead_by || 0),
    behindBy: Number(comparison.behind_by || 0),
    totalCommits: Number(comparison.total_commits || 0),
    mergeBaseSha: comparison.merge_base_commit?.sha || null
  };
}

export async function editorStatus(env) {
  const [main, beta, comparison, productionOverrides, betaOverrides] =
    await Promise.all([
      githubRequest(env, `/repos/${REPOSITORY}/branches/${MAIN_BRANCH}`),
      githubRequest(env, `/repos/${REPOSITORY}/branches/${BETA_BRANCH}`),
      compareBranches(env),
      readOverrides(env, MAIN_BRANCH),
      readOverrides(env, BETA_BRANCH)
    ]);

  return {
    connected: true,
    repository: REPOSITORY,
    main: {
      branch: MAIN_BRANCH,
      sha: main.commit?.sha || null,
      overrides: productionOverrides.data
    },
    beta: {
      branch: BETA_BRANCH,
      sha: beta.commit?.sha || null,
      overrides: betaOverrides.data
    },
    comparison
  };
}

export async function mergeBranch(env, base, head, commitMessage) {
  return githubRequest(env, `/repos/${REPOSITORY}/merges`, {
    method: "POST",
    body: {
      base,
      head,
      commit_message: commitMessage
    }
  });
}

export async function moveBranchForward(env, branch, sha) {
  return githubRequest(
    env,
    `/repos/${REPOSITORY}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      body: {
        sha,
        force: false
      }
    }
  );
}

export {
  REPOSITORY,
  MAIN_BRANCH,
  BETA_BRANCH,
  OVERRIDES_PATH
};
