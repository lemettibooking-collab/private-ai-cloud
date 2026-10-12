// AI-039.2 Sign in with ChatGPT loopback callback (http://127.0.0.1:<port>/integrations/chatgpt/callback).
//
// The only non-Auth.js HTTP route, authorized by AI-039.2 for the official public-client OAuth flow. It
// trusts no cookie: the pending attempt (consumed exactly once by state) carries the Owner, workspace,
// redirect URI and PKCE binding, and the Owner role is re-verified server-side. It never renders tokens,
// never logs the query, and always answers with a 303 to the fixed internal Settings route on an
// allowlisted loopback origin (no open redirect). It performs no inference.
import { chatgptCallbackPort, completeChatGPTCallback, recordChatGPTCallbackOutcome } from "@/lib/composition/chatgpt-integration.server";
import { canonicalLoopbackCallbackUrl } from "@/lib/integrations/chatgpt/chatgpt-oauth";

const outcomes = new Set(["connected", "plan_usage_missing", "offline_access_missing", "denied", "expired", "authorization_cancelled", "reauthorization_required", "temporarily_unavailable"]);
const origins = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/u;

export async function GET(request: Request): Promise<Response> {
  const port = chatgptCallbackPort();
  const fallbackOrigin = `http://127.0.0.1:${port}`;
  const callbackUrl = canonicalLoopbackCallbackUrl(request, port);
  if (callbackUrl === null) recordChatGPTCallbackOutcome(Object.freeze({
    event: "callback_failed", outcome: "denied", stage: "callback_transport", failure: "invalid_callback", exchange: null,
  }));
  // Transport failures never consume pending state or enter the OAuth/Owner composition. Once
  // resolved, the domain result carries the pending attempt's original validated PAC return origin.
  const result = callbackUrl === null
    ? { outcome: "denied", returnOrigin: fallbackOrigin }
    : await completeChatGPTCallback(callbackUrl);
  const outcome = outcomes.has(result.outcome) ? result.outcome : "denied";
  const origin = origins.test(result.returnOrigin) ? result.returnOrigin : fallbackOrigin;
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/settings/integrations?chatgpt=${outcome}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
