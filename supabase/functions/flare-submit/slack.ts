/**
 * Slack dispatch helper. Fail-open: missing webhook → throws "missing_credentials".
 *
 * Posts a Block Kit message to SLACK_FLARE_WEBHOOK_URL with severity emoji,
 * reporter info, description, dedupe count, and deep-link buttons. Returns
 * the message ts (or "posted" placeholder if the webhook doesn't return one).
 */

interface DispatchInput {
  reportId: string;
  severity: string;
  description: string;
  route: string;
  url: string;
  reporterDisplayName: string;
  reporterRole: string;
  similarCount: number;
  signedScreenshotUrl: string | null;
}

interface DispatchResult {
  ts: string;
}

const SEVERITY_EMOJI: Record<string, string> = {
  blocker: ":rotating_light:",
  bug: ":bug:",
  annoyance: ":mag:",
  idea: ":bulb:",
};

export async function dispatchToSlack(input: DispatchInput): Promise<DispatchResult> {
  const webhookUrl = Deno.env.get("SLACK_FLARE_WEBHOOK_URL");
  if (!webhookUrl) throw new Error("missing_credentials");

  const appUrl = Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co";
  const emoji = SEVERITY_EMOJI[input.severity] ?? ":speech_balloon:";

  const dedupeLine = input.similarCount > 1
    ? `_Seen ${input.similarCount} times this week on the same route._`
    : "";

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${input.severity.toUpperCase()}* from *${input.reporterDisplayName}* (${input.reporterRole})\n> ${input.description.slice(0, 500)}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Page: \`${input.route}\``,
        },
        {
          type: "mrkdwn",
          text: `<${input.url}|Open page>`,
        },
      ],
    },
  ];

  if (dedupeLine) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: dedupeLine }],
    });
  }

  if (input.signedScreenshotUrl) {
    blocks.push({
      type: "image",
      image_url: input.signedScreenshotUrl,
      alt_text: "Flare screenshot",
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open in QEP" },
        url: `${appUrl}/admin/flare/${input.reportId}`,
        style: input.severity === "blocker" ? "danger" : "primary",
      },
    ],
  });

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${emoji} ${input.severity.toUpperCase()} flare from ${input.reporterDisplayName}: ${input.description.slice(0, 100)}`,
      blocks,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`slack_http_${res.status}: ${text.slice(0, 200)}`);
  }

  // Webhook responses don't include a ts; use "posted" sentinel
  return { ts: "posted" };
}
