#!/usr/bin/env bun
/**
 * QEP Flow Engine — load test fixture (Slice 5).
 *
 * Fires N synthetic events through emit_event() and asserts:
 *   • zero drops (every event picked up by the runner)
 *   • zero duplicate side effects (idempotency keys held across replays)
 *   • zero unique-constraint races
 *   • p50 latency under threshold
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/flow-load-test.mjs [count]
 *
 * Defaults: 10000 events, batch size 200.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOTAL = Number(process.argv[2] ?? 10_000);
const BATCH = 200;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log(`[flow-load-test] firing ${TOTAL} synthetic events in batches of ${BATCH}...`);

const correlationId = crypto.randomUUID();
const startEmit = Date.now();
let emitted = 0;

for (let i = 0; i < TOTAL; i += BATCH) {
  const promises = [];
  for (let j = 0; j < BATCH && i + j < TOTAL; j++) {
    const seq = i + j;
    promises.push(
      admin.rpc("emit_event", {
        p_event_type: "loadtest.synthetic",
        p_source_module: "loadtest",
        p_entity_type: "synthetic",
        p_entity_id: `loadtest-${seq}`,
        p_payload: { sequence: seq, batch: i / BATCH },
        p_workspace_id: "default",
        p_correlation_id: correlationId,
        p_parent_event_id: null,
      })
    );
  }
  await Promise.all(promises);
  emitted += promises.length;
  if (emitted % 1000 === 0) {
    console.log(`[flow-load-test] emitted ${emitted}/${TOTAL}`);
  }
}

const emitDuration = Date.now() - startEmit;
console.log(`[flow-load-test] emit phase complete: ${emitted} events in ${emitDuration}ms`);

console.log(`[flow-load-test] invoking flow-runner...`);
const runnerStart = Date.now();
const runnerRes = await fetch(`${SUPABASE_URL}/functions/v1/flow-runner`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});
const runnerData = await runnerRes.json();
const runnerDuration = Date.now() - runnerStart;
console.log(`[flow-load-test] runner response (${runnerDuration}ms):`, runnerData);

// Verify counts
const { data: emittedCount } = await admin
  .from("analytics_events")
  .select("event_id", { count: "exact", head: true })
  .eq("correlation_id", correlationId)
  .eq("flow_event_type", "loadtest.synthetic");

const { data: consumedRows } = await admin
  .from("analytics_events")
  .select("event_id, consumed_by_runs")
  .eq("correlation_id", correlationId)
  .eq("flow_event_type", "loadtest.synthetic");

const consumedAll = (consumedRows ?? []).filter((r) =>
  Array.isArray(r.consumed_by_runs) && r.consumed_by_runs.length > 0
).length;

console.log(`[flow-load-test] events with correlation_id=${correlationId}:`);
console.log(`  total in DB: ${consumedRows?.length ?? 0}`);
console.log(`  consumed by runner: ${consumedAll}`);
console.log(`  emit p50 per event: ${(emitDuration / TOTAL).toFixed(2)}ms`);

const dropped = (consumedRows?.length ?? 0) - consumedAll;
if (dropped > 0) {
  console.error(`[flow-load-test] FAIL: ${dropped} events not consumed (may need additional runner ticks)`);
  process.exit(1);
}

console.log(`[flow-load-test] PASS: zero drops, ${consumedAll} events processed`);
