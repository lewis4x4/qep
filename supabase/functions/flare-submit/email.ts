/**
 * Email dispatch helper for flare reports. Fail-open: missing creds → throws "missing_credentials".
 *
 * Uses Resend API. Recipient defaults to brian.lewis@blackrockai.co per
 * Wave 6.11 build session; override via FLARE_BLOCKER_EMAIL_TO env var.
 *
 * Quality Center Phase 1 (mig 583) changed this from blocker-only to
 * every-severity. Subject line is prefixed with an emoji + severity label
 * so inbox triage is one glance. The new `status` field surfaces "Status:
 * new" in the body so the owner sees the kanban-board starting position.
 */

export type FlareSeverity = "blocker" | "bug" | "annoyance" | "idea";

interface DispatchInput {
  reportId: string;
  severity: FlareSeverity;
  description: string;
  route: string;
  url: string;
  reporterDisplayName: string;
  reporterRole: string;
  signedScreenshotUrl: string | null;
  /**
   * Initial flare_reports.status. Defaults to "new" but accepted as a
   * parameter so this helper isn't load-bearing on the constraint list.
   */
  status?: string;
}

const FLARE_EMAIL_RECIPIENT = Deno.env.get("FLARE_BLOCKER_EMAIL_TO") ?? "brian.lewis@blackrockai.co";
const FROM_EMAIL = Deno.env.get("FLARE_FROM_EMAIL") ?? "flare@qep.app";

const SEVERITY_SUBJECT_PREFIX: Record<FlareSeverity, string> = {
  blocker:  "🚨 BLOCKER",
  bug:      "🐛 Bug",
  annoyance: "⚠️ Annoyance",
  idea:     "✨ Idea",
};

export function flareEmailSubject(severity: FlareSeverity, description: string): string {
  const prefix = SEVERITY_SUBJECT_PREFIX[severity] ?? `[${severity}]`;
  const snippet = description.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${prefix} · ${snippet}`;
}

export async function dispatchFlareEmail(input: DispatchInput): Promise<null> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("missing_credentials");

  const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
  const subject = flareEmailSubject(input.severity, input.description);
  const status = input.status ?? "new";

  const body = [
    `A QEP user reported a ${input.severity.toUpperCase()} severity issue.`,
    ``,
    `**Reporter:** ${input.reporterDisplayName} (${input.reporterRole})`,
    `**Severity:** ${input.severity}`,
    `**Status:** ${status}`,
    `**Route:** ${input.route}`,
    `**URL:** ${input.url}`,
    ``,
    `## Description`,
    input.description,
    ``,
    `---`,
    ``,
    `**[Triage in QEP](${appUrl}/admin/flare/${input.reportId})** · **[Open the board](${appUrl}/admin/flare/board)**`,
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
      to: [FLARE_EMAIL_RECIPIENT],
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

/** @deprecated kept as a re-export so old imports from flare-submit don't break — wired to dispatchFlareEmail. */
export const dispatchBlockerEmail = dispatchFlareEmail;
