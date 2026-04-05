#!/usr/bin/env bun
/**
 * Parts unified model pressure checks (docs + repo guards; optional live Supabase).
 *
 * Always: doc paths, migrations:check, grep-based invariants.
 * Optional: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — light metadata queries.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

let failed = false;

function fail(msg) {
  console.error(msg);
  failed = true;
}

function ok(msg) {
  console.log(msg);
}

function read(path) {
  return readFileSync(path, "utf8");
}

const docs = [
  "docs/architecture/parts-service-unified-spec.md",
  "docs/architecture/parts-service-schema-api.md",
  "docs/testing/parts-service-pressure-matrix.md",
];

for (const rel of docs) {
  const p = join(root, rel);
  if (!existsSync(p)) fail(`MISSING: ${rel}`);
  else ok(`doc: ${rel}`);
}

const m = spawnSync("bun", ["run", "migrations:check"], {
  cwd: root,
  encoding: "utf8",
});
if (m.status !== 0) {
  fail(`migrations:check failed:\n${m.stdout ?? ""}${m.stderr ?? ""}`);
} else ok("migrations:check OK");

function mustContain(fileRel, needle, label) {
  const p = join(root, fileRel);
  if (!existsSync(p)) {
    fail(`${label}: file missing ${fileRel}`);
    return;
  }
  const txt = read(p);
  if (!txt.includes(needle)) {
    fail(`${label}: expected "${needle}" in ${fileRel}`);
  } else ok(`${label}: OK`);
}

mustContain(
  "supabase/functions/portal-api/index.ts",
  "workspaceStaffRecipientIds",
  "portal-api workspace routing",
);
mustContain(
  "supabase/functions/service-parts-manager/index.ts",
  "parts-fulfillment-mirror",
  "manager imports mirror",
);
mustContain(
  "supabase/functions/service-parts-planner/index.ts",
  "parts-fulfillment-mirror",
  "planner imports mirror",
);
mustContain(
  "supabase/functions/service-parts-manager/index.ts",
  "shop_parts_action",
  "manager event type",
);
mustContain(
  "supabase/functions/service-parts-planner/index.ts",
  "shop_parts_plan_batch",
  "planner batch event type",
);

const planner = read(join(root, "supabase/functions/service-parts-planner/index.ts"));
if (!planner.includes("is_machine_down") || !planner.includes("fulfillment_run_id")) {
  fail("planner: expected is_machine_down + fulfillment_run_id in select/wiring");
} else ok("planner: machine-down + run link present");

const base = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

if (!base || !serviceKey) {
  console.log(
    "SKIP optional live Supabase checks (set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL or VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL)",
  );
} else {
  try {
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    };
    const res = await fetch(
      `${base}/rest/v1/parts_fulfillment_events?select=id&limit=1`,
      { headers },
    );
    if (res.ok) {
      ok("live: parts_fulfillment_events reachable");
    } else if (res.status === 404) {
      const probe = await fetch(`${base}/rest/v1/profiles?select=id&limit=1`, {
        headers,
      });
      if (probe.ok) {
        ok(
          "live: Supabase REST OK (profiles); parts_fulfillment_events 404 — push migrations to this project for full fulfillment audit table",
        );
      } else {
        fail(`live: parts_fulfillment_events HTTP 404; profiles probe HTTP ${probe.status}`);
      }
    } else {
      fail(`live: parts_fulfillment_events select HTTP ${res.status}`);
    }
  } catch (e) {
    fail(`live fetch error: ${e?.message ?? e}`);
  }
}

process.exit(failed ? 2 : 0);
