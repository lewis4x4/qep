/**
 * Email dispatch helper for blocker escalation. Fail-open: missing creds → throws "missing_credentials".
 *
 * Uses Resend API. Recipient locked to brian.lewis@blackrockai.co per
 * user instruction (Wave 6.11 build session).
 *
 * Triggered ONLY when severity === 'blocker'. Other severities skip this lane.
 */

interface DispatchInput {
  reportId: string;
  description: string;
  route: string;
  url: string;
  reporterDisplayName: string;
  reporterRole: string;
  signedScreenshotUrl: string | null;
}

const BLOCKER_RECIPIENT = Deno.env.get("FLARE_BLOCKER_EMAIL_TO") ?? "brian.lewis@blackrockai.co";
const FROM_EMAIL = Deno.env.get("FLARE_FROM_EMAIL") ?? "flare@qep.app";

export async function dispatchBlockerEmail(input: DispatchInput): Promise<null> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("missing_credentials");

  const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
  const subject = `[QEP BLOCKER] ${input.description.slice(0, 60)}`;

  const body = [
    `A QEP user reported a BLOCKER severity issue.`,
    ``,
    `**Reporter:** ${input.reporterDisplayName} (${input.reporterRole})`,
    `**Route:** ${input.route}`,
    `**URL:** ${input.url}`,
    ``,
    `## Description`,
    input.description,
    ``,
    `---`,
    ``,
    `**[Triage in QEP](${appUrl}/admin/flare/${input.reportId})**`,
    ``,
    input.signedScreenshotUrl
      ? `Screenshot (signed URL, expires in 1 hour): ${input.signedScreenshotUrl}`
      : ``,
    ``,
    `Report ID: ${input.reportId}`,
  ].filter((line) => line !== undefined).join("\n");

  const html = body
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`)
    .join("");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [BLOCKER_RECIPIENT],
      subject,
      text: body,
      html,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`resend_http_${res.status}: ${text.slice(0, 200)}`);
  }

  return null;
}
