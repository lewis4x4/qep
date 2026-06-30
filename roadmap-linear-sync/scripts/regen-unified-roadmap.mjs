#!/usr/bin/env node
// scripts/regen-unified-roadmap.mjs
// Replaces the snippet between <!-- ROADMAP_COUNTS_START --> and
// <!-- ROADMAP_COUNTS_END --> in the QEP unified roadmap markdown with a
// freshly-generated summary table from the live qep_roadmap_tasks data.
//
// Usage:
//   npm run regen:roadmap                                            # default path below
//   npm run regen:roadmap -- "QEP (1)/QEP_UNIFIED_ROADMAP_2026-05-19.md"
//
// CI: .github/workflows/regen-unified-roadmap.yml runs this weekly.

import { readFile, writeFile } from 'node:fs/promises';
import { SupabaseClient } from './lib/supabase.mjs';

const ROADMAP_PATH = process.argv[2] || 'QEP (1)/QEP_UNIFIED_ROADMAP_2026-05-19.md';
const START_MARKER = '<!-- ROADMAP_COUNTS_START -->';
const END_MARKER   = '<!-- ROADMAP_COUNTS_END -->';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(2); }
}
const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

const tasks = await supa.listAllRoadmapTasks();

// Aggregate by stream
const STREAM_LABELS = {
  A: 'Stream A — Iron Quote',
  B: 'Stream B — Sales-Advisor Field Platform',
  C: 'Stream C — IntelliDealer Cutover',
  D: 'Stream D — Parity Validation + Decision Resolution',
  E: 'Stream E — Platform Foundation',
  F: 'Stream F — Decision Velocity',
  G: 'Stream G — Parts Department',
  H: 'Stream H — Service Department',
  I: 'Stream I — Grapple-Truck Production',
  J: 'Stream J — Workforce',
  K: 'Stream K — Financials Re-architecture',
};

const byStream = new Map();
const totals = { shipped: 0, in_progress: 0, blocked: 0, pending_decision: 0, deferred: 0, na: 0, not_started: 0 };

for (const t of tasks) {
  const stream = t.stream ?? '—';
  if (!byStream.has(stream)) {
    byStream.set(stream, { total: 0, shipped: 0, in_progress: 0, blocked: 0, pending_decision: 0, deferred: 0, na: 0, not_started: 0 });
  }
  const s = byStream.get(stream);
  s.total++;
  const state = t.ship_state || 'not_started';
  if (s[state] !== undefined) {
    s[state]++;
    totals[state]++;
  } else {
    s.not_started++;
    totals.not_started++;
  }
}

const today = new Date().toISOString().slice(0, 10);
const lines = [START_MARKER, ''];
lines.push(`**Roadmap snapshot** — auto-generated ${today}. Do not hand-edit; run \`npm run regen:roadmap\`.`);
lines.push('');
lines.push('| Stream | Total | Shipped | In progress | Pending decision | Blocked | Deferred | N/A | Not started | % shipped |');
lines.push('|--------|------:|--------:|------------:|-----------------:|--------:|---------:|----:|------------:|----------:|');

const streams = [...byStream.keys()].sort();
for (const stream of streams) {
  const s = byStream.get(stream);
  const pct = s.total > 0 ? ((s.shipped / s.total) * 100).toFixed(0) : '—';
  const label = STREAM_LABELS[stream] ?? stream;
  lines.push(`| ${label} | ${s.total} | ${s.shipped} | ${s.in_progress} | ${s.pending_decision} | ${s.blocked} | ${s.deferred} | ${s.na} | ${s.not_started} | ${pct}% |`);
}

const totalPct = tasks.length > 0 ? ((totals.shipped / tasks.length) * 100).toFixed(0) : '—';
lines.push(`| **All** | **${tasks.length}** | **${totals.shipped}** | **${totals.in_progress}** | **${totals.pending_decision}** | **${totals.blocked}** | **${totals.deferred}** | **${totals.na}** | **${totals.not_started}** | **${totalPct}%** |`);

lines.push('');
lines.push(`_Source: \`qep_roadmap_tasks\` in Supabase. Linear mirror: 1 issue per row. Regenerate via \`npm run regen:roadmap\`._`);
lines.push('');

// Top 10 blocked + pending_decision — surface what's in the way
const stuck = tasks.filter(t => t.ship_state === 'blocked' || t.ship_state === 'pending_decision');
if (stuck.length > 0) {
  lines.push(`**Currently stuck — blocked or pending decision (${stuck.length}):**`);
  lines.push('');
  for (const t of stuck.slice(0, 15)) {
    const tag = t.ship_state === 'blocked' ? '🔒' : '⏸';
    const reason = t.blocking_decision ?? '';
    lines.push(`- ${tag} \`${t.task_id}\` — ${t.title}${reason ? `  (${reason})` : ''}`);
  }
  if (stuck.length > 15) lines.push(`- _…and ${stuck.length - 15} more_`);
  lines.push('');
}

lines.push(END_MARKER);
const snippet = lines.join('\n');

let original;
try {
  original = await readFile(ROADMAP_PATH, 'utf-8');
} catch (err) {
  if (err.code === 'ENOENT') {
    await writeFile(ROADMAP_PATH, `# QEP Unified Roadmap\n\n${snippet}\n`);
    console.log(`Created ${ROADMAP_PATH} with fresh snapshot.`);
    process.exit(0);
  }
  throw err;
}

if (!original.includes(START_MARKER)) {
  const updated = original.replace(/\n*$/, '\n\n') + snippet + '\n';
  await writeFile(ROADMAP_PATH, updated);
  console.log(`Appended snapshot block to ${ROADMAP_PATH}.`);
  process.exit(0);
}

const before = original.split(START_MARKER)[0];
const after = original.split(END_MARKER)[1] ?? '';
await writeFile(ROADMAP_PATH, before + snippet + after);
console.log(`Updated ${ROADMAP_PATH} snapshot block.`);
