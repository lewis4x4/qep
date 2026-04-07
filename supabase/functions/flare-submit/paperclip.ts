/**
 * Paperclip dispatch helper. Fail-open: missing creds → throws "missing_credentials".
 *
 * Posts to ${PAPERCLIP_BASE_URL}/api/issues with `source: 'flare'` so the
 * Paperclip CEO agent can route to the right sub-agent for triage and
 * potentially auto-draft a fix PR.
 */

interface DispatchInput {
  reportId: string;
  severity: string;
  description: string;
  route: string;
  url: string;
  reproducerSteps: string;
  hypothesisPattern: string | null;
  signedScreenshotUrl: string | null;
  reporterDisplayName: string;
}

interface DispatchResult {
  issue_id: string;
  issue_url: string;
}

export async function dispatchToPaperclip(input: DispatchInput): Promise<DispatchResult> {
  const apiKey = Deno.env.get("PAPERCLIP_API_KEY");
  const baseUrl = Deno.env.get("PAPERCLIP_BASE_URL");
  if (!apiKey || !baseUrl) throw new Error("missing_credentials");

  const title = `[${input.severity.toUpperCase()}] ${input.description.slice(0, 80)}`;
  const body = [
    `**Reporter:** ${input.reporterDisplayName}`,
    `**Severity:** ${input.severity}`,
    `**Route:** \`${input.route}\``,
    `**URL:** ${input.url}`,
    "",
    "## Description",
    input.description,
    "",
    input.hypothesisPattern ? `## Hypothesis\n${input.hypothesisPattern}\n` : "",
    "## Steps to reproduce (auto-generated)",
    input.reproducerSteps,
    "",
    input.signedScreenshotUrl ? `## Screenshot\n${input.signedScreenshotUrl}\n` : "",
  ].filter(Boolean).join("\n");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project: "QEP",
      title,
      body,
      source: "flare",
      flare_report_id: input.reportId,
      severity: input.severity,
      route_to: "ceo",
      labels: ["flare", `severity:${input.severity}`],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`paperclip_http_${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => ({}));
  const issueId = String(data?.id ?? data?.issue_id ?? "");
  const issueUrl = String(data?.url ?? `${baseUrl.replace(/\/$/, "")}/issues/${issueId}`);
  if (!issueId) throw new Error("paperclip_no_issue_id");

  return { issue_id: issueId, issue_url: issueUrl };
}
