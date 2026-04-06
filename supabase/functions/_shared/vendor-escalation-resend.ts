/**
 * Resend API helper for vendor escalation notify_vendor steps.
 * Injectable deps support unit tests without global env/fetch mutation.
 */

export type VendorEscalationEmailBody = {
  to: string;
  subject: string;
  text: string;
};

export type VendorEscalationEmailDeps = {
  getResendApiKey?: () => string | undefined;
  getResendFrom?: () => string | undefined;
  fetch?: typeof fetch;
};

const DEFAULT_FROM = "QEP Service <onboarding@resend.dev>";

export async function sendVendorEscalationEmail(
  opts: VendorEscalationEmailBody,
  deps?: VendorEscalationEmailDeps,
): Promise<boolean> {
  const key = deps?.getResendApiKey
    ? deps.getResendApiKey()
    : Deno.env.get("RESEND_API_KEY");
  if (!key) return false;

  const from = deps?.getResendFrom != null
    ? (deps.getResendFrom!() ?? DEFAULT_FROM)
    : deps?.getResendApiKey
    ? DEFAULT_FROM
    : (Deno.env.get("RESEND_FROM") ?? DEFAULT_FROM);

  const doFetch = deps?.fetch ?? fetch;
  const res = await doFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
  });
  return res.ok;
}
