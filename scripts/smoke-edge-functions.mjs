/**
 * Quick reachability check for deployed Supabase Edge Functions (KB + ingest).
 * Does not call LLM or ingest content — OPTIONS preflight only.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=eyJ... bun run smoke:edge
 *
 * Optional: SMOKE_ORIGIN (default https://qep.blackrockai.co) must be in each function's CORS allowlist.
 */

const base = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const key = process.env.SUPABASE_ANON_KEY?.trim() ?? "";
const origin =
  process.env.SMOKE_ORIGIN?.trim() || "https://qep.blackrockai.co";

const FUNCTIONS = ["chat", "ingest", "document-admin"];

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

if (!base || !key) {
  fail(
    "Missing SUPABASE_URL or SUPABASE_ANON_KEY. Set both in the environment (never commit keys).",
  );
}

let exitCode = 0;

for (const name of FUNCTIONS) {
  const url = `${base}/functions/v1/${name}`;
  try {
    const res = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    const text = await res.text();
    if (res.status === 404) {
      console.error(`${name}: FAIL — 404 (wrong URL or function not deployed)`);
      exitCode = 1;
      continue;
    }
    if (res.status >= 200 && res.status < 300) {
      console.log(`${name}: OK (${res.status})`);
      continue;
    }
    console.error(`${name}: FAIL — HTTP ${res.status} ${text.slice(0, 120)}`);
    exitCode = 1;
  } catch (e) {
    console.error(`${name}: FAIL — ${e?.message ?? e}`);
    exitCode = 1;
  }
}

process.exit(exitCode);
