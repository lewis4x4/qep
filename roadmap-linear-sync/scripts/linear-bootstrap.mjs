#!/usr/bin/env node
// scripts/linear-bootstrap.mjs
// One-time setup for QEP: ensure the Linear team has the 5 Stream projects and
// the canonical label set. Idempotent — safe to re-run.
//
// Usage:
//   LINEAR_API_KEY=lin_api_... LINEAR_TEAM_KEY=QEP node scripts/linear-bootstrap.mjs
//
// Optional flags:
//   --dry-run        Print what would be created without mutating Linear.
//   --colors-only    Re-apply label colors only (skip projects).

import { LinearClient } from './lib/linear.mjs';
import { STREAM_PROJECT_NAMES, STANDARD_LABEL_COLORS } from './lib/status-map.mjs';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const COLORS_ONLY = args.has('--colors-only');

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_TEAM_KEY = process.env.LINEAR_TEAM_KEY || 'QEP';

if (!LINEAR_API_KEY) {
  console.error('LINEAR_API_KEY env var is required.');
  process.exit(2);
}

const log = (...a) => console.log('[bootstrap]', ...a);

async function main() {
  const linear = new LinearClient(LINEAR_API_KEY);
  log(`Looking up team "${LINEAR_TEAM_KEY}"...`);
  const team = await linear.getTeamByKey(LINEAR_TEAM_KEY);
  if (!team) {
    console.error(`No team found with key "${LINEAR_TEAM_KEY}". Create it in Linear Settings -> Workspace -> Teams first.`);
    process.exit(3);
  }
  log(`Team: ${team.name} (${team.id})`);

  // ---- Workflow states sanity check ---------------------------------------
  const states = await linear.getWorkflowStates(team.id);
  log(`Workflow states: ${states.map(s => `${s.name}(${s.type})`).join(', ')}`);

  // Each QEP ship_state needs at least one acceptable Linear workflow state.
  // Aliases accepted by the status-map; this check just warns if none match.
  const requiredCoverage = {
    blocked:          ['blocked'],
    pending_decision: ['decision', 'pending decision', 'pending'],
    deferred:         ['deferred'],
  };
  for (const [shipState, candidates] of Object.entries(requiredCoverage)) {
    const has = states.some(s => candidates.includes(s.name.toLowerCase()));
    if (!has) {
      log(`WARNING: no Linear workflow state matches ship_state "${shipState}".`);
      log(`  Accepted names (case-insensitive): ${candidates.join(', ')}`);
      log(`  Linear API does not allow creating workflow states. Add one manually:`);
      log(`  Settings -> Teams -> ${team.name} -> Workflow -> + Add state`);
    }
  }

  // ---- Stream projects ----------------------------------------------------
  if (!COLORS_ONLY) {
    const existingProjects = await linear.listProjects(team.id);
    const byName = new Map(existingProjects.map(p => [p.name, p]));
    for (const [stream, name] of Object.entries(STREAM_PROJECT_NAMES)) {
      if (byName.has(name)) {
        log(`Project OK: ${name}`);
        continue;
      }
      if (DRY_RUN) {
        log(`(dry-run) would create project: ${name}`);
        continue;
      }
      const created = await linear.createProject({
        teamId: team.id,
        name,
        description: `QEP roadmap mirror — Stream ${stream} from QEP_UNIFIED_ROADMAP_2026-05-19.md. Source of truth is Supabase qep_roadmap_tasks.`,
      });
      log(`Created project: ${created.name} (${created.id})`);
    }
  }

  // ---- Standard labels ----------------------------------------------------
  // Stream/wave/owner/blocker labels get created on-demand by the importer.
  // Pre-seed the status flag labels + the mirror marker.
  const seedLabels = [
    { name: 'mirrored-from-supabase', color: '#64748b' },
    { name: 'blocked', color: STANDARD_LABEL_COLORS.blocked },
    { name: 'pending_decision', color: STANDARD_LABEL_COLORS.pending_decision },
    { name: 'deferred', color: STANDARD_LABEL_COLORS.deferred },
  ];

  const existingLabels = await linear.listLabels(team.id);
  const labelByName = new Map(existingLabels.map(l => [l.name, l]));
  for (const seed of seedLabels) {
    if (labelByName.has(seed.name)) {
      log(`Label OK: ${seed.name}`);
      continue;
    }
    if (DRY_RUN) {
      log(`(dry-run) would create label: ${seed.name}`);
      continue;
    }
    const created = await linear.createLabel({ teamId: team.id, name: seed.name, color: seed.color });
    log(`Created label: ${created.name}`);
  }

  log('Bootstrap complete.');
}

main().catch(err => {
  console.error('[bootstrap] FAILED:', err);
  process.exit(1);
});
