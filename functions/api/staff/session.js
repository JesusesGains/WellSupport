import {
  requireStaff,
  sessionResponse
} from "./_utils.js";

export async function onRequestGet({ request, env }) {
  const session = await requireStaff(env, request);
  if (session.response) return session.response;

  return sessionResponse({
    user: {
      id: session.user.id,
      email: session.user.email || ""
    },
    agent: session.agent
  }, session);
}
