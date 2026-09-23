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

  const betaSha = beta.commit?.sha || null;
  const previewGate = betaSha
    ? await requiredPreviewCheck(env, betaSha)
    : { required: false, passed: false, state: "missing_sha" };

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
      sha: betaSha,
      overrides: betaOverrides.data,
      previewGate
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

export async function restoreBranchTree(env, branch, sourceCommitSha, message) {
  const [branchInfo, sourceCommit] = await Promise.all([
    githubRequest(
      env,
      `/repos/${REPOSITORY}/branches/${encodeURIComponent(branch)}`
    ),
    githubRequest(
      env,
      `/repos/${REPOSITORY}/git/commits/${encodeURIComponent(sourceCommitSha)}`
    )
  ]);

  const parentSha = branchInfo.commit?.sha;
  const treeSha = sourceCommit.tree?.sha;
  if (!parentSha || !treeSha) {
    const error = new Error("Unable to resolve website version for restore.");
    error.status = 409;
    throw error;
  }

  const commit = await githubRequest(env, `/repos/${REPOSITORY}/git/commits`, {
    method: "POST",
    body: {
      message,
      tree: treeSha,
      parents: [parentSha]
    }
  });

  await githubRequest(
    env,
    `/repos/${REPOSITORY}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      body: { sha: commit.sha, force: false }
    }
  );

  return {
    sha: commit.sha,
    parentSha,
    restoredFromSha: sourceCommitSha,
    treeSha
  };
}

export async function commitFiles(env, branch, files, message) {
  const cleanFiles = Array.isArray(files)
    ? files.filter((file) => file?.path && typeof file.content === "string")
    : [];

  if (!cleanFiles.length) {
    const error = new Error("No files supplied for commit.");
    error.status = 400;
    throw error;
  }

  const branchInfo = await githubRequest(
    env,
    `/repos/${REPOSITORY}/branches/${encodeURIComponent(branch)}`
  );
  const parentSha = branchInfo.commit?.sha;
  if (!parentSha) throw new Error("Unable to resolve branch head.");

  const parentCommit = await githubRequest(
    env,
    `/repos/${REPOSITORY}/git/commits/${encodeURIComponent(parentSha)}`
  );
  const baseTree = parentCommit.tree?.sha;
  if (!baseTree) throw new Error("Unable to resolve branch tree.");

  const tree = [];
  for (const file of cleanFiles) {
    const blob = await githubRequest(env, `/repos/${REPOSITORY}/git/blobs`, {
      method: "POST",
      body: {
        content: file.content,
        encoding: file.encoding === "base64" ? "base64" : "utf-8"
      }
    });

    tree.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha
    });
  }

  const nextTree = await githubRequest(env, `/repos/${REPOSITORY}/git/trees`, {
    method: "POST",
    body: {
      base_tree: baseTree,
      tree
    }
  });

  const commit = await githubRequest(env, `/repos/${REPOSITORY}/git/commits`, {
    method: "POST",
    body: {
      message,
      tree: nextTree.sha,
      parents: [parentSha]
    }
  });

  await githubRequest(
    env,
    `/repos/${REPOSITORY}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "PATCH",
      body: { sha: commit.sha, force: false }
    }
  );

  return {
    sha: commit.sha,
    parentSha,
    treeSha: nextTree.sha
  };
}

export async function requiredPreviewCheck(env, sha) {
  const requiredName = String(
    env?.WELLWEBSITE_REQUIRED_CHECK || "Cloudflare Pages"
  ).trim();

  const normalised = requiredName.toLowerCase();
  const [checks, status] = await Promise.all([
    githubRequest(
      env,
      `/repos/${REPOSITORY}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`
    ).catch(() => ({ check_runs: [] })),
    githubRequest(
      env,
      `/repos/${REPOSITORY}/commits/${encodeURIComponent(sha)}/status`
    ).catch(() => ({ statuses: [] }))
  ]);

  const checkRun = (Array.isArray(checks?.check_runs) ? checks.check_runs : [])
    .find((item) => String(item?.name || "").toLowerCase() === normalised);
  if (checkRun) {
    const conclusion = String(checkRun.conclusion || "");
    return {
      required: true,
      passed: checkRun.status === "completed" && conclusion === "success",
      name: requiredName,
      state: checkRun.status || "unknown",
      conclusion: conclusion || null,
      url: checkRun.html_url || checkRun.details_url || null
    };
  }

  const commitStatus = (Array.isArray(status?.statuses) ? status.statuses : [])
    .find((item) => String(item?.context || "").toLowerCase() === normalised);
  if (commitStatus) {
    return {
      required: true,
      passed: commitStatus.state === "success",
      name: requiredName,
      state: commitStatus.state || "unknown",
      conclusion: commitStatus.state || null,
      url: commitStatus.target_url || null
    };
  }

  return {
    required: true,
    passed: false,
    name: requiredName,
    state: "missing",
    conclusion: null,
    url: null
  };
}

export {
  REPOSITORY,
  MAIN_BRANCH,
  BETA_BRANCH,
  OVERRIDES_PATH
};
