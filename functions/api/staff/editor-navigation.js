import {
  assertSameOrigin,
  requireStaff,
  requireStaffPermission,
  sessionResponse
} from "./_utils.js";
import {
  BETA_BRANCH,
  MAIN_BRANCH,
  compareBranches,
  readTextFile,
  writeTextFile
} from "./_github.js";

const NAVIGATION_PATH = "src/data/navigation.js";

const HEADER_KEYS = [
  "qualifications",
  "short-courses",
  "about",
  "testimonials",
  "more"
];

const SHORT_COURSE_GROUPS = [
  "Nutrition & health",
  "Holistic health",
  "Psychology & coaching",
  "Business"
];

function parseExportedStringArray(source, exportName) {
  const expression = new RegExp(
    `export\\s+const\\s+${exportName}\\s*=\\s*\\[([\\s\\S]*?)\\];`
  );
  const match = String(source || "").match(expression);
  if (!match) return null;

  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function assertExactOrder(value, allowed, label) {
  if (!Array.isArray(value) || value.length !== allowed.length) {
    const error = new Error(`Invalid ${label} order.`);
    error.status = 400;
    throw error;
  }

  const clean = value.map((item) => String(item || ""));
  const unique = new Set(clean);

  if (
    unique.size !== allowed.length ||
    allowed.some((item) => !unique.has(item))
  ) {
    const error = new Error(`Invalid ${label} order.`);
    error.status = 400;
    throw error;
  }

  return clean;
}

function replaceExportedStringArray(source, exportName, values) {
  const expression = new RegExp(
    `export\\s+const\\s+${exportName}\\s*=\\s*\\[([\\s\\S]*?)\\];`
  );

  if (!expression.test(source)) {
    const error = new Error(
      `Website navigation source is missing ${exportName}.`
    );
    error.status = 409;
    throw error;
  }

  const rendered = [
    `export const ${exportName} = [`,
    ...values.map((item) => `  ${JSON.stringify(item)},`),
    "];"
  ].join("\n");

  return source.replace(expression, rendered);
}

function ordersFromSource(source) {
  const headerOrder = parseExportedStringArray(
    source,
    "headerNavigationOrder"
  );
  const shortCourseGroupOrder = parseExportedStringArray(
    source,
    "shortCourseGroupOrder"
  );

  if (!headerOrder || !shortCourseGroupOrder) {
    const error = new Error(
      "Website navigation source is not ready for drag-and-drop editing."
    );
    error.status = 409;
    throw error;
  }

  return {
    headerOrder: assertExactOrder(headerOrder, HEADER_KEYS, "header"),
    shortCourseGroupOrder: assertExactOrder(
      shortCourseGroupOrder,
      SHORT_COURSE_GROUPS,
      "Short Courses dropdown"
    )
  };
}

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;
  const denied = requireStaffPermission(session, "editor");
  if (denied) return denied;

  const url = new URL(request.url);
  const target = url.searchParams.get("target") === "production"
    ? "production"
    : "beta";
  const branch = target === "production" ? MAIN_BRANCH : BETA_BRANCH;

  try {
    const file = await readTextFile(env, branch, NAVIGATION_PATH);
    return sessionResponse(
      {
        target,
        branch,
        sha: file.sha,
        ...ordersFromSource(file.content)
      },
      session
    );
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to read website navigation source." },
      session,
      error.status || 500
    );
  }
}

export async function onRequestPost({ request, env }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  return sessionResponse(
    {
      error:
        "Navigation edits are a local draft. Publish beta preview from the top-right to create the beta-main commit/build."
    },
    session,
    409
  );
}
