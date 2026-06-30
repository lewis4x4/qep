#!/usr/bin/env node
// scripts/roadmap-deps-graph.mjs
// Outputs a Mermaid graph of QEP task dependencies. Useful for "what unblocks what."
// Renders on GitHub markdown; copy/paste into Notion or use mermaid-cli to SVG.
//
// Usage:
//   npm run graph                              # all streams, to stdout
//   npm run graph -- --stream A                # only Stream A
//   npm run graph -- --wave A1                 # only wave A1
//   npm run graph -- --out roadmap-graph.md    # write to file
//   npm run graph -- --only-stuck             # only blocked + pending_decision + their deps

import { writeFile } from 'node:fs/promises';
import { SupabaseClient } from './lib/supabase.mjs';

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) { return process.argv.includes(name); }

const OUT = getArg('--out');
const FILTER_STREAM = getArg('--stream');
const FILTER_WAVE = getArg('--wave');
const ONLY_STUCK = hasFlag('--only-stuck') || hasFlag('--only-blocked');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

let tasks = await supa.listAllRoadmapTasks();
const byTaskId = new Map(tasks.map(t => [t.task_id, t]));

if (FILTER_STREAM) tasks = tasks.filter(t => String(t.stream) === FILTER_STREAM);
if (FILTER_WAVE) tasks = tasks.filter(t => String(t.wave) === FILTER_WAVE);

if (ONLY_STUCK) {
  const keep = new Set();
  for (const t of tasks) {
    if (t.ship_state !== 'blocked' && t.ship_state !== 'pending_decision') continue;
    keep.add(t.task_id);
    for (const d of (t.depends_on ?? [])) {
      const dep = byTaskId.get(d);
      if (dep && dep.ship_state !== 'shipped') keep.add(d);
    }
  }
  tasks = tasks.filter(t => keep.has(t.task_id));
}

const lines = [];
lines.push('```mermaid');
lines.push('graph TD');

const safe = id => `T${id.replace(/\./g, '_').replace(/-/g, '__')}`;
const truncate = (s, n) => (s?.length > n ? s.slice(0, n - 1) + '…' : s ?? '');
const esc = s => String(s).replace(/"/g, "'").replace(/\[|\]/g, '');

// Nodes
for (const t of tasks) {
  const label = `${t.task_id}: ${esc(truncate(t.title, 50))}`;
  lines.push(`  ${safe(t.task_id)}["${label}"]:::${t.ship_state}`);
}

// Edges (dep -> task)
for (const t of tasks) {
  for (const d of (t.depends_on ?? [])) {
    if (FILTER_STREAM || FILTER_WAVE || ONLY_STUCK) {
      if (!tasks.find(x => x.task_id === d)) continue;
    }
    lines.push(`  ${safe(d)} --> ${safe(t.task_id)}`);
  }
}

// Style by ship_state
lines.push('  classDef not_started      fill:#f3f4f6,stroke:#6b7280,color:#111;');
lines.push('  classDef in_progress      fill:#dbeafe,stroke:#3b82f6,color:#111;');
lines.push('  classDef blocked          fill:#fee2e2,stroke:#ef4444,color:#111;');
lines.push('  classDef pending_decision fill:#fef9c3,stroke:#eab308,color:#111;');
lines.push('  classDef shipped          fill:#dcfce7,stroke:#10b981,color:#111;');
lines.push('  classDef deferred         fill:#e2e8f0,stroke:#64748b,color:#111;');
lines.push('  classDef na               fill:#e5e7eb,stroke:#9ca3af,color:#111;');
lines.push('```');

const output = lines.join('\n');

if (OUT) {
  await writeFile(OUT, output);
  console.log(`Wrote ${OUT} (${tasks.length} tasks)`);
} else {
  console.log(output);
}
