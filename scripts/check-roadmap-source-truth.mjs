#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const expectedStreams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const expectedProjectNames = {
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
const expectedSeedCounts = { G: 14, H: 15, I: 8, J: 2, K: 4 };

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`${label} missing ${JSON.stringify(needle)}`);
}

function collectRoadmapStreamEnumValues() {
  const dir = join(repoRoot, 'supabase/migrations');
  const values = new Set();
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.sql')).sort()) {
    const text = readFileSync(join(dir, name), 'utf8');
    const createMatch = text.match(/CREATE\s+TYPE\s+public\.qep_roadmap_stream\s+AS\s+ENUM\s*\(([^)]+)\)/i);
    if (createMatch) {
      for (const match of createMatch[1].matchAll(/'([^']+)'/g)) values.add(match[1]);
    }
    for (const match of text.matchAll(/qep_roadmap_stream\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi)) {
      values.add(match[1]);
    }
  }
  return values;
}

const enumValues = collectRoadmapStreamEnumValues();
for (const stream of expectedStreams) {
  if (!enumValues.has(stream)) fail(`qep_roadmap_stream enum is missing ${stream}`);
}

const statusMap = read('roadmap-linear-sync/scripts/lib/status-map.mjs');
const regen = read('roadmap-linear-sync/scripts/regen-unified-roadmap.mjs');
const edgeForwardSync = read('supabase/functions/sync-roadmap-linear/index.ts');
const roadmapPackageEdgeForwardSync = read('roadmap-linear-sync/supabase/functions/sync-roadmap-linear/index.ts');
for (const [stream, projectName] of Object.entries(expectedProjectNames)) {
  assertIncludes(statusMap, `${stream}: '${projectName}'`, 'status-map STREAM_PROJECT_NAMES');
  assertIncludes(regen, `${stream}: '${projectName}'`, 'regen STREAM_LABELS');
  assertIncludes(edgeForwardSync, `${stream}: '${projectName}'`, 'edge sync STREAM_PROJECT_NAMES');
  assertIncludes(
    roadmapPackageEdgeForwardSync,
    `${stream}: '${projectName}'`,
    'roadmap-linear-sync package edge sync STREAM_PROJECT_NAMES',
  );
}

assertIncludes(
  edgeForwardSync,
  "stream: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';",
  'edge sync QepRoadmapTask.stream type',
);
assertIncludes(
  roadmapPackageEdgeForwardSync,
  "stream: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';",
  'roadmap-linear-sync package edge sync QepRoadmapTask.stream type',
);

const phaseOneMigration = read('supabase/migrations/646_qep_phase_one_source_of_truth_streams_g_to_k.sql');
for (const [stream, count] of Object.entries(expectedSeedCounts)) {
  const matches = [...phaseOneMigration.matchAll(new RegExp(`\\('${stream}\\d+\\.1',\\s*'${stream}'`, 'g'))];
  if (matches.length !== count) {
    fail(`migration 646 expected ${count} seed rows for Stream ${stream}, found ${matches.length}`);
  }
}
assertIncludes(phaseOneMigration, 'BLK-FIN-WORKING-SESSION', 'migration 646 Stream K gate');
assertIncludes(phaseOneMigration, 'PART 2', 'migration 646 safety note for gated source SQL');

if (failures.length > 0) {
  console.error('Roadmap source-of-truth audit failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Roadmap source-of-truth audit passed: streams ${expectedStreams.join(',')} backed by enum, seed migration, Linear maps, and roadmap labels.`,
);
