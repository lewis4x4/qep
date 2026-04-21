#!/usr/bin/env bun

/**
 * Edge-function auth audit.
 *
 * Prevents the recurring ES256 JWT bug class where a frontend-called edge
 * function either (a) isn't registered in supabase/config.toml and inherits
 * the gateway's default verify_jwt=true (gateway rejects ES256 with
 * UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM), or (b) uses the argless
 * `supabase.auth.getUser()` call (supabase-js's local verifier rejects ES256
 * with the same error). Either path silently 401s every legit user session.
 *
 * Hard fails (block the build) are reserved for frontend-called functions
 * — those are the ones that break the moonshot demo. Everything else is
 * warn-only with a soft allowlist at scripts/edge-auth-allowlist.json for
 * legacy unmigrated functions.
 *
 * Canonical auth pattern: _shared/service-auth.ts → requireServiceUser.
 * It calls GoTrue's /auth/v1/user endpoint directly, so it's
 * algorithm-agnostic (HS256, ES256, RS256 all work).
 *
 * Run manually:  bun ./scripts/check-edge-function-auth.mjs
 * Run in build:  bun run build  (invokes this automatically)
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const functionsDir = join(repoRoot, "supabase", "functions");
const configPath = join(repoRoot, "supabase", "config.toml");
const frontendDir = join(repoRoot, "apps", "web", "src");
const allowlistPath = join(repoRoot, "scripts", "edge-auth-allowlist.json");

const hardErrors = [];
const warnings = [];

// ── 1. Collect edge function folders ──────────────────────────────────────
let functionNames;
try {
  functionNames = readdirSync(functionsDir)
    .filter((name) => !name.startsWith("_") && !name.startsWith("."))
    .filter((name) => {
      const p = join(functionsDir, name);
      try { return statSync(p).isDirectory(); } catch { return false; }
    })
    .sort();
} catch (err) {
  console.error(`edge-function audit failed: cannot read ${functionsDir}: ${err}`);
  process.exit(1);
}

// ── 2. Parse config.toml for [functions.X] blocks + verify_jwt values ─────
const configToml = readFileSync(configPath, "utf8");
const configEntries = new Map(); // name -> { verifyJwt: boolean | null }

{
  const blockRegex = /^\[functions\.([a-z0-9-]+)\]\s*$/gm;
  let match;
  while ((match = blockRegex.exec(configToml)) !== null) {
    const name = match[1];
    const rest = configToml.slice(match.index + match[0].length);
    const nextBlockIdx = rest.search(/^\[/m);
    const block = nextBlockIdx >= 0 ? rest.slice(0, nextBlockIdx) : rest;
    const vm = block.match(/^\s*verify_jwt\s*=\s*(true|false)/m);
    configEntries.set(name, { verifyJwt: vm ? vm[1] === "true" : null });
  }
}

// ── 3. Collect frontend-called function names (/functions/v1/<name>) ──────
const frontendCalled = new Set();
{
  const stack = [frontendDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (entry === "node_modules" || entry === "dist") continue;
        stack.push(full);
      } else if (/\.(tsx?|jsx?|mjs)$/.test(entry)) {
        const text = readFileSync(full, "utf8");
        const re = /\/functions\/v1\/([a-z0-9-]+)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          frontendCalled.add(m[1]);
        }
      }
    }
  }
}

// ── 4. Scan each edge function for argless auth.getUser() ─────────────────
const arglessAuthFns = new Set();
for (const name of functionNames) {
  const indexPath = join(functionsDir, name, "index.ts");
  if (!existsSync(indexPath)) continue;
  const src = readFileSync(indexPath, "utf8");
  // Match `.auth.getUser()` (no argument) — the ES256-rejecting variant.
  // `.auth.getUser(token)` is fine.
  if (/\.auth\.getUser\s*\(\s*\)/.test(src)) {
    arglessAuthFns.add(name);
  }
}

// ── 5. Load allowlist ─────────────────────────────────────────────────────
let allowlist = { unregistered_in_config: [], argless_get_user: [] };
if (existsSync(allowlistPath)) {
  try {
    allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
  } catch (err) {
    console.error(`edge-function audit failed: malformed ${relative(repoRoot, allowlistPath)}: ${err}`);
    process.exit(1);
  }
}
const unregAllow = new Set(allowlist.unregistered_in_config ?? []);
const arglessAllow = new Set(allowlist.argless_get_user ?? []);

// ── 6. Evaluate the rules ─────────────────────────────────────────────────
// Rule model: HARD-FAIL only for NEW violations. Legacy violations are
// tracked in the allowlist and surface as warnings so they stay visible
// but don't block the build. The day a legacy function is migrated, its
// allowlist entry is removed; if someone reintroduces the bug later,
// the audit flips back to a hard fail.
for (const name of functionNames) {
  const entry = configEntries.get(name);
  const inConfig = entry != null;
  const verifyJwt = entry?.verifyJwt;

  const isFrontendCalled = frontendCalled.has(name);
  const hasArgless = arglessAuthFns.has(name);
  const unregisteredViolation = !inConfig || verifyJwt !== false;

  // HARD: frontend-called function must be registered with verify_jwt=false,
  // unless explicitly allowlisted as legacy.
  if (isFrontendCalled && unregisteredViolation && !unregAllow.has(name)) {
    hardErrors.push(
      `${name}: called from apps/web but ${!inConfig ? "not registered in supabase/config.toml" : `has verify_jwt=${verifyJwt}`}. ` +
      `Gateway will reject ES256 user JWTs. Add [functions.${name}] verify_jwt=false.`,
    );
  }

  // HARD: frontend-called function must not use argless auth.getUser(),
  // unless explicitly allowlisted as legacy.
  if (isFrontendCalled && hasArgless && !arglessAllow.has(name)) {
    hardErrors.push(
      `${name}: frontend-called and uses \`supabase.auth.getUser()\` (no arg). ` +
      `supabase-js v2's local verifier rejects ES256 with "Unsupported JWT algorithm". ` +
      `Refactor to _shared/service-auth.ts::requireServiceUser.`,
    );
  }

  // SOFT: legacy allowlisted functions stay visible as warnings so we see
  // the migration backlog every build.
  if (isFrontendCalled && unregisteredViolation && unregAllow.has(name)) {
    warnings.push(
      `${name}: legacy frontend-called function not registered in config.toml — ES256 sessions will fail. Migration pending.`,
    );
  }
  if (isFrontendCalled && hasArgless && arglessAllow.has(name)) {
    warnings.push(
      `${name}: legacy frontend-called function still on argless auth.getUser() — ES256 sessions will fail. Migration pending.`,
    );
  }

  // SOFT: every function should be in config.toml; allowlist covers legacy.
  if (!inConfig && !isFrontendCalled && !unregAllow.has(name)) {
    warnings.push(
      `${name}: not registered in supabase/config.toml. If this is a new function, ` +
      `add [functions.${name}] with an explicit verify_jwt value. If it's legacy, ` +
      `add to scripts/edge-auth-allowlist.json::unregistered_in_config.`,
    );
  }

  // SOFT: argless auth.getUser() in non-frontend functions; allowlist covers legacy.
  if (hasArgless && !arglessAllow.has(name) && !isFrontendCalled) {
    warnings.push(
      `${name}: uses argless \`auth.getUser()\`. Will break if ever called from a ` +
      `frontend with ES256 tokens. Migrate to requireServiceUser, or add to ` +
      `scripts/edge-auth-allowlist.json::argless_get_user if intentionally legacy.`,
    );
  }
}

// Allowlist hygiene: the list must shrink over time. Fail if an entry is
// listed but either (a) the function folder no longer exists, or (b) the
// function has been migrated and no longer has the violation.
const functionSet = new Set(functionNames);
for (const name of unregAllow) {
  if (!functionSet.has(name)) {
    hardErrors.push(
      `edge-auth-allowlist: "${name}" listed in unregistered_in_config but no ` +
      `supabase/functions/${name}/ folder exists — clean up the allowlist.`,
    );
    continue;
  }
  const entry = configEntries.get(name);
  if (entry?.verifyJwt === false) {
    hardErrors.push(
      `edge-auth-allowlist: "${name}" is in unregistered_in_config but config.toml ` +
      `now registers it with verify_jwt=false — remove the allowlist entry.`,
    );
  }
}
for (const name of arglessAllow) {
  if (!functionSet.has(name)) {
    hardErrors.push(
      `edge-auth-allowlist: "${name}" listed in argless_get_user but no ` +
      `supabase/functions/${name}/ folder exists — clean up the allowlist.`,
    );
    continue;
  }
  if (!arglessAuthFns.has(name)) {
    hardErrors.push(
      `edge-auth-allowlist: "${name}" is in argless_get_user but the function ` +
      `no longer uses argless auth.getUser() — remove the allowlist entry.`,
    );
  }
}

// ── 7. Report ─────────────────────────────────────────────────────────────
if (warnings.length > 0) {
  console.log(`edge-function auth audit — ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  warn: ${w}`);
}

if (hardErrors.length > 0) {
  console.error(`\nedge-function auth audit — ${hardErrors.length} error(s):`);
  for (const e of hardErrors) console.error(`  fail: ${e}`);
  console.error(
    `\nSee supabase/functions/_shared/service-auth.ts for the canonical auth ` +
    `pattern (requireServiceUser). ES256 JWTs only work when (a) the function ` +
    `is registered in config.toml with verify_jwt=false AND (b) the function ` +
    `uses requireServiceUser (not argless auth.getUser()).`,
  );
  process.exit(1);
}

const registeredCount = configEntries.size;
const frontendCount = frontendCalled.size;
const arglessCount = arglessAuthFns.size;
console.log(
  `edge-function auth audit passed: ${functionNames.length} functions, ` +
  `${registeredCount} registered in config.toml, ${frontendCount} called from apps/web, ` +
  `${arglessCount} still using argless auth.getUser() (tracked in allowlist).`,
);
