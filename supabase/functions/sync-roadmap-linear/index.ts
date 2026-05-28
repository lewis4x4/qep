// supabase/functions/sync-roadmap-linear/index.ts
//
// QEP forward sync: Supabase Database Webhook on qep_roadmap_tasks INSERT/UPDATE
// pushes a single row to Linear (QEP team).
//
// Deployment:
//   supabase functions deploy sync-roadmap-linear --no-verify-jwt
//   supabase secrets set LINEAR_API_KEY=lin_api_... LINEAR_TEAM_KEY=QEP
//
// Database Webhook setup:
//   Supabase Dashboard -> Database -> Webhooks -> Create
//   Table: public.qep_roadmap_tasks
//   Events: INSERT, UPDATE
//   HTTP method: POST
//   URL: https://iciddijgonywtxoelous.functions.supabase.co/sync-roadmap-linear
//   Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//
// One row per invocation — idempotent, fast, retryable. Nightly cron handles drift.

// deno-lint-ignore-file no-explicit-any

import { isServiceRoleCaller } from '../_shared/cron-auth.ts';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

interface QepRoadmapTask {
  id: string;
  task_id: string;
  stream: 'A' | 'B' | 'C' | 'D' | 'E';
  wave: string;
  title: string;
  description: string | null;
  ship_state:
    | 'not_started'
    | 'in_progress'
    | 'blocked'
    | 'pending_decision'
    | 'shipped'
    | 'deferred'
    | 'na';
  owner: string | null;
  blocking_decision: string | null;
  depends_on: string[] | null;
  evidence_link: string | null;
  notes: string | null;
  linear_issue_id: string | null;
  linear_issue_identifier: string | null;
  linear_url: string | null;
  linear_sync_status: string;
  linear_sync_attempt_count: number;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: QepRoadmapTask | null;
  old_record: QepRoadmapTask | null;
}

const STREAM_PROJECT_NAMES: Record<string, string> = {
  A: 'Stream A — Iron Quote',
  B: 'Stream B — Sales-Advisor Field Platform',
  C: 'Stream C — IntelliDealer Cutover',
  D: 'Stream D — Parity Validation + Decision Resolution',
  E: 'Stream E — Platform Foundation',
};

const STATUS_TYPE_MAP: Record<string, string[]> = {
  not_started:      ['backlog', 'unstarted'],
  in_progress:      ['started'],
  blocked:          ['unstarted', 'backlog'],
  pending_decision: ['unstarted', 'backlog'],
  shipped:          ['completed'],
  deferred:         ['canceled', 'completed'],
  na:               ['canceled'],
};

const NAMED_STATES: Record<string, string[]> = {
  not_started:      ['Todo', 'Backlog'],
  in_progress:      ['In Progress', 'In Review'],
  blocked:          ['Blocked'],
  pending_decision: ['Decision', 'Pending Decision', 'Pending'],
  shipped:          ['Done', 'Completed'],
  deferred:         ['Deferred'],
  na:               ['Canceled', 'Cancelled'],
};

const LINEAR_API_KEY = Deno.env.get('LINEAR_API_KEY') ?? '';
const LINEAR_TEAM_KEY = Deno.env.get('LINEAR_TEAM_KEY') ?? 'QEP';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function linearGql(query: string, variables: any = {}) {
  const res = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: LINEAR_API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Linear GQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function buildIssueTitle(t: QepRoadmapTask) {
  const prefix = t.task_id ? `${t.task_id} — ` : '';
  return `${prefix}${t.title ?? '(untitled)'}`.slice(0, 250);
}

function buildIssueBody(t: QepRoadmapTask) {
  const lines: string[] = [];
  if (t.description?.trim()) {
    lines.push(t.description.trim(), '');
  }
  if (t.notes?.trim()) {
    lines.push('### Notes', t.notes.trim(), '');
  }
  if (t.depends_on?.length) {
    lines.push('### Depends on', ...t.depends_on.map((d) => `- ${d}`), '');
  }
  if (t.blocking_decision) {
    lines.push('### Blocked by', String(t.blocking_decision).trim(), '');
  }
  if (t.evidence_link) {
    lines.push('### Evidence', String(t.evidence_link).trim(), '');
  }
  lines.push('---');
  lines.push('<!-- Mirrored from Supabase qep_roadmap_tasks. Edit in the QEP roadmap UI, not here. -->');
  lines.push('```yaml');
  lines.push(`task_id: ${t.task_id}`);
  if (t.stream) lines.push(`stream: ${t.stream}`);
  if (t.wave) lines.push(`wave: ${t.wave}`);
  if (t.owner) lines.push(`owner: ${t.owner}`);
  if (t.blocking_decision) lines.push(`blocking_decision: ${t.blocking_decision}`);
  lines.push('```');
  return lines.join('\n');
}

function resolveStateId(shipState: string, states: { id: string; name: string; type: string }[]) {
  for (const name of NAMED_STATES[shipState] ?? []) {
    const named = states.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (named) return named.id;
  }
  for (const t of STATUS_TYPE_MAP[shipState] ?? STATUS_TYPE_MAP.not_started) {
    const s = states.find((x) => x.type === t);
    if (s) return s.id;
  }
  throw new Error(`No Linear state for ship_state "${shipState}"`);
}

function deriveLabelNames(t: QepRoadmapTask): string[] {
  const out = ['mirrored-from-supabase'];
  if (t.stream) out.push(`stream:${t.stream}`);
  if (t.wave) out.push(`wave:${t.wave}`);
  if (t.owner) out.push(`owner:${t.owner}`);
  if (t.blocking_decision) out.push(`blocker:${t.blocking_decision}`);
  if (t.ship_state === 'blocked') out.push('blocked');
  if (t.ship_state === 'pending_decision') out.push('pending_decision');
  if (t.ship_state === 'deferred') out.push('deferred');
  return out;
}

function labelColor(name: string) {
  if (name.startsWith('stream:'))  return '#3b82f6';
  if (name.startsWith('wave:'))    return '#06b6d4';
  if (name.startsWith('owner:'))   return '#8b5cf6';
  if (name.startsWith('blocker:')) return '#f97316';
  if (name === 'blocked')          return '#ef4444';
  if (name === 'pending_decision') return '#eab308';
  if (name === 'deferred')         return '#64748b';
  return '#94a3b8';
}

async function supabasePatch(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/qep_roadmap_tasks?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${await res.text()}`);
}

async function syncOne(task: QepRoadmapTask) {
  // Cap retries
  if (task.linear_sync_attempt_count >= 5) {
    console.warn(`[edge] task ${task.task_id} hit attempt cap; skipping`);
    return { skipped: true };
  }

  const team = await linearGql(
    `query($key:String!){ teams(filter:{key:{eq:$key}}){ nodes{ id key name } } }`,
    { key: LINEAR_TEAM_KEY },
  );
  const teamNode = team.teams.nodes[0];
  if (!teamNode) throw new Error(`No team ${LINEAR_TEAM_KEY}`);

  const statesData = await linearGql(
    `query($teamId:ID!){ workflowStates(filter:{team:{id:{eq:$teamId}}},first:100){ nodes{ id name type } } }`,
    { teamId: teamNode.id },
  );
  const states = statesData.workflowStates.nodes;

  const projectsData = await linearGql(
    `query($teamId:ID!){ projects(filter:{accessibleTeams:{id:{eq:$teamId}}},first:100){ nodes{ id name } } }`,
    { teamId: teamNode.id },
  );
  const projectByName = new Map(projectsData.projects.nodes.map((p: any) => [p.name, p]));

  const labelsData = await linearGql(
    `query($teamId:ID!){ issueLabels(filter:{team:{id:{eq:$teamId}}},first:250){ nodes{ id name } } }`,
    { teamId: teamNode.id },
  );
  const labelByName = new Map(labelsData.issueLabels.nodes.map((l: any) => [l.name, l]));

  async function ensureLabel(name: string) {
    if (labelByName.has(name)) return labelByName.get(name)!;
    const data = await linearGql(
      `mutation($input:IssueLabelCreateInput!){ issueLabelCreate(input:$input){ success issueLabel{ id name } } }`,
      { input: { teamId: teamNode.id, name, color: labelColor(name) } },
    );
    const created = data.issueLabelCreate.issueLabel;
    labelByName.set(name, created);
    return created;
  }

  const stateId = resolveStateId(task.ship_state, states);
  const labelIds: string[] = [];
  for (const n of deriveLabelNames(task)) labelIds.push((await ensureLabel(n)).id);
  const project = task.stream ? projectByName.get(STREAM_PROJECT_NAMES[task.stream]) : null;

  const payload: any = {
    title: buildIssueTitle(task),
    description: buildIssueBody(task),
    stateId,
    labelIds,
  };
  if (project) payload.projectId = (project as any).id;

  try {
    let issue: any;
    if (task.linear_issue_id) {
      const data = await linearGql(
        `mutation($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id,input:$input){ success issue{ id identifier url } } }`,
        { id: task.linear_issue_id, input: payload },
      );
      issue = data.issueUpdate.issue;
    } else {
      const createPayload = { teamId: teamNode.id, ...payload };
      const data = await linearGql(
        `mutation($input:IssueCreateInput!){ issueCreate(input:$input){ success issue{ id identifier url } } }`,
        { input: createPayload },
      );
      issue = data.issueCreate.issue;
    }
    await supabasePatch(task.id, {
      linear_issue_id: issue.id,
      linear_issue_identifier: issue.identifier,
      linear_url: issue.url,
      linear_synced_at: new Date().toISOString(),
      linear_sync_status: 'synced',
      linear_sync_error: null,
      linear_sync_attempt_count: 0,
    });
    return { ok: true, identifier: issue.identifier };
  } catch (err) {
    await supabasePatch(task.id, {
      linear_sync_status: 'error',
      linear_sync_error: String(err).slice(0, 2000),
      linear_sync_attempt_count: (task.linear_sync_attempt_count ?? 0) + 1,
    });
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, fn: 'sync-roadmap-linear' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!LINEAR_API_KEY) {
    return new Response('LINEAR_API_KEY not configured', { status: 500 });
  }

  // Authenticate the inbound caller. This function is deployed verify_jwt=false,
  // so the gateway does NOT check auth — this is the authoritative gate. The
  // Supabase DB webhook is configured to send
  // `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`; reject anything that
  // does not carry valid service-role / internal-service credentials so the
  // endpoint can't be driven by an unauthenticated caller.
  if (!isServiceRoleCaller(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch (err) {
    return new Response(`Invalid JSON: ${err}`, { status: 400 });
  }

  if (payload.table !== 'qep_roadmap_tasks') {
    return new Response('Ignored: not qep_roadmap_tasks', { status: 200 });
  }
  if (payload.type === 'DELETE' || !payload.record) {
    return new Response('Ignored: delete or empty record', { status: 200 });
  }

  // Only act on rows the trigger marked pending. Saves API calls when the
  // writer was the sync script itself (linear_sync_status='synced').
  if (payload.record.linear_sync_status !== 'pending') {
    return new Response(`Ignored: status=${payload.record.linear_sync_status}`, { status: 200 });
  }

  try {
    const result = await syncOne(payload.record);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    console.error('[edge] sync failed:', err);
    return new Response(`Sync error: ${err}`, { status: 500 });
  }
});
