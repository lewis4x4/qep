import { clearOAuthStateCookieHeader } from "./oauth-state.ts";

export type OAuthErrorCode =
  | "provider_denied"
  | "not_authenticated"
  | "state_secret_missing"
  | "state_missing"
  | "state_invalid"
  | "state_mismatch"
  | "token_exchange_failed"
  | "portal_lookup_failed"
  | "save_failed"
  | "internal_error";

const OAUTH_ERROR_MESSAGES: Record<OAuthErrorCode, string> = {
  provider_denied: "HubSpot authorization was denied. Please try again.",
  not_authenticated:
    "Your session expired. Please sign in and try connecting again.",
  state_secret_missing:
    "OAuth configuration is unavailable. Contact your administrator.",
  state_missing:
    "Connection request expired. Please restart the HubSpot connection flow.",
  state_invalid:
    "Connection request could not be verified. Please restart the HubSpot connection flow.",
  state_mismatch:
    "Connection request did not match this session. Please restart the HubSpot connection flow.",
  token_exchange_failed:
    "Could not complete HubSpot authorization. Please try again.",
  portal_lookup_failed: "HubSpot account lookup failed. Please try again.",
  save_failed: "Connected account could not be saved. Please try again.",
  internal_error:
    "HubSpot connection failed due to an internal error. Please try again.",
};

export function redirectWithOAuthError(
  code: OAuthErrorCode,
  ch: Record<string, string>,
  options?: { clearStateCookie?: boolean },
): Response {
  const safeMessage = OAUTH_ERROR_MESSAGES[code];
  const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
  return redirectWithCorsHeaders(
    `${appUrl}/admin/integrations?hubspot=error&code=${code}&message=${
      encodeURIComponent(safeMessage)
    }`,
    ch,
    options?.clearStateCookie
      ? { setCookie: clearOAuthStateCookieHeader() }
      : undefined,
  );
}

export function redirectWithCorsHeaders(
  location: string,
  ch: Record<string, string>,
  options?: { setCookie?: string },
): Response {
  const response = Response.redirect(location, 302);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ch)) {
    headers.set(key, value);
  }
  if (options?.setCookie) {
    headers.append("Set-Cookie", options.setCookie);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export async function registerWebhookSubscription(
  accessToken: string,
  appId: string,
): Promise<void> {
  const listRes = await fetch(
    `https://api.hubapi.com/webhooks/v3/${appId}/subscriptions`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const existing = await listRes.json() as {
    results?: Array<{ eventType?: string; active?: boolean }>;
  };
  const alreadySubscribed = existing.results?.some(
    (subscription) =>
      subscription.eventType === "deal.propertyChange" &&
      subscription.active === true,
  );

  if (!alreadySubscribed) {
    await fetch(
      `https://api.hubapi.com/webhooks/v3/${appId}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventType: "deal.propertyChange",
          propertyName: "dealstage",
          active: true,
        }),
      },
    );
  }
}
