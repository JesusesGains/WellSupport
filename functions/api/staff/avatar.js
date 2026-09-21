import {
  assertSameOrigin,
  deleteAvatar,
  requireStaff,
  sessionResponse,
  uploadAvatar
} from "./_utils.js";

export async function onRequestPost({ request }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(request);
  if (session.response) return session.response;

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return sessionResponse({ error: "Profile photo is missing." }, session, 400);
    }

    const avatarUrl = await uploadAvatar(session, file);
    return sessionResponse({ avatarUrl }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to upload profile photo." },
      session,
      400
    );
  }
}

export async function onRequestDelete({ request }) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const session = await requireStaff(request);
  if (session.response) return session.response;

  try {
    await deleteAvatar(session);
    return sessionResponse({ ok: true }, session);
  } catch (error) {
    return sessionResponse(
      { error: error.message || "Unable to remove profile photo." },
      session,
      400
    );
  }
}
