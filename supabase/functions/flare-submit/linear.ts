/**
 * Linear dispatch helper. Fail-open: missing creds → throws "missing_credentials".
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

export async function dispatchToLinear(input: DispatchInput): Promise<DispatchResult> {
  const apiKey = Deno.env.get("LINEAR_API_KEY");
  const teamId = Deno.env.get("LINEAR_QEP_TEAM_ID");
  if (!apiKey || !teamId) throw new Error("missing_credentials");

  const assigneeId = Deno.env.get("LINEAR_DEFAULT_ASSIGNEE_ID");

  // Resolve label IDs by name (spec §8: flare + severity:* + route:*).
  // Linear requires UUIDs, not names. We look them up and create if missing.
  // Failures here do NOT block issue creation — labelIds falls back to [].
  const desiredLabels = [
    "flare",
    `severity:${input.severity}`,
    `route:${input.route ?? "unknown"}`,
  ];
  let labelIds: string[] = [];
  try {
    labelIds = await resolveOrCreateLabelIds(apiKey, teamId, desiredLabels);
  } catch (_err) {
    // labelIds stays []
  }

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
    input.signedScreenshotUrl ? `## Screenshot\n![screenshot](${input.signedScreenshotUrl})\n` : "",
    `---`,
    `[View full context in QEP](${Deno.env.get("APP_URL") ?? "https://qep.blackrockai.co"}/admin/flare/${input.reportId})`,
    `Flare report id: \`${input.reportId}\``,
  ].filter(Boolean).join("\n");

  const mutation = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }
  `;

  const variables = {
    input: {
      teamId,
      title,
      description: body,
      assigneeId: assigneeId ?? undefined,
      labelIds,
    },
  };

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: mutation, variables }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`linear_http_${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.errors) {
    throw new Error(`linear_graphql: ${JSON.stringify(data.errors).slice(0, 200)}`);
  }
  const issue = data.data?.issueCreate?.issue;
  if (!issue) throw new Error("linear_no_issue_returned");
  return { issue_id: issue.id, issue_url: issue.url };
}

/**
 * Look up label IDs by name within a team; create any that don't exist.
 * Linear's `issueLabelCreate` is idempotent enough — duplicate-name errors
 * are caught and the existing label re-queried.
 */
async function resolveOrCreateLabelIds(apiKey: string, teamId: string, names: string[]): Promise<string[]> {
  const queryRes = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query Labels($teamId: String!) { team(id: $teamId) { labels(first: 250) { nodes { id name } } } }`,
      variables: { teamId },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!queryRes.ok) throw new Error(`label_query_${queryRes.status}`);
  const queryData = await queryRes.json();
  const existing: { id: string; name: string }[] = queryData?.data?.team?.labels?.nodes ?? [];
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]));

  const ids: string[] = [];
  for (const name of names) {
    const hit = byName.get(name.toLowerCase());
    if (hit) {
      ids.push(hit);
      continue;
    }
    try {
      const createRes = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `mutation L($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }`,
          variables: { input: { teamId, name } },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      const createData = await createRes.json();
      const newId = createData?.data?.issueLabelCreate?.issueLabel?.id;
      if (newId) ids.push(newId);
    } catch { /* skip */ }
  }
  return ids;
}
