import {
  json,
  requireStaff,
  sessionResponse
} from "./_utils.js";

export async function onRequestGet({ request }) {
  const session = await requireStaff(request);
  if (session.response) return session.response;

  return sessionResponse({
    user: {
      id: session.user.id,
      email: session.user.email || ""
    },
    agent: session.agent
  }, session);
}
