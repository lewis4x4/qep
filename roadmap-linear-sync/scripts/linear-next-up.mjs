#!/usr/bin/env node
// scripts/linear-next-up.mjs
// "What's next on the roadmap?" — finds the highest-priority pending task and
// (optionally) starts it. Reads from Supabase (source of truth).
//
// Usage:
//   npm run next                          # show next task, no changes
//   npm run next -- --start                # flip it to in_progress in Supabase
//   npm run next -- --assign you@qepusa.com   # assign Linear issue to a user
//
// Filters:
//   --owner Engineer        only tasks where owner = "Engineer"
//   --stream A              only tasks in Stream A
//   --wave A1               only tasks in wave A1
//   --json                  output as JSON (for scripts / agents)
//
// Priority order:
//   1. ship_state = not_started OR in_progress
//   2. sort_order ascending (encodes execution queue priority)
//   3. tasks whose depends_on are all shipped first
//   4. tasks not blocked by a blocking_decision are preferred

import { LinearClient } from './lib/linear.mjs';
import { SupabaseClient } from './lib/supabase.mjs';

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) { return process.argv.includes(name); }

const OWNER = getArg('--owner');
const STREAM = getArg('--stream');
const WAVE = getArg('--wave');
const START = hasFlag('--start');
const ASSIGN_EMAIL = getArg('--assign');
const AS_JSON = hasFlag('--json');

const { LINEAR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
for (const [k, v] of Object.entries({ LINEAR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(2); }
}

const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
const linear = new LinearClient(LINEAR_API_KEY);

async function loadAllActionable() {
  const filters = ['or=(ship_state.eq.not_started,ship_state.eq.in_progress)'];
  if (OWNER)  filters.push(`owner=eq.${encodeURIComponent(OWNER)}`);
  if (STREAM) filters.push(`stream=eq.${encodeURIComponent(STREAM)}`);
  if (WAVE)   filters.push(`wave=eq.${encodeURIComponent(WAVE)}`);
  const query = `select=*&${filters.join('&')}&order=sort_order.asc,task_id.asc&limit=500`;
  return supa.select('qep_roadmap_tasks', { query });
}

async function loadShippedTaskIds() {
  const rows = await supa.select('qep_roadmap_tasks', {
    query: 'select=task_id&ship_state=eq.shipped&limit=1000',
  });
  return new Set(rows.map(r => r.task_id));
}

function dependenciesSatisfied(task, shippedSet) {
  const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
  if (deps.length === 0) return true;
  return deps.every(d => shippedSet.has(d));
}

async function findNextUnblocked() {
  const [candidates, shipped] = await Promise.all([
    loadAllActionable(),
    loadShippedTaskIds(),
  ]);
  if (candidates.length === 0) return { task: null, reason: 'no_actionable_tasks' };

  const ready = candidates.filter(t =>
    dependenciesSatisfied(t, shipped) && !t.blocking_decision
  );
  if (ready.length === 0) {
    return { task: null, reason: 'all_actionable_have_blockers', total_actionable: candidates.length };
  }
  return { task: ready[0], total_actionable: candidates.length, ready_count: ready.length };
}

async function lookupLinearUserByEmail(email) {
  const data = await linear.gql(
    `query($e:String!){ users(filter:{email:{eq:$e}}){ nodes{ id name email } } }`,
    { e: email },
  );
  return data.users.nodes[0] || null;
}

const { task, reason, total_actionable, ready_count } = await findNextUnblocked();

if (!task) {
  if (AS_JSON) {
    console.log(JSON.stringify({ task: null, reason, total_actionable: total_actionable ?? 0 }));
  } else if (reason === 'no_actionable_tasks') {
    console.log('No actionable tasks match. Either everything is done, blocked, or your filters excluded everything.');
  } else {
    console.log(`Every actionable task (${total_actionable}) has unmet dependencies or a blocking_decision.`);
    console.log('Resolve a blocker or complete a dependency, then re-run.');
  }
  process.exit(0);
}

if (AS_JSON) {
  console.log(JSON.stringify({
    task_id: task.task_id,
    title: task.title,
    stream: task.stream,
    wave: task.wave,
    owner: task.owner,
    ship_state: task.ship_state,
    blocking_decision: task.blocking_decision,
    description: task.description,
    notes: task.notes,
    evidence_link: task.evidence_link,
    linear_url: task.linear_url,
    linear_issue_identifier: task.linear_issue_identifier,
    total_actionable,
    ready_count,
  }, null, 2));
} else {
  console.log('━'.repeat(70));
  console.log(`NEXT UP: ${task.task_id} — ${task.title}`);
  console.log('━'.repeat(70));
  console.log(`Stream:   ${task.stream ?? '—'}`);
  console.log(`Wave:     ${task.wave ?? '—'}`);
  console.log(`Owner:    ${task.owner ?? '—'}`);
  console.log(`State:    ${task.ship_state}`);
  if (task.description) {
    console.log(`\nDescription:\n  ${task.description.split('\n').slice(0, 4).join('\n  ')}`);
  }
  if (task.notes) {
    console.log(`\nNotes:\n  ${task.notes.split('\n').slice(0, 3).join('\n  ')}`);
  }
  if (task.evidence_link) console.log(`\nEvidence: ${task.evidence_link}`);
  if (task.linear_url) console.log(`Linear:   ${task.linear_url}`);
  console.log(`\n${ready_count} of ${total_actionable} actionable task(s) are ready to start.`);
  console.log('━'.repeat(70));
}

// --start: flip ship_state in Supabase. Trigger marks linear_sync_status='pending',
// Edge Function or cron pushes the state change to Linear.
if (START) {
  await supa.patch('qep_roadmap_tasks',
    { ship_state: 'in_progress' },
    { query: `id=eq.${task.id}` });
  console.log(`\n✓ Flipped ${task.task_id} → in_progress in Supabase.`);
  console.log('  Linear will mirror the change within seconds (Edge Function) or by next cron.');
}

if (ASSIGN_EMAIL) {
  if (!task.linear_issue_id) {
    console.warn(`\n⚠ Task ${task.task_id} has no linear_issue_id yet. Run \`npm run import\` first.`);
  } else {
    const user = await lookupLinearUserByEmail(ASSIGN_EMAIL);
    if (!user) {
      console.warn(`\n⚠ No Linear user with email "${ASSIGN_EMAIL}". Skipping assignment.`);
    } else {
      await linear.updateIssue(task.linear_issue_id, { assigneeId: user.id });
      console.log(`✓ Assigned ${task.linear_issue_identifier} to ${user.name} <${user.email}> in Linear.`);
    }
  }
}
