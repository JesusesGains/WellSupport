import { json } from "./_utils.js";

export async function onRequestPost() {
  return json(
    {
      error:
        "Password sign-in has been removed. Authenticate through Cloudflare Access."
    },
    410
  );
}
