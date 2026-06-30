// supabase/functions/sync-linear-to-roadmap/index.ts
//
// QEP reverse sync: Linear webhook -> Supabase qep_roadmap_tasks.
// Drag a card / change a state in Linear and the change flows back.
// Anti-ping-pong via actor-ID check and the sync_status_from_linear_qep RPC
// (which suppresses the "mark pending" trigger).
//
// Deployment:
//   supabase functions deploy sync-linear-to-roadmap --no-verify-jwt
//   supabase secrets set \
//     LINEAR_WEBHOOK_SECRET=lwsec_... \
//     LINEAR_SYNC_USER_ID=<from `npm run whoami`>
//
// Linear webhook setup:
//   Linear -> Settings -> API -> Webhooks -> New webhook
//   - URL: https://iciddijgonywtxoelous.functions.supabase.co/sync-linear-to-roadmap
//   - Resource types: Issue (only Issue is needed for status sync)
//   - All public teams: off; pick the QEP team only
//   - Signing secret: generate, copy, paste into LINEAR_WEBHOOK_SECRET

// deno-lint-ignore-file no-explicit-any

const LINEAR_WEBHOOK_SECRET   = Deno.env.get('LINEAR_WEBHOOK_SECRET')     ?? '';
const LINEAR_SYNC_USER_ID     = Deno.env.get('LINEAR_SYNC_USER_ID')       ?? '';
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ---------------------------------------------------------------------------
// HMAC verification (Linear signs request bodies with the webhook secret)
// ---------------------------------------------------------------------------
async function verifyLinearSignature(body: string, signatureHex: string, secret: string): Promise<boolean> {
  if (!secret || !signatureHex) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (expected.length !== signatureHex.length) return false;
  // Timing-safe compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHex.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractTaskId(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = description.match(/^task_id:\s*([A-Za-z0-9._-]+)\s*$/m);
  return m ? m[1] : null;
}

function linearStateToShipState(state: { name?: string; type?: string }): string {
  const name = state?.name?.toLowerCase();
  // Named-state checks first — these win over type
  if (name === 'blocked')             return 'blocked';
  if (name === 'decision')            return 'pending_decision';
  if (name === 'pending decision')    return 'pending_decision';
  if (name === 'pending')             return 'pending_decision';
  if (name === 'deferred')            return 'deferred';
  // Type fallback
  switch (state?.type) {
    case 'backlog':
    case 'unstarted':
      return 'not_started';
    case 'started':
      return 'in_progress';
    case 'completed':
      return 'shipped';
    case 'canceled':
      return 'na';
    default:
      return 'not_started';
  }
}

async function callRpcSyncStatus(args: {
  taskId: string;
  newStatus: string;
  actor: string;
  webhookId: string | null;
  linearIssueId: string | null;
}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_status_from_linear_qep`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      p_task_id: args.taskId,
      p_new_status: args.newStatus,
      p_actor: args.actor,
      p_webhook_id: args.webhookId,
      p_linear_issue_id: args.linearIssueId,
    }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function logEvent(payload: {
  direction: string;
  task_id?: string | null;
  linear_issue_id?: string | null;
  action: string;
  changed_fields?: any;
  error_message?: string | null;
  webhook_id?: string | null;
  actor?: string | null;
}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/qep_roadmap_sync_events`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[reverse-sync] failed to log event:', err);
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'GET') {
    // Health probe
    return new Response(JSON.stringify({ ok: true, fn: 'sync-linear-to-roadmap' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!LINEAR_WEBHOOK_SECRET) {
    return new Response('LINEAR_WEBHOOK_SECRET not configured', { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get('Linear-Signature') ?? '';

  const valid = await verifyLinearSignature(body, signature, LINEAR_WEBHOOK_SECRET);
  if (!valid) {
    console.warn('[reverse-sync] invalid signature');
    return new Response('Invalid signature', { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch (err) {
    return new Response(`Invalid JSON: ${err}`, { status: 400 });
  }

  const webhookId  = event.webhookId   ?? null;
  const actorId    = event.actor?.id   ?? null;
  const actorName  = event.actor?.name ?? 'unknown';
  const issueId    = event.data?.id    ?? null;

  // Only Issue events
  if (event.type !== 'Issue') {
    return new Response('Ignored: not Issue', { status: 200 });
  }
  if (event.action !== 'update') {
    return new Response(`Ignored: action=${event.action}`, { status: 200 });
  }

  // ANTI-PING-PONG: if the actor is the sync user, skip — we caused this
  if (LINEAR_SYNC_USER_ID && actorId === LINEAR_SYNC_USER_ID) {
    return new Response('Ignored: sync user actor', { status: 200 });
  }

  // Only react to state changes; everything else is computed from Supabase
  // and would be overwritten on next forward sync anyway.
  const updatedFrom = event.updatedFrom ?? {};
  if (!('stateId' in updatedFrom)) {
    return new Response('Ignored: state unchanged', { status: 200 });
  }

  // Recover task_id from the description block (canonical re-discovery key)
  const taskId = extractTaskId(event.data?.description);
  if (!taskId) {
    await logEvent({
      direction: 'linear_to_supabase',
      linear_issue_id: issueId,
      action: 'skip',
      changed_fields: { reason: 'no_task_id_marker' },
      webhook_id: webhookId,
      actor: actorName,
    });
    return new Response('Ignored: no task_id marker (not a mirrored issue)', { status: 200 });
  }

  const state = event.data?.state;
  if (!state) {
    return new Response('Ignored: no state object on event', { status: 400 });
  }
  const newStatus = linearStateToShipState(state);

  try {
    await callRpcSyncStatus({
      taskId,
      newStatus,
      actor: actorName,
      webhookId,
      linearIssueId: issueId,
    });
    return new Response(JSON.stringify({ task_id: taskId, new_status: newStatus }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    console.error('[reverse-sync] RPC failed:', err);
    await logEvent({
      direction: 'linear_to_supabase',
      task_id: taskId,
      linear_issue_id: issueId,
      action: 'error',
      error_message: String(err).slice(0, 2000),
      webhook_id: webhookId,
      actor: actorName,
    });
    return new Response(`RPC failed: ${err}`, { status: 500 });
  }
});
