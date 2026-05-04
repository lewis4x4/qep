import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  DEMO_BATCH_ID,
  DEMO_IDS,
  DEMO_PASSWORD,
  DEMO_USERS,
  DEMO_WORKSPACE_ID,
  PREFER_LOCAL_RUNTIME,
  STAGE_DEFS,
  buildDate,
  buildTimestamp,
  deliveryMetadata,
  sqlJson,
  sqlLiteral,
} from "./seed-ids.mjs";

function normalizeEnvValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}


function usage() {
  console.log(`QEP CRM demo data

Commands:
  bun run demo:plan
  bun run demo:auth-users
  bun run demo:seed
  bun run demo:reset
  bun run demo:reseed
  bun run demo:baseline:local

Environment:
  SUPABASE_URL / VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
Optional:
  QEP_DEMO_WORKSPACE_ID   defaults to "default"
  QEP_DEMO_PASSWORD       defaults to "${DEMO_PASSWORD}"
  QEP_DEMO_PREFER_LOCAL   set to "1" to prefer the local Supabase runtime

Demo operator emails:
${DEMO_USERS.map((user) => `  - ${user.email} (${user.role})`).join("\n")}
`);
}

function isPlaceholderValue(value) {
  return typeof value === "string" && /<[^>]+>/.test(value);
}

function isUsableSupabaseUrl(value) {
  if (!value || isPlaceholderValue(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isUsableServiceRoleKey(value) {
  return (
    typeof value === "string" && value.length > 20 && !isPlaceholderValue(value)
  );
}

let resolvedRuntime = null;
const LOCAL_RESET_MAX_ATTEMPTS = 5;
const LOCAL_RESET_RETRY_DELAY_MS = 5_000;
const LOCAL_RESET_LOCK_KEY = 18_240_402;
const LOCAL_RESET_RETRYABLE_PATTERNS = [
  /\bstatus 5\d\d\b/i,
  /\bcode:\s*42P01\b/i,
  /failed to inspect container health/i,
  /no such container/i,
  /supabase start is not running/i,
  /unexpected eof/i,
  /failed to remove container/i,
  /already in progress/i,
  /upstream connect error/i,
  /connection reset by peer/i,
  /connection refused/i,
  /timed out/i,
];
const LOCAL_RESET_FALLBACK_PATTERNS = [
  /error running container: exit 1/i,
  /caseclauseerror/i,
  /could not query the database for the schema cache/i,
  /failed to load the schema cache/i,
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function invalidateResolvedRuntime() {
  resolvedRuntime = null;
}

function readExecErrorStream(error, key) {
  const value = error?.[key];
  if (typeof value === "string") return value;
  if (value && typeof value.toString === "function") {
    return value.toString("utf8");
  }
  return "";
}

function formatExecError(error) {
  const stdout = readExecErrorStream(error, "stdout").trim();
  const stderr = readExecErrorStream(error, "stderr").trim();
  if (stdout || stderr) {
    return [stdout, stderr].filter(Boolean).join("\n");
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function isRetryableLocalResetError(message) {
  return LOCAL_RESET_RETRYABLE_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

function runSupabaseCommand(args) {
  try {
    const stdout = execFileSync("supabase", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (stdout.trim()) {
      process.stdout.write(stdout);
    }
  } catch (error) {
    const stdout = readExecErrorStream(error, "stdout");
    const stderr = readExecErrorStream(error, "stderr");
    if (stdout.trim()) {
      process.stdout.write(stdout);
    }
    if (stderr.trim()) {
      process.stderr.write(stderr);
    }
    throw new Error(formatExecError(error));
  }
}

function readLocalSupabaseProjectId() {
  try {
    const config = readFileSync(
      `${process.cwd()}/supabase/config.toml`,
      "utf8",
    );
    const match = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function readLocalSupabaseDbUrl() {
  try {
    const config = readFileSync(
      `${process.cwd()}/supabase/config.toml`,
      "utf8",
    );
    const dbSection = config.match(/^\[db\]([\s\S]*?)(?:^\[|\Z)/m)?.[1] ?? "";
    const portMatch = dbSection.match(/^\s*port\s*=\s*(\d+)/m);
    const port = portMatch?.[1] ?? "54322";
    return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  } catch {
    return "";
  }
}

function ensureLocalSupabaseRuntime() {
  const projectId = readLocalSupabaseProjectId();
  if (projectId) {
    try {
      runSupabaseCommand(["stop", "--project-id", projectId, "--yes"]);
    } catch {
      // Ignore cleanup failures and still try a clean start below.
    }
  }

  runSupabaseCommand(["start"]);
  invalidateResolvedRuntime();
}

function readLocalSupabaseStatus() {
  try {
    const raw = execFileSync("supabase", ["status", "-o", "env"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index);
      const value = normalizeEnvValue(trimmed.slice(index + 1));
      parsed[key] = value;
    }
    return parsed;
  } catch {
    return {};
  }
}

function resolveCredentials() {
  if (resolvedRuntime) {
    return resolvedRuntime;
  }

  const local = readLocalSupabaseStatus();
  const urlCandidates = (
    PREFER_LOCAL_RUNTIME
      ? [
          local.SUPABASE_URL,
          local.API_URL,
          process.env.SUPABASE_URL,
          process.env.VITE_SUPABASE_URL,
        ]
      : [
          process.env.SUPABASE_URL,
          process.env.VITE_SUPABASE_URL,
          local.SUPABASE_URL,
          local.API_URL,
        ]
  ).map(normalizeEnvValue);
  const adminKeyCandidates = (
    PREFER_LOCAL_RUNTIME
      ? [
          local.SUPABASE_SERVICE_ROLE_KEY,
          local.SERVICE_ROLE_KEY,
          local.SECRET_KEY,
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          process.env.SUPABASE_SECRET_KEY,
        ]
      : [
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          process.env.SUPABASE_SECRET_KEY,
          local.SECRET_KEY,
          local.SUPABASE_SERVICE_ROLE_KEY,
          local.SERVICE_ROLE_KEY,
        ]
  ).map(normalizeEnvValue);
  const dbUrlCandidates = (
    PREFER_LOCAL_RUNTIME
      ? [local.DB_URL, process.env.SUPABASE_DB_URL, readLocalSupabaseDbUrl()]
      : [process.env.SUPABASE_DB_URL, local.DB_URL, readLocalSupabaseDbUrl()]
  ).map(normalizeEnvValue);

  const url = urlCandidates.find(isUsableSupabaseUrl) ?? "";
  const adminKey = adminKeyCandidates.find(isUsableServiceRoleKey) ?? "";
  const dbUrl =
    dbUrlCandidates.find((value) => value.startsWith("postgresql://")) ?? "";
  const isLocal = url.includes("127.0.0.1") || url.includes("localhost");

  if (!url || !adminKey) {
    throw new Error(
      "Missing valid Supabase credentials. Export real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values, or run against a local `supabase start` environment.",
    );
  }

  resolvedRuntime = { url, adminKey, dbUrl, isLocal };
  return resolvedRuntime;
}

function createAdminClient() {
  const credentials = resolveCredentials();
  return createClient(credentials.url, credentials.adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function execLocalSql(sql) {
  const { dbUrl } = resolveCredentials();
  if (!dbUrl) {
    throw new Error("Missing local DB_URL for direct SQL demo user bootstrap.");
  }

  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runLocalPsqlCommand(args) {
  try {
    const stdout = execFileSync("psql", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (stdout.trim()) {
      process.stdout.write(stdout);
    }
  } catch (error) {
    const stdout = readExecErrorStream(error, "stdout");
    const stderr = readExecErrorStream(error, "stderr");
    if (stdout.trim()) {
      process.stdout.write(stdout);
    }
    if (stderr.trim()) {
      process.stderr.write(stderr);
    }
    throw new Error(formatExecError(error));
  }
}

function queryLocalSql(sql) {
  const { dbUrl } = resolveCredentials();
  if (!dbUrl) {
    throw new Error("Missing local DB_URL for readiness checks.");
  }

  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-Atqc", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function shouldResetLocalDatabase() {
  return PREFER_LOCAL_RUNTIME;
}

function shouldBootstrapLocalSupabase(message) {
  return /failed to inspect container health|no such container|supabase start is not running/i.test(
    message,
  );
}

function shouldForceLocalSupabaseRestart(message) {
  return /failed to create docker container|already in use by container|Conflict\./i.test(
    message,
  );
}

function stopLocalSupabaseRuntime() {
  try {
    runSupabaseCommand(["stop", "--no-backup"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Local Supabase stop reported an error during recovery: ${message}`,
    );
  } finally {
    invalidateResolvedRuntime();
  }
}

function startLocalSupabaseRuntime() {
  try {
    runSupabaseCommand(["start"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldForceLocalSupabaseRestart(message)) {
      throw error;
    }

    console.warn(
      "Local Supabase start hit a container-name conflict. Stopping the stack before retrying start...",
    );
    stopLocalSupabaseRuntime();
    runSupabaseCommand(["start"]);
  } finally {
    invalidateResolvedRuntime();
  }
}

function shouldFallbackToDirectLocalReset(message) {
  return LOCAL_RESET_FALLBACK_PATTERNS.some((pattern) => pattern.test(message));
}

async function waitForLocalDatabaseConnection(phase) {
  const timeoutAt = Date.now() + 60_000;
  let lastError = "local Postgres is still starting";

  while (Date.now() < timeoutAt) {
    try {
      const { dbUrl } = resolveCredentials();
      if (!dbUrl) {
        throw new Error("local DB_URL is not available yet");
      }

      execFileSync(
        "psql",
        [dbUrl, "-v", "ON_ERROR_STOP=1", "-Atqc", "select 1"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      invalidateResolvedRuntime();
      await sleep(1_000);
    }
  }

  throw new Error(`Timed out waiting for ${phase}: ${lastError}`);
}

function listLocalMigrationFiles() {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name,
      path: join(migrationsDir, name),
      version: name.slice(0, 3),
      migrationName: name.slice(4, -4),
    }));
}

async function rebuildLocalDatabaseFromRepoMigrations() {
  const { dbUrl } = resolveCredentials();
  if (!dbUrl) {
    throw new Error("Missing local DB_URL for direct migration replay.");
  }

  const migrations = listLocalMigrationFiles();
  if (!migrations.length) {
    throw new Error(
      "No local repo migrations were found for deterministic reset.",
    );
  }

  console.warn(
    "Supabase CLI local reset did not recover cleanly. Rebuilding the local app schema directly from repo migrations...",
  );

  await waitForLocalDatabaseConnection(
    "direct local migration replay database",
  );

  const psqlBaseArgs = [dbUrl, "-v", "ON_ERROR_STOP=1"];
  runLocalPsqlCommand([
    ...psqlBaseArgs,
    "-c",
    `select pg_advisory_lock(${LOCAL_RESET_LOCK_KEY});`,
  ]);

  try {
    runLocalPsqlCommand([
      ...psqlBaseArgs,
      "-c",
      `
do $$
begin
  if exists (
    select 1
    from information_schema.schemata
    where schema_name = 'public'
  ) then
    execute 'drop schema public cascade';
  end if;
end;
$$;

create schema public authorization postgres;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres, anon, authenticated, service_role;
truncate table supabase_migrations.schema_migrations;
notify pgrst, 'reload schema';
      `,
    ]);

    for (const migration of migrations) {
      console.log(`Applying repo migration ${migration.name}...`);
      runLocalPsqlCommand([...psqlBaseArgs, "-f", migration.path]);
    }

    const values = migrations
      .map(
        (migration) =>
          `(${sqlLiteral(migration.version)}, null, ${sqlLiteral(migration.migrationName)})`,
      )
      .join(",\n");
    runLocalPsqlCommand([
      ...psqlBaseArgs,
      "-c",
      `
insert into supabase_migrations.schema_migrations (version, statements, name)
values
${values};

notify pgrst, 'reload schema';
      `,
    ]);
  } finally {
    try {
      runLocalPsqlCommand([
        ...psqlBaseArgs,
        "-c",
        `select pg_advisory_unlock(${LOCAL_RESET_LOCK_KEY});`,
      ]);
    } catch {
      // Ignore unlock failures to preserve the original reset error.
    }
  }
}

async function waitForLocalRuntimeReadiness({
  phase,
  requireSchemaObjects = false,
  requireProfileRest = true,
}) {
  const timeoutAt = Date.now() + 60_000;
  let lastError = "local Supabase runtime is still starting";

  while (Date.now() < timeoutAt) {
    try {
      invalidateResolvedRuntime();
      const local = readLocalSupabaseStatus();
      const apiUrl = normalizeEnvValue(local.SUPABASE_URL || local.API_URL);
      const adminKey = normalizeEnvValue(
        local.SUPABASE_SERVICE_ROLE_KEY ||
          local.SERVICE_ROLE_KEY ||
          local.SECRET_KEY,
      );

      if (!apiUrl || !adminKey) {
        throw new Error(
          "supabase status -o env did not return API credentials yet",
        );
      }

      const sql = requireSchemaObjects
        ? `
          select case
            when to_regclass('public.profiles') is not null
              and exists (
                select 1
                from information_schema.columns
                where table_schema = 'auth'
                  and table_name = 'users'
                  and column_name = 'email_confirmed_at'
              )
            then 'ready'
            else 'waiting'
          end;
        `
        : "select 'ready';";
      const databaseStatus = queryLocalSql(sql);
      if (databaseStatus !== "ready") {
        throw new Error("required local schema objects are not ready yet");
      }

      if (requireProfileRest) {
        const restReadinessChecks = requireSchemaObjects
          ? ["profiles", "crm_deal_stages"]
          : ["profiles"];

        for (const tableName of restReadinessChecks) {
          const response = await fetch(
            `${apiUrl}/rest/v1/${tableName}?select=*&limit=1`,
            {
              headers: {
                apikey: adminKey,
                Authorization: `Bearer ${adminKey}`,
              },
            },
          );
          if (!response.ok) {
            const message = (await response.text()).trim();
            throw new Error(
              `REST schema cache for ${tableName} returned ${response.status}${message ? `: ${message}` : ""}`,
            );
          }
        }
      }

      invalidateResolvedRuntime();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(1_000);
    }
  }

  throw new Error(`Timed out waiting for ${phase}: ${lastError}`);
}

async function resetLocalDatabaseToRepoMigrations() {
  if (!shouldResetLocalDatabase()) {
    return;
  }

  try {
    await waitForLocalRuntimeReadiness({
      phase: "local reset preflight",
      requireProfileRest: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Local reset preflight could not confirm a healthy runtime; proceeding with recovery reset. ${message}`,
    );
    if (shouldBootstrapLocalSupabase(message)) {
      console.warn(
        "Starting local Supabase runtime before deterministic reset...",
      );
      startLocalSupabaseRuntime();
    }
  }

  console.log(
    "Resetting local Supabase database to repo migrations for a deterministic QA baseline...",
  );
  for (let attempt = 1; attempt <= LOCAL_RESET_MAX_ATTEMPTS; attempt += 1) {
    try {
      runSupabaseCommand(["db", "reset", "--local", "--no-seed", "--yes"]);
      invalidateResolvedRuntime();
      await waitForLocalRuntimeReadiness({
        phase: `local reset recovery (attempt ${attempt})`,
        requireSchemaObjects: true,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryableLocalResetError(message);
      const lastAttempt = attempt === LOCAL_RESET_MAX_ATTEMPTS;

      if (shouldFallbackToDirectLocalReset(message)) {
        console.warn(
          "Re-starting local Supabase runtime before direct migration replay fallback...",
        );
        ensureLocalSupabaseRuntime();
        await rebuildLocalDatabaseFromRepoMigrations();
        invalidateResolvedRuntime();
        await waitForLocalRuntimeReadiness({
          phase: "direct local migration replay recovery",
          requireSchemaObjects: true,
        });
        return;
      }

      if (!retryable) {
        throw new Error(
          `Local deterministic reset failed on attempt ${attempt}: ${message}`,
        );
      }

      if (shouldBootstrapLocalSupabase(message)) {
        console.warn(
          "Local Supabase runtime is not fully available. Starting it before retrying reset...",
        );
        startLocalSupabaseRuntime();
      }

      try {
        invalidateResolvedRuntime();
        await waitForLocalRuntimeReadiness({
          phase: `local reset post-error recovery (attempt ${attempt})`,
          requireSchemaObjects: true,
        });
        console.warn(
          `Local reset attempt ${attempt} returned a transient CLI error after container restart, but the runtime recovered cleanly.`,
        );
        return;
      } catch (recoveryError) {
        const recoveryMessage =
          recoveryError instanceof Error
            ? recoveryError.message
            : String(recoveryError);

        if (lastAttempt) {
          throw new Error(
            `Local deterministic reset failed on attempt ${attempt}: ${message}\nRecovery check also failed: ${recoveryMessage}`,
          );
        }

        console.warn(
          `Local reset attempt ${attempt} hit a transient runtime error. Waiting ${LOCAL_RESET_RETRY_DELAY_MS}ms before retry...`,
        );
        console.warn(
          `Recovery check after attempt ${attempt} failed: ${recoveryMessage}`,
        );
      }

      ensureLocalSupabaseRuntime();
      invalidateResolvedRuntime();
      await sleep(LOCAL_RESET_RETRY_DELAY_MS);
    }
  }
}

const DEMO_INTEGRATION_ROWS = [
  {
    integration_key: "hubspot",
    display_name: "HubSpot CRM",
    status: "connected",
    auth_type: "oauth_app",
    sync_frequency: "manual",
    endpoint_url: "https://app.hubspot.com",
    last_sync_records: 412,
    last_sync_error: null,
    last_test_success: true,
    last_test_latency_ms: 188,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
      hubspot_cutover: {
        parallel_run_enabled: true,
        cutover_ready: false,
        validated_at: buildDate(0),
        note: "Demo validation window active. Daily reconciliation still required before final cutover.",
        decision: "hold_parallel_run",
        decision_note:
          "Keep HubSpot active for operators while the final reconciliation rows are cleared. No source-only switch should happen until the board reviews a clean packet.",
      },
    },
  },
  {
    integration_key: "sendgrid",
    display_name: "SendGrid Email",
    status: "demo_mode",
    auth_type: "api_key",
    sync_frequency: "manual",
    endpoint_url: "https://api.sendgrid.com",
    last_sync_records: 28,
    last_sync_error: null,
    last_test_success: true,
    last_test_latency_ms: 142,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
      mode: "manual_fallback",
    },
  },
  {
    integration_key: "twilio",
    display_name: "Twilio SMS",
    status: "error",
    auth_type: "api_key",
    sync_frequency: "manual",
    endpoint_url: "https://api.twilio.com",
    last_sync_records: 11,
    last_sync_error:
      "Latest connection check failed. Messages still log safely in manual mode.",
    last_test_success: false,
    last_test_latency_ms: 0,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
      mode: "manual_fallback",
    },
  },
  {
    integration_key: "intellidealer",
    display_name: "IntelliDealer (VitalEdge)",
    status: "pending_credentials",
    auth_type: "oauth2",
    sync_frequency: "manual",
    endpoint_url: null,
    last_sync_records: 0,
    last_sync_error: null,
    last_test_success: null,
    last_test_latency_ms: null,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
    },
  },
  {
    integration_key: "ironguides",
    display_name: "Iron Solutions / IronGuides",
    status: "demo_mode",
    auth_type: "api_key",
    sync_frequency: "manual",
    endpoint_url: null,
    last_sync_records: 0,
    last_sync_error: null,
    last_test_success: null,
    last_test_latency_ms: null,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
      mode: "fallback_blended_estimate",
      parity_blocker: "JAR-109",
      provider_scope: "parity_external_decision",
      implementation_status: "decision_required",
      decision_required: true,
      external_dependency_required: true,
      live_feed_contract_required: true,
      live_adapter_implemented: false,
      fallback_policy: "QEP fallback/blended valuation remains operational but is not IronGuides BUILT evidence.",
      decision_packet: "docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_DECISION_PACKET_2026-05-04.md",
      repo_closeout_requirements_doc: "docs/IntelliDealer/_Manifests/QEP_IRONGUIDES_JAR_109_REPO_CLOSEOUT_2026-05-04.md",
    },
  },
  {
    integration_key: "rouse",
    display_name: "Rouse Analytics",
    status: "pending_credentials",
    auth_type: "api_key",
    sync_frequency: "daily",
    endpoint_url: null,
    last_sync_records: 0,
    last_sync_error: null,
    last_test_success: null,
    last_test_latency_ms: null,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
    },
  },
  {
    integration_key: "aemp",
    display_name: "AEMP 2.0 Telematics",
    status: "pending_credentials",
    auth_type: "oauth2",
    sync_frequency: "hourly",
    endpoint_url: null,
    last_sync_records: 0,
    last_sync_error: null,
    last_test_success: null,
    last_test_latency_ms: null,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
    },
  },
  {
    integration_key: "financing",
    display_name: "Financing Partners",
    status: "demo_mode",
    auth_type: "api_key",
    sync_frequency: "daily",
    endpoint_url: null,
    last_sync_records: 9,
    last_sync_error: null,
    last_test_success: true,
    last_test_latency_ms: 119,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
      mode: "configured_rates",
    },
  },
  {
    integration_key: "manufacturer_incentives",
    display_name: "Manufacturer Incentives",
    status: "pending_credentials",
    auth_type: "api_key",
    sync_frequency: "daily",
    endpoint_url: null,
    last_sync_records: 0,
    last_sync_error: null,
    last_test_success: null,
    last_test_latency_ms: null,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
    },
  },
  {
    integration_key: "auction_data",
    display_name: "Auction Data",
    status: "demo_mode",
    auth_type: "api_key",
    sync_frequency: "daily",
    endpoint_url: null,
    last_sync_records: 37,
    last_sync_error: null,
    last_test_success: true,
    last_test_latency_ms: 154,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
      mode: "market_comps_demo",
    },
  },
  {
    integration_key: "fred_usda",
    display_name: "FRED / USDA Economic Data",
    status: "connected",
    auth_type: "api_key",
    sync_frequency: "daily",
    endpoint_url: "https://api.stlouisfed.org",
    last_sync_records: 12,
    last_sync_error: null,
    last_test_success: true,
    last_test_latency_ms: 96,
    config: {
      demo_seed_batch_id: DEMO_BATCH_ID,
    },
  },
];

async function listAuthUsers(admin) {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const batch = data.users ?? [];
    users.push(...batch);
    if (batch.length < 200) break;
    page += 1;
  }
  return users;
}

function ensureLocalDemoUsers() {
  const sql = DEMO_USERS.map((demoUser) => {
    const appMeta = sqlJson({
      provider: "email",
      providers: ["email"],
      workspace_id: DEMO_WORKSPACE_ID,
    });
    const userMeta = sqlJson({
      full_name: demoUser.fullName,
      email: demoUser.email,
      email_verified: true,
      workspace_id: DEMO_WORKSPACE_ID,
    });

    return `
do $$
declare
  v_user_id uuid := ${sqlLiteral(demoUser.id)}::uuid;
  v_email text := ${sqlLiteral(demoUser.email)};
  v_instance_id uuid;
begin
  select instance_id into v_instance_id
  from auth.users
  where instance_id != '00000000-0000-0000-0000-000000000000'::uuid
  limit 1;

  if v_instance_id is null then
    select instance_id into v_instance_id from auth.users limit 1;
  end if;

  if v_instance_id is null then
    v_instance_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new,
    email_change_token_current, phone_change,
    phone_change_token, reauthentication_token,
    is_sso_user
  ) values (
    v_user_id, v_instance_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(${sqlLiteral(DEMO_PASSWORD)}, extensions.gen_salt('bf')),
    now(),
    ${appMeta},
    ${userMeta},
    now(), now(),
    '', '',
    '', '',
    '', '',
    '', '',
    false
  )
  on conflict (id) do update set
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id,
    v_user_id,
    v_email,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(), now(), now()
  )
  on conflict (id) do update set
    provider_id = excluded.provider_id,
    identity_data = excluded.identity_data,
    updated_at = now();

  insert into public.profiles (id, email, full_name, role)
  values (
    v_user_id,
    v_email,
    ${sqlLiteral(demoUser.fullName)},
    ${sqlLiteral(demoUser.role)}
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    updated_at = now();
end;
$$;`;
  }).join("\n");

  execLocalSql(sql);
  return Object.fromEntries(
    DEMO_USERS.map((demoUser) => [demoUser.key, demoUser.id]),
  );
}

async function ensureDemoUsers(admin) {
  if (resolveCredentials().isLocal) {
    return ensureLocalDemoUsers();
  }

  const users = await listAuthUsers(admin);
  const byEmail = new Map(
    users.map((user) => [user.email?.toLowerCase(), user]),
  );
  const result = {};

  for (const demoUser of DEMO_USERS) {
    let authUser = byEmail.get(demoUser.email.toLowerCase()) ?? null;
    if (authUser && authUser.id !== demoUser.id) {
      console.warn(
        `[crm-demo-data] Replacing ${demoUser.email}: auth id ${authUser.id} → seed id ${demoUser.id} (required for service/parts demo FKs).`,
      );
      const { error: delErr } = await admin.auth.admin.deleteUser(authUser.id);
      if (delErr) throw delErr;
      authUser = null;
      byEmail.delete(demoUser.email.toLowerCase());
    }
    if (!authUser) {
      const created = await admin.auth.admin.createUser({
        id: demoUser.id,
        email: demoUser.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        app_metadata: { workspace_id: DEMO_WORKSPACE_ID },
        user_metadata: {
          full_name: demoUser.fullName,
          workspace_id: DEMO_WORKSPACE_ID,
        },
      });
      if (created.error || !created.data.user) {
        throw (
          created.error ??
          new Error(`Could not create auth user for ${demoUser.email}`)
        );
      }
      authUser = created.data.user;
    } else {
      const updated = await admin.auth.admin.updateUserById(authUser.id, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        app_metadata: {
          ...(authUser.app_metadata ?? {}),
          workspace_id: DEMO_WORKSPACE_ID,
        },
        user_metadata: {
          ...(authUser.user_metadata ?? {}),
          full_name: demoUser.fullName,
          workspace_id: DEMO_WORKSPACE_ID,
        },
      });
      if (updated.error) {
        throw updated.error;
      }
    }

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: authUser.id,
        email: demoUser.email,
        full_name: demoUser.fullName,
        role: demoUser.role,
      },
      { onConflict: "id" },
    );
    if (profileError) throw profileError;
    result[demoUser.key] = authUser.id;
  }

  return result;
}

async function deleteDemoUsers(admin) {
  if (resolveCredentials().isLocal) {
    const emails = DEMO_USERS.map((user) =>
      sqlLiteral(user.email.toLowerCase()),
    ).join(", ");
    execLocalSql(`
delete from public.profiles
where lower(email) in (${emails});

delete from auth.identities
where lower(provider) = 'email'
  and lower(provider_id) in (${emails});

delete from auth.users
where lower(email) in (${emails});
`);
    return;
  }

  const users = await listAuthUsers(admin);
  const demoEmails = new Set(
    DEMO_USERS.map((user) => user.email.toLowerCase()),
  );
  for (const user of users) {
    if (!user.email || !demoEmails.has(user.email.toLowerCase())) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }
}

async function ensureDealStages(admin) {
  const { data, error } = await admin
    .from("crm_deal_stages")
    .select("id, name")
    .eq("workspace_id", DEMO_WORKSPACE_ID);
  if (error) throw error;

  const existingByName = new Map((data ?? []).map((row) => [row.name, row.id]));
  const missing = STAGE_DEFS.filter((stage) => !existingByName.has(stage.name));

  if (missing.length > 0) {
    const { error: insertError } = await admin.from("crm_deal_stages").insert(
      missing.map((stage) => ({
        id: stage.id,
        workspace_id: DEMO_WORKSPACE_ID,
        name: stage.name,
        sort_order: stage.sortOrder,
        probability: stage.probability,
        is_closed_won: stage.isClosedWon,
        is_closed_lost: stage.isClosedLost,
      })),
    );
    if (insertError) throw insertError;
  }

  const { data: refreshed, error: refreshedError } = await admin
    .from("crm_deal_stages")
    .select("id, name")
    .eq("workspace_id", DEMO_WORKSPACE_ID)
    .in(
      "name",
      STAGE_DEFS.map((stage) => stage.name),
    );
  if (refreshedError) throw refreshedError;

  return Object.fromEntries((refreshed ?? []).map((row) => [row.name, row.id]));
}

async function seedDemoIntegrationStatuses(admin) {
  const keys = DEMO_INTEGRATION_ROWS.map((row) => row.integration_key);
  const { data, error } = await admin
    .from("integration_status")
    .select("workspace_id, integration_key, credentials_encrypted, config")
    .eq("workspace_id", DEMO_WORKSPACE_ID)
    .in("integration_key", keys);
  if (error) throw error;

  const existingByKey = new Map(
    (data ?? []).map((row) => [row.integration_key, row]),
  );
  const upserts = [];

  for (const row of DEMO_INTEGRATION_ROWS) {
    const existing = existingByKey.get(row.integration_key);
    const existingConfig =
      existing?.config &&
      typeof existing.config === "object" &&
      !Array.isArray(existing.config)
        ? existing.config
        : {};
    const ownedByDemo = existingConfig?.demo_seed_batch_id === DEMO_BATCH_ID;
    const hasLiveCredentials =
      typeof existing?.credentials_encrypted === "string" &&
      existing.credentials_encrypted.trim().length > 0;

    if (hasLiveCredentials && !ownedByDemo) {
      continue;
    }

    upserts.push({
      workspace_id: DEMO_WORKSPACE_ID,
      integration_key: row.integration_key,
      display_name: row.display_name,
      status: row.status,
      auth_type: row.auth_type,
      sync_frequency: row.sync_frequency,
      endpoint_url: row.endpoint_url,
      last_sync_at: buildTimestamp({ hours: -2 }),
      last_sync_records: row.last_sync_records,
      last_sync_error: row.last_sync_error,
      last_test_at: buildTimestamp({ hours: -1 }),
      last_test_success: row.last_test_success,
      last_test_latency_ms: row.last_test_latency_ms,
      config: {
        ...existingConfig,
        ...row.config,
      },
    });
  }

  if (upserts.length === 0) {
    return;
  }

  const { error: upsertError } = await admin
    .from("integration_status")
    .upsert(upserts, { onConflict: "workspace_id,integration_key" });
  if (upsertError) throw upsertError;
}

async function resetDemoIntegrationStatuses(admin) {
  const keys = DEMO_INTEGRATION_ROWS.map((row) => row.integration_key);
  const demoRowsByKey = new Map(
    DEMO_INTEGRATION_ROWS.map((row) => [row.integration_key, row]),
  );
  const { data, error } = await admin
    .from("integration_status")
    .select("workspace_id, integration_key, credentials_encrypted, config")
    .eq("workspace_id", DEMO_WORKSPACE_ID)
    .in("integration_key", keys);
  if (error) throw error;

  const resets = [];
  for (const row of data ?? []) {
    const config =
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? { ...row.config }
        : {};
    if (config.demo_seed_batch_id !== DEMO_BATCH_ID) {
      continue;
    }

    const shouldPreserveDemoOwnership =
      typeof row.credentials_encrypted === "string" &&
      row.credentials_encrypted.trim().length > 0;
    if (!shouldPreserveDemoOwnership) {
      delete config.demo_seed_batch_id;
    }

    if (row.integration_key === "hubspot" && config.hubspot_cutover) {
      delete config.hubspot_cutover;
    }

    resets.push({
      workspace_id: row.workspace_id,
      integration_key: row.integration_key,
      display_name:
        demoRowsByKey.get(row.integration_key)?.display_name ??
        row.integration_key,
      status: row.credentials_encrypted ? "connected" : "pending_credentials",
      auth_type: demoRowsByKey.get(row.integration_key)?.auth_type ?? "api_key",
      sync_frequency:
        demoRowsByKey.get(row.integration_key)?.sync_frequency ?? "manual",
      endpoint_url: null,
      last_sync_at: null,
      last_sync_records: 0,
      last_sync_error: null,
      last_test_at: null,
      last_test_success: null,
      last_test_latency_ms: null,
      config,
    });
  }

  if (resets.length === 0) {
    return;
  }

  const { error: resetError } = await admin
    .from("integration_status")
    .upsert(resets, { onConflict: "workspace_id,integration_key" });
  if (resetError) throw resetError;
}

function buildDemoDataset(userIds, stageIds) {
  const timestamps = {
    twoDaysAgo: buildTimestamp({ days: -2, hours: -1 }),
    yesterdayMorning: buildTimestamp({ days: -1, hours: -4 }),
    yesterdayAfternoon: buildTimestamp({ days: -1, hours: 1 }),
    thisMorning: buildTimestamp({ hours: -4 }),
    ninetyMinutesAgo: buildTimestamp({ hours: -1, minutes: -30 }),
    oneHourAgo: buildTimestamp({ hours: -1 }),
    thirtyMinutesAgo: buildTimestamp({ minutes: -30 }),
    inThreeHours: buildTimestamp({ hours: 3 }),
    tomorrowMidday: buildTimestamp({ days: 1, hours: 2 }),
  };

  return {
    customerProfiles: [
      {
        id: DEMO_IDS.customerProfiles.apex,
        customer_name: "Mason Reed",
        company_name: "Apex Timber Operations",
        industry: "Forestry",
        region: "North Florida",
        pricing_persona: "relationship_loyal",
        persona_confidence: 0.86,
        persona_model_version: "demo-v1",
        lifetime_value: 1265000,
        total_deals: 4,
        avg_deal_size: 316250,
        avg_discount_pct: 4.8,
        avg_days_to_close: 29,
        attachment_rate: 0.62,
        service_contract_rate: 0.5,
        fleet_size: 11,
        seasonal_pattern: "Spring clearing and hurricane prep",
        last_deal_at: timestamps.yesterdayAfternoon,
        last_interaction_at: timestamps.ninetyMinutesAgo,
        price_sensitivity_score: 0.31,
        notes:
          "Prefers field demos with operator crew present and moves fastest when delivery timing is firm.",
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          badges: ["DEMO"],
        },
      },
    ],
    companies: [
      {
        id: DEMO_IDS.companies.apexHoldings,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Apex Timber Operations",
        parent_company_id: null,
        assigned_rep_id: userIds.rep_primary,
        city: "Lake City",
        state: "FL",
        country: "USA",
        address_line_1: "1200 Forestry Way",
        postal_code: "32025",
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          segment: "Forestry contractor",
          branch_count: 2,
        },
      },
      {
        id: DEMO_IDS.companies.apexLakeCity,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Apex Timber Operations - Lake City Branch",
        parent_company_id: DEMO_IDS.companies.apexHoldings,
        assigned_rep_id: userIds.rep_primary,
        city: "Lake City",
        state: "FL",
        country: "USA",
        address_line_1: "1415 County Road 252",
        postal_code: "32024",
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          branch_type: "Service and delivery yard",
        },
      },
      {
        id: DEMO_IDS.companies.gulfCoast,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Gulf Coast Land Clearing",
        parent_company_id: null,
        assigned_rep_id: userIds.rep_secondary,
        city: "Pensacola",
        state: "FL",
        country: "USA",
        address_line_1: "88 Industrial Loop",
        postal_code: "32505",
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          segment: "Municipal and utility clearing",
        },
      },
      {
        id: DEMO_IDS.companies.pineRiver,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Pine River Equipment Rental",
        parent_company_id: null,
        assigned_rep_id: userIds.rep_secondary,
        city: "Valdosta",
        state: "GA",
        country: "USA",
        address_line_1: "705 Commerce Park",
        postal_code: "31601",
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          segment: "Rental fleet operator",
        },
      },
    ],
    contacts: [
      {
        id: DEMO_IDS.contacts.mason,
        workspace_id: DEMO_WORKSPACE_ID,
        dge_customer_profile_id: DEMO_IDS.customerProfiles.apex,
        first_name: "Mason",
        last_name: "Reed",
        email: "mason.reed@apextimber.demo",
        phone: "(386) 555-0142",
        title: "Operations Director",
        primary_company_id: DEMO_IDS.companies.apexHoldings,
        assigned_rep_id: userIds.rep_primary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.contacts.hannah,
        workspace_id: DEMO_WORKSPACE_ID,
        first_name: "Hannah",
        last_name: "Brooks",
        email: "hannah.brooks@apextimber.demo",
        phone: "(386) 555-0118",
        title: "Fleet Manager",
        primary_company_id: DEMO_IDS.companies.apexLakeCity,
        assigned_rep_id: userIds.rep_primary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.contacts.jordan,
        workspace_id: DEMO_WORKSPACE_ID,
        first_name: "Jordan",
        last_name: "Blake",
        email: "jordan.blake@gulfcoast.demo",
        phone: "(850) 555-0131",
        title: "General Superintendent",
        primary_company_id: DEMO_IDS.companies.gulfCoast,
        assigned_rep_id: userIds.rep_secondary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.contacts.jordon,
        workspace_id: DEMO_WORKSPACE_ID,
        first_name: "Jordon",
        last_name: "Blake",
        email: "j.blake@gulfcoast.demo",
        phone: "(850) 555-0131",
        title: "Field Ops Superintendent",
        primary_company_id: DEMO_IDS.companies.gulfCoast,
        assigned_rep_id: userIds.rep_secondary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID, duplicateSeed: true },
      },
      {
        id: DEMO_IDS.contacts.elena,
        workspace_id: DEMO_WORKSPACE_ID,
        first_name: "Elena",
        last_name: "Cruz",
        email: "elena.cruz@pineriver.demo",
        phone: "(229) 555-0180",
        title: "Rental Supervisor",
        primary_company_id: DEMO_IDS.companies.pineRiver,
        assigned_rep_id: userIds.rep_secondary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.contacts.wes,
        workspace_id: DEMO_WORKSPACE_ID,
        first_name: "Wes",
        last_name: "Carver",
        email: "wes.carver@apextimber.demo",
        phone: "(386) 555-0156",
        title: "Branch Superintendent",
        primary_company_id: DEMO_IDS.companies.apexLakeCity,
        assigned_rep_id: userIds.rep_primary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
    ],
    territories: [
      {
        id: DEMO_IDS.territories.northFlorida,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "North Florida Demo Territory",
        description: "Lake City and surrounding forestry accounts.",
        assigned_rep_id: userIds.rep_secondary,
      },
      {
        id: DEMO_IDS.territories.gulfCoast,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Gulf Coast Demo Territory",
        description:
          "Utility and municipal clearing accounts on the gulf route.",
        assigned_rep_id: userIds.rep_secondary,
      },
    ],
    contactTerritories: [
      {
        id: DEMO_IDS.contactTerritories.masonNorth,
        workspace_id: DEMO_WORKSPACE_ID,
        contact_id: DEMO_IDS.contacts.mason,
        territory_id: DEMO_IDS.territories.northFlorida,
      },
      {
        id: DEMO_IDS.contactTerritories.hannahNorth,
        workspace_id: DEMO_WORKSPACE_ID,
        contact_id: DEMO_IDS.contacts.hannah,
        territory_id: DEMO_IDS.territories.northFlorida,
      },
      {
        id: DEMO_IDS.contactTerritories.jordanGulf,
        workspace_id: DEMO_WORKSPACE_ID,
        contact_id: DEMO_IDS.contacts.jordan,
        territory_id: DEMO_IDS.territories.gulfCoast,
      },
    ],
    equipment: [
      {
        id: DEMO_IDS.equipment.apexDozer,
        workspace_id: DEMO_WORKSPACE_ID,
        company_id: DEMO_IDS.companies.apexHoldings,
        primary_contact_id: DEMO_IDS.contacts.mason,
        name: "Barko 495B Track Loader",
        asset_tag: "APX-495B-01",
        serial_number: "BK495B-FL-001",
        metadata: { demoSeedBatchId: DEMO_BATCH_ID, status: "active" },
      },
      {
        id: DEMO_IDS.equipment.apexMulcher,
        workspace_id: DEMO_WORKSPACE_ID,
        company_id: DEMO_IDS.companies.apexLakeCity,
        primary_contact_id: DEMO_IDS.contacts.hannah,
        name: "Bandit 2460XP Drum Chipper",
        asset_tag: "APX-2460XP-02",
        serial_number: "BD2460-FL-002",
        metadata: { demoSeedBatchId: DEMO_BATCH_ID, status: "demo_unit" },
      },
      {
        id: DEMO_IDS.equipment.pineSkidSteer,
        workspace_id: DEMO_WORKSPACE_ID,
        company_id: DEMO_IDS.companies.pineRiver,
        primary_contact_id: DEMO_IDS.contacts.elena,
        name: "Yanmar TL100VS Compact Track Loader",
        asset_tag: "PRR-TL100-03",
        serial_number: "YNTL100-GA-003",
        metadata: { demoSeedBatchId: DEMO_BATCH_ID, status: "rental_ready" },
      },
    ],
    customFieldDefinitions: [
      {
        id: DEMO_IDS.customFieldDefinitions.contactDecisionWindow,
        workspace_id: DEMO_WORKSPACE_ID,
        object_type: "contact",
        key: "demo_decision_window_days",
        label: "Decision Window (days)",
        data_type: "number",
        constraints: {},
        required: false,
        visibility_roles: [],
        sort_order: 10,
      },
      {
        id: DEMO_IDS.customFieldDefinitions.contactPreferredChannel,
        workspace_id: DEMO_WORKSPACE_ID,
        object_type: "contact",
        key: "demo_preferred_channel",
        label: "Preferred Channel",
        data_type: "text",
        constraints: {},
        required: false,
        visibility_roles: [],
        sort_order: 20,
      },
      {
        id: DEMO_IDS.customFieldDefinitions.companyFleetPriority,
        workspace_id: DEMO_WORKSPACE_ID,
        object_type: "company",
        key: "demo_fleet_priority",
        label: "Fleet Priority",
        data_type: "text",
        constraints: {},
        required: false,
        visibility_roles: [],
        sort_order: 10,
      },
      {
        id: DEMO_IDS.customFieldDefinitions.companyServiceRisk,
        workspace_id: DEMO_WORKSPACE_ID,
        object_type: "company",
        key: "demo_service_risk",
        label: "Service Risk",
        data_type: "text",
        constraints: {},
        required: false,
        visibility_roles: ["admin", "manager", "owner"],
        sort_order: 20,
      },
    ],
    customFieldValues: [
      {
        id: DEMO_IDS.customFieldValues.masonDecisionWindow,
        workspace_id: DEMO_WORKSPACE_ID,
        definition_id: DEMO_IDS.customFieldDefinitions.contactDecisionWindow,
        record_type: "contact",
        record_id: DEMO_IDS.contacts.mason,
        value: 14,
      },
      {
        id: DEMO_IDS.customFieldValues.masonChannel,
        workspace_id: DEMO_WORKSPACE_ID,
        definition_id: DEMO_IDS.customFieldDefinitions.contactPreferredChannel,
        record_type: "contact",
        record_id: DEMO_IDS.contacts.mason,
        value: "Call first, then text summary",
      },
      {
        id: DEMO_IDS.customFieldValues.apexFleetPriority,
        workspace_id: DEMO_WORKSPACE_ID,
        definition_id: DEMO_IDS.customFieldDefinitions.companyFleetPriority,
        record_type: "company",
        record_id: DEMO_IDS.companies.apexHoldings,
        value: "Replace two high-hour track loaders before storm season",
      },
      {
        id: DEMO_IDS.customFieldValues.pineServiceRisk,
        workspace_id: DEMO_WORKSPACE_ID,
        definition_id: DEMO_IDS.customFieldDefinitions.companyServiceRisk,
        record_type: "company",
        record_id: DEMO_IDS.companies.pineRiver,
        value: "Medium - rental utilization climbing with one backup unit left",
      },
    ],
    deals: [
      {
        id: DEMO_IDS.deals.barkoPackage,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Barko 495B loader package",
        stage_id: stageIds["Negotiation"],
        primary_contact_id: DEMO_IDS.contacts.mason,
        company_id: DEMO_IDS.companies.apexHoldings,
        assigned_rep_id: userIds.rep_primary,
        amount: 485000,
        expected_close_on: buildDate(10),
        next_follow_up_at: timestamps.inThreeHours,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          equipment_family: "Barko 495B",
        },
      },
      {
        id: DEMO_IDS.deals.banditDemo,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Bandit chipper field demo",
        stage_id: stageIds["Demo Scheduled"],
        primary_contact_id: DEMO_IDS.contacts.hannah,
        company_id: DEMO_IDS.companies.apexLakeCity,
        assigned_rep_id: userIds.rep_primary,
        amount: 128000,
        expected_close_on: buildDate(18),
        next_follow_up_at: timestamps.tomorrowMidday,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          demo_location: "Lake City branch yard",
        },
      },
      {
        id: DEMO_IDS.deals.prinothRevision,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Prinoth Panther T14 quote revision",
        stage_id: stageIds["Quote Working"],
        primary_contact_id: DEMO_IDS.contacts.jordan,
        company_id: DEMO_IDS.companies.gulfCoast,
        assigned_rep_id: userIds.rep_secondary,
        amount: 365000,
        expected_close_on: buildDate(21),
        next_follow_up_at: timestamps.inThreeHours,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          focus: "trade allowance and delivery timing",
        },
      },
      {
        id: DEMO_IDS.deals.yanmarRental,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Yanmar compact fleet refresh",
        stage_id: stageIds["Discovery"],
        primary_contact_id: DEMO_IDS.contacts.elena,
        company_id: DEMO_IDS.companies.pineRiver,
        assigned_rep_id: userIds.rep_secondary,
        amount: 92000,
        expected_close_on: buildDate(30),
        next_follow_up_at: timestamps.tomorrowMidday,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          fleet_need: "rental utilization",
        },
      },
      {
        id: DEMO_IDS.deals.asvWon,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "ASV RT-135 storm response package",
        stage_id: stageIds["Closed Won"],
        primary_contact_id: DEMO_IDS.contacts.wes,
        company_id: DEMO_IDS.companies.apexLakeCity,
        assigned_rep_id: userIds.rep_primary,
        amount: 214000,
        expected_close_on: buildDate(-5),
        next_follow_up_at: null,
        closed_at: timestamps.yesterdayMorning,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          win_story: "Won on uptime, operator support, and freight timing",
        },
      },
      {
        id: DEMO_IDS.deals.municipalLost,
        workspace_id: DEMO_WORKSPACE_ID,
        name: "Municipal mulcher replacement",
        stage_id: stageIds["Closed Lost"],
        primary_contact_id: DEMO_IDS.contacts.jordan,
        company_id: DEMO_IDS.companies.gulfCoast,
        assigned_rep_id: userIds.rep_secondary,
        amount: 248000,
        expected_close_on: buildDate(-3),
        next_follow_up_at: null,
        closed_at: timestamps.yesterdayAfternoon,
        loss_reason:
          "Budget committee delayed replacement to next fiscal cycle",
        competitor: "Fecon dealer network",
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          loss_story: "Lost on budget timing and competitor delivery slot",
        },
      },
    ],
    activities: [
      {
        id: DEMO_IDS.activities.barkoCall,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "call",
        body: "Confirmed the loader spec, delivery window, and operator training needs. Customer wants final freight numbers before green light.",
        occurred_at: timestamps.thisMorning,
        deal_id: DEMO_IDS.deals.barkoPackage,
        created_by: userIds.rep_primary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.activities.barkoTaskOverdue,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "task",
        body: "Send final freight breakdown and financing option comparison before lunch.",
        occurred_at: timestamps.yesterdayAfternoon,
        deal_id: DEMO_IDS.deals.barkoPackage,
        created_by: userIds.rep_primary,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          task: { dueAt: timestamps.oneHourAgo, status: "open" },
        },
      },
      {
        id: DEMO_IDS.activities.barkoEmailSent,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "email",
        body: "Sending the updated loader package with freight, protection plan, and operator onboarding schedule attached.",
        occurred_at: timestamps.yesterdayMorning,
        deal_id: DEMO_IDS.deals.barkoPackage,
        created_by: userIds.rep_primary,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          communication: deliveryMetadata({
            mode: "live",
            provider: "sendgrid",
            status: "sent",
            destination: "mason.reed@apextimber.demo",
            attemptedAt: timestamps.yesterdayMorning,
            externalMessageId: "demo-sendgrid-barko-001",
          }),
          delivery: deliveryMetadata({
            mode: "live",
            provider: "sendgrid",
            status: "sent",
            destination: "mason.reed@apextimber.demo",
            attemptedAt: timestamps.yesterdayMorning,
            externalMessageId: "demo-sendgrid-barko-001",
          }),
        },
      },
      {
        id: DEMO_IDS.activities.apexNote,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "note",
        body: "Branch leadership is trying to consolidate loader replacements into one Q2 budget window.",
        occurred_at: timestamps.yesterdayAfternoon,
        company_id: DEMO_IDS.companies.apexHoldings,
        created_by: userIds.manager,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.activities.banditSmsFailed,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "sms",
        body: "Crew is ready Thursday morning. Reply with the exact chipper setup you want on site and we’ll stage it before you arrive.",
        occurred_at: timestamps.ninetyMinutesAgo,
        deal_id: DEMO_IDS.deals.banditDemo,
        created_by: userIds.rep_primary,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          communication: deliveryMetadata({
            mode: "live",
            provider: "twilio",
            status: "failed",
            destination: "(386) 555-0118",
            attemptedAt: timestamps.ninetyMinutesAgo,
            reasonCode: "twilio_request_failed",
            message: "Demo failure for retry workflow.",
          }),
          delivery: deliveryMetadata({
            mode: "live",
            provider: "twilio",
            status: "failed",
            destination: "(386) 555-0118",
            attemptedAt: timestamps.ninetyMinutesAgo,
            reasonCode: "twilio_request_failed",
            message: "Demo failure for retry workflow.",
          }),
        },
      },
      {
        id: DEMO_IDS.activities.banditMeeting,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "meeting",
        body: "Field demo locked for Thursday at 10:30 AM. Branch crew wants knife-change walkthrough included.",
        occurred_at: timestamps.thisMorning,
        deal_id: DEMO_IDS.deals.banditDemo,
        created_by: userIds.rep_primary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.activities.masonManualEmail,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "email",
        body: "Logged the spec recap and branch pricing notes from the phone conversation. This one was sent outside the system and needs a clean resend if requested.",
        occurred_at: timestamps.twoDaysAgo,
        contact_id: DEMO_IDS.contacts.mason,
        created_by: userIds.manager,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          communication: deliveryMetadata({
            mode: "manual",
            provider: "sendgrid",
            status: "manual_logged",
            destination: "mason.reed@apextimber.demo",
            attemptedAt: timestamps.twoDaysAgo,
          }),
          delivery: deliveryMetadata({
            mode: "manual",
            provider: "sendgrid",
            status: "manual_logged",
            destination: "mason.reed@apextimber.demo",
            attemptedAt: timestamps.twoDaysAgo,
          }),
        },
      },
      {
        id: DEMO_IDS.activities.prinothTaskOpen,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "task",
        body: "Get trade photos and revised freight lane before sending the Panther revision.",
        occurred_at: timestamps.thirtyMinutesAgo,
        deal_id: DEMO_IDS.deals.prinothRevision,
        created_by: userIds.rep_secondary,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          task: { dueAt: timestamps.tomorrowMidday, status: "open" },
        },
      },
      {
        id: DEMO_IDS.activities.pineCall,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "call",
        body: "Rental supervisor wants a loader package that can rotate between land-clearing and compact fleet overflow work.",
        occurred_at: timestamps.thirtyMinutesAgo,
        company_id: DEMO_IDS.companies.pineRiver,
        created_by: userIds.rep_secondary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: DEMO_IDS.activities.gulfTaskDone,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "task",
        body: "Delivered trade allowance summary and competitor notes to the customer.",
        occurred_at: timestamps.yesterdayMorning,
        company_id: DEMO_IDS.companies.gulfCoast,
        created_by: userIds.rep_secondary,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          task: { dueAt: timestamps.yesterdayAfternoon, status: "completed" },
        },
      },
      {
        id: DEMO_IDS.activities.apexSmsManual,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "sms",
        body: "We can stage the Bandit demo unit at the Lake City yard first thing Thursday. Reply with the crew count and we’ll handle the rest.",
        occurred_at: timestamps.oneHourAgo,
        company_id: DEMO_IDS.companies.apexLakeCity,
        created_by: userIds.rep_primary,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          communication: deliveryMetadata({
            mode: "manual",
            provider: "twilio",
            status: "manual_logged",
            destination: "(386) 555-0118",
            attemptedAt: timestamps.oneHourAgo,
          }),
          delivery: deliveryMetadata({
            mode: "manual",
            provider: "twilio",
            status: "manual_logged",
            destination: "(386) 555-0118",
            attemptedAt: timestamps.oneHourAgo,
          }),
        },
      },
    ],
    quotes: [
      {
        id: DEMO_IDS.quotes.barkoQuote,
        workspace_id: DEMO_WORKSPACE_ID,
        created_by: userIds.rep_primary,
        crm_contact_id: DEMO_IDS.contacts.mason,
        crm_deal_id: DEMO_IDS.deals.barkoPackage,
        status: "linked",
        title: "Barko 495B package - Q2 refresh",
        line_items: [
          {
            sku: "BARKO-495B",
            description: "Barko 495B loader",
            quantity: 1,
            unitPrice: 452000,
          },
          {
            sku: "TRAINING-OPS",
            description: "Operator onboarding package",
            quantity: 1,
            unitPrice: 3300,
          },
          {
            sku: "FREIGHT-FL",
            description: "Freight to Lake City",
            quantity: 1,
            unitPrice: 4800,
          },
        ],
        customer_snapshot: {
          contact_name: "Mason Reed",
          company_name: "Apex Timber Operations",
          email: "mason.reed@apextimber.demo",
          phone: "(386) 555-0142",
        },
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          source: "crm_demo_seed",
        },
        linked_at: timestamps.thisMorning,
      },
    ],
    duplicateCandidates: [
      {
        id: DEMO_IDS.duplicateCandidates.jordanLead,
        workspace_id: DEMO_WORKSPACE_ID,
        rule_id: "same_phone_and_name_similarity",
        left_contact_id: DEMO_IDS.contacts.jordan,
        right_contact_id: DEMO_IDS.contacts.jordon,
        score: 0.94,
        status: "open",
      },
    ],
    activityTemplates: [
      {
        id: DEMO_IDS.activityTemplates.demoRecap,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "meeting",
        label: "Demo recap",
        description:
          "Capture what the crew liked, what they questioned, and the next move.",
        body: "Recapped the field demo with the crew, captured objections, and locked the next decision date.",
        sort_order: 10,
        is_active: true,
        created_by: userIds.manager,
      },
      {
        id: DEMO_IDS.activityTemplates.branchCheckin,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "email",
        label: "Branch check-in",
        description:
          "Quick written recap to keep operations and ownership aligned.",
        body: "Sharing the branch recap, current machine recommendation, and what still needs approval before we close this out.",
        sort_order: 20,
        is_active: true,
        created_by: userIds.manager,
      },
      {
        id: DEMO_IDS.activityTemplates.rentalTask,
        workspace_id: DEMO_WORKSPACE_ID,
        activity_type: "task",
        label: "Rental fleet follow-up",
        description:
          "Queue the next rental fleet check without retyping the task.",
        body: "Confirm rental fleet utilization, machine availability, and whether the customer wants rent-to-own options.",
        task_due_minutes: 1440,
        task_status: "open",
        sort_order: 30,
        is_active: true,
        created_by: userIds.manager,
      },
    ],
    hubspotImportRuns: [
      {
        id: DEMO_IDS.hubspotImportRuns.completed,
        workspace_id: DEMO_WORKSPACE_ID,
        initiated_by: userIds.owner,
        status: "completed",
        started_at: timestamps.yesterdayMorning,
        completed_at: timestamps.yesterdayAfternoon,
        contacts_processed: 148,
        companies_processed: 42,
        deals_processed: 67,
        activities_processed: 155,
        error_count: 0,
        error_summary: null,
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          mode: "parallel_run_validation",
        },
      },
      {
        id: DEMO_IDS.hubspotImportRuns.completedWithErrors,
        workspace_id: DEMO_WORKSPACE_ID,
        initiated_by: userIds.owner,
        status: "completed_with_errors",
        started_at: timestamps.thisMorning,
        completed_at: timestamps.ninetyMinutesAgo,
        contacts_processed: 152,
        companies_processed: 44,
        deals_processed: 69,
        activities_processed: 161,
        error_count: 2,
        error_summary:
          "Two records still need reconciliation review before cutover.",
        metadata: {
          demoSeedBatchId: DEMO_BATCH_ID,
          mode: "parallel_run_validation",
        },
      },
    ],
    hubspotImportErrors: [
      {
        id: DEMO_IDS.hubspotImportErrors.companyStageFallback,
        workspace_id: DEMO_WORKSPACE_ID,
        run_id: DEMO_IDS.hubspotImportRuns.completedWithErrors,
        entity_type: "deal",
        external_id: "hs-deal-demo-001",
        payload_snippet: {
          stage: "appointmentscheduled",
          dealname: "Municipal mulcher replacement",
        },
        reason_code: "unknown_hubspot_stage",
        message:
          "HubSpot stage did not match a current CRM pipeline stage and needs mapping review.",
      },
      {
        id: DEMO_IDS.hubspotImportErrors.activityMissingOwner,
        workspace_id: DEMO_WORKSPACE_ID,
        run_id: DEMO_IDS.hubspotImportRuns.completedWithErrors,
        entity_type: "activity",
        external_id: "hs-activity-demo-002",
        payload_snippet: { type: "NOTE", association: "contact" },
        reason_code: "missing_owner_mapping",
        message:
          "Imported note could not resolve an owner and was held for reconciliation.",
      },
    ],
    customerDealHistory: [
      {
        id: "62000000-0000-4000-8000-000000000001",
        customer_profile_id: DEMO_IDS.customerProfiles.apex,
        deal_date: timestamps.twoDaysAgo,
        outcome: "won",
        equipment_make: "Barko",
        equipment_model: "595ML",
        equipment_year: 2023,
        equipment_category: "Loader",
        list_price: 535000,
        sold_price: 517500,
        discount_pct: 3.27,
        margin_pct: 14.6,
        attachments_sold: 2,
        service_contract_sold: true,
        days_to_close: 32,
        rep_id: userIds.rep_primary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
      {
        id: "62000000-0000-4000-8000-000000000002",
        customer_profile_id: DEMO_IDS.customerProfiles.apex,
        deal_date: timestamps.yesterdayMorning,
        outcome: "won",
        equipment_make: "Bandit",
        equipment_model: "2460XP",
        equipment_year: 2024,
        equipment_category: "Chipper",
        list_price: 139000,
        sold_price: 133500,
        discount_pct: 3.96,
        margin_pct: 12.1,
        attachments_sold: 1,
        service_contract_sold: false,
        days_to_close: 18,
        rep_id: userIds.rep_primary,
        metadata: { demoSeedBatchId: DEMO_BATCH_ID },
      },
    ],
  };
}

async function deleteByIds(admin, table, ids) {
  if (!ids.length) return;
  const { error } = await admin.from(table).delete().in("id", ids);
  if (error) throw error;
}

/**
 * crm_activities_check requires exactly one of contact_id, deal_id, company_id (migration 021).
 * Orphan rows (all null) can appear if a referenced deal was removed (FK on delete set null) or
 * from legacy bugs. Multi-FK rows can come from edge functions that set several columns.
 * Mirrors supabase/migrations/135_crm_activities_subject_cleanup.sql so seed succeeds without a manual SQL run.
 */
async function repairCrmActivitySubjects(admin) {
  const { error: e1 } = await admin
    .from("crm_activities")
    .update({ contact_id: null, company_id: null })
    .not("deal_id", "is", null)
    .is("deleted_at", null);
  if (e1) throw e1;

  const { error: e2 } = await admin
    .from("crm_activities")
    .update({ company_id: null })
    .is("deal_id", null)
    .not("contact_id", "is", null)
    .not("company_id", "is", null)
    .is("deleted_at", null);
  if (e2) throw e2;

  const { data: orphans, error: selErr } = await admin
    .from("crm_activities")
    .select("id")
    .is("contact_id", null)
    .is("deal_id", null)
    .is("company_id", null)
    .is("deleted_at", null);
  if (selErr) throw selErr;
  const orphanIds = (orphans ?? []).map((r) => r.id);
  if (orphanIds.length > 0) {
    const { error: delErr } = await admin.from("crm_activities").delete().in("id", orphanIds);
    if (delErr) throw delErr;
  }
}

async function resetDemoData(admin) {
  await repairCrmActivitySubjects(admin);

  await deleteByIds(
    admin,
    "crm_hubspot_import_errors",
    Object.values(DEMO_IDS.hubspotImportErrors),
  );
  await deleteByIds(
    admin,
    "crm_hubspot_import_runs",
    Object.values(DEMO_IDS.hubspotImportRuns),
  );
  await deleteByIds(
    admin,
    "crm_activity_templates",
    Object.values(DEMO_IDS.activityTemplates),
  );
  await deleteByIds(
    admin,
    "crm_duplicate_candidates",
    Object.values(DEMO_IDS.duplicateCandidates),
  );
  await deleteByIds(admin, "quotes", Object.values(DEMO_IDS.quotes));
  await deleteByIds(
    admin,
    "crm_activities",
    Object.values(DEMO_IDS.activities),
  );
  await deleteByIds(
    admin,
    "crm_custom_field_values",
    Object.values(DEMO_IDS.customFieldValues),
  );
  await deleteByIds(
    admin,
    "crm_custom_field_definitions",
    Object.values(DEMO_IDS.customFieldDefinitions),
  );
  await deleteByIds(admin, "crm_equipment", Object.values(DEMO_IDS.equipment));
  await deleteByIds(
    admin,
    "crm_contact_territories",
    Object.values(DEMO_IDS.contactTerritories),
  );
  await deleteByIds(
    admin,
    "crm_territories",
    Object.values(DEMO_IDS.territories),
  );
  await deleteByIds(
    admin,
    "crm_contact_companies",
    Object.values(DEMO_IDS.contactCompanies),
  );
  // Any activity (including non-demo / voice_capture) linked to a demo deal must be
  // removed before deleting deals. ON DELETE SET NULL on deal_id would otherwise
  // produce rows with no contact_id/deal_id/company_id, violating crm_activities_check.
  const demoDealIds = Object.values(DEMO_IDS.deals);
  const { error: actOnDemoDealsErr } = await admin
    .from("crm_activities")
    .delete()
    .in("deal_id", demoDealIds);
  if (actOnDemoDealsErr) throw actOnDemoDealsErr;

  await deleteByIds(admin, "crm_deals", Object.values(DEMO_IDS.deals));
  await deleteByIds(admin, "crm_contacts", Object.values(DEMO_IDS.contacts));
  await deleteByIds(admin, "crm_companies", Object.values(DEMO_IDS.companies));
  await deleteByIds(admin, "customer_deal_history", [
    "62000000-0000-4000-8000-000000000001",
    "62000000-0000-4000-8000-000000000002",
  ]);
  await deleteByIds(
    admin,
    "customer_profiles_extended",
    Object.values(DEMO_IDS.customerProfiles),
  );
  await resetDemoIntegrationStatuses(admin);
  await deleteByIds(
    admin,
    "crm_deal_stages",
    STAGE_DEFS.map((stage) => stage.id),
  );
  await deleteDemoUsers(admin);
}

async function seedDemoData(admin) {
  await repairCrmActivitySubjects(admin);
  const userIds = await ensureDemoUsers(admin);
  const stageIds = await ensureDealStages(admin);
  await seedDemoIntegrationStatuses(admin);
  const dataset = buildDemoDataset(userIds, stageIds);

  const { error: customerProfileError } = await admin
    .from("customer_profiles_extended")
    .upsert(dataset.customerProfiles, { onConflict: "id" });
  if (customerProfileError) throw customerProfileError;

  const { error: companyError } = await admin
    .from("crm_companies")
    .upsert(dataset.companies, { onConflict: "id" });
  if (companyError) throw companyError;

  const { error: contactError } = await admin
    .from("crm_contacts")
    .upsert(dataset.contacts, { onConflict: "id" });
  if (contactError) throw contactError;

  const { error: territoryError } = await admin
    .from("crm_territories")
    .upsert(dataset.territories, { onConflict: "id" });
  if (territoryError) throw territoryError;

  const { error: contactTerritoryError } = await admin
    .from("crm_contact_territories")
    .upsert(dataset.contactTerritories, { onConflict: "id" });
  if (contactTerritoryError) throw contactTerritoryError;

  const { error: equipmentError } = await admin
    .from("crm_equipment")
    .upsert(dataset.equipment, { onConflict: "id" });
  if (equipmentError) throw equipmentError;

  const { error: customFieldDefinitionError } = await admin
    .from("crm_custom_field_definitions")
    .upsert(dataset.customFieldDefinitions, { onConflict: "id" });
  if (customFieldDefinitionError) throw customFieldDefinitionError;

  const { error: customFieldValueError } = await admin
    .from("crm_custom_field_values")
    .upsert(dataset.customFieldValues, { onConflict: "id" });
  if (customFieldValueError) throw customFieldValueError;

  const { error: dealError } = await admin
    .from("crm_deals")
    .upsert(dataset.deals, { onConflict: "id" });
  if (dealError) throw dealError;

  const { error: activityError } = await admin
    .from("crm_activities")
    .upsert(dataset.activities, { onConflict: "id" });
  if (activityError) throw activityError;

  const { error: quoteError } = await admin
    .from("quotes")
    .upsert(dataset.quotes, { onConflict: "id" });
  if (quoteError) throw quoteError;

  const { error: duplicateError } = await admin
    .from("crm_duplicate_candidates")
    .upsert(dataset.duplicateCandidates, { onConflict: "id" });
  if (duplicateError) throw duplicateError;

  const { error: templateError } = await admin
    .from("crm_activity_templates")
    .upsert(dataset.activityTemplates, { onConflict: "id" });
  if (templateError) throw templateError;

  const { error: importRunsError } = await admin
    .from("crm_hubspot_import_runs")
    .upsert(dataset.hubspotImportRuns, { onConflict: "id" });
  if (importRunsError) throw importRunsError;

  const { error: importErrorsError } = await admin
    .from("crm_hubspot_import_errors")
    .upsert(dataset.hubspotImportErrors, { onConflict: "id" });
  if (importErrorsError) throw importErrorsError;

  const { error: dealHistoryError } = await admin
    .from("customer_deal_history")
    .upsert(dataset.customerDealHistory, { onConflict: "id" });
  if (dealHistoryError) throw dealHistoryError;

  console.log(
    `Seeded demo batch ${DEMO_BATCH_ID} into workspace "${DEMO_WORKSPACE_ID}".`,
  );
  console.log("Demo operator accounts:");
  for (const user of DEMO_USERS) {
    console.log(`  ${user.email} (${user.role})`);
  }
  console.log(`Demo password: ${DEMO_PASSWORD}`);
}

function printPlan() {
  console.log(`QEP Thursday CRM demo plan

Workspace:
  ${DEMO_WORKSPACE_ID} (current app default)

What this seed covers:
  - 5 demo operator accounts (owner, admin, manager, 2 reps)
  - Sprint 1 integration hub states across HubSpot, SendGrid, Twilio, pricing, and market data
  - 2 HubSpot import runs with reconciliation-ready error rows
  - 4 companies with one parent/child hierarchy
  - 6 contacts including one duplicate candidate pair
  - 6 deals across discovery, demo, quote, negotiation, closed won, and closed lost
  - 11 CRM activities with sent, failed, manual, overdue, and completed states
  - 3 equipment assets
  - 4 custom field definitions + seeded values
  - 3 workspace activity templates
  - 1 linked CRM quote
  - 1 DGE-linked customer profile + 2 historical deals

What this seed intentionally does not fake:
  - Live integration credentials
  - Phase 2+ department data (parts, service, rental ops, financial ops)
  - Full HubSpot OAuth connection material or real portal credentials
  - Production client/customer PII

Reset behavior:
  - Removes all demo CRM rows by fixed id
  - Removes demo auth users and their linked profiles
  - Leaves non-demo records intact

Local deterministic baseline:
  - With QEP_DEMO_PREFER_LOCAL=1, reset waits for the local DB, auth schema, and REST API to finish recovering after db reset
  - Use bun run demo:baseline:local to force a full local db reset followed by seed
`);
}

async function main() {
  const command = process.argv[2];

  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "plan") {
    printPlan();
    return;
  }

  if (command === "auth-users") {
    const admin = createAdminClient();
    await ensureDemoUsers(admin);
    console.log(`Ensured demo auth users for workspace "${DEMO_WORKSPACE_ID}".`);
    console.log("Demo operator accounts:");
    for (const user of DEMO_USERS) {
      console.log(`  ${user.email} (${user.role})`);
    }
    console.log(`Demo password: ${DEMO_PASSWORD}`);
    return;
  }

  if (command === "reset") {
    if (shouldResetLocalDatabase()) {
      await resetLocalDatabaseToRepoMigrations();
      console.log(
        "Reset local Supabase database to repo migrations for the QA baseline.",
      );
      return;
    }

    const admin = createAdminClient();
    await resetDemoData(admin);
    console.log(
      `Removed demo batch ${DEMO_BATCH_ID} from workspace "${DEMO_WORKSPACE_ID}".`,
    );
    return;
  }

  if (command === "seed") {
    if (shouldResetLocalDatabase()) {
      await resetLocalDatabaseToRepoMigrations();
      const admin = createAdminClient();
      await seedDemoData(admin);
      return;
    }

    const admin = createAdminClient();
    await resetDemoData(admin);
    await seedDemoData(admin);
    return;
  }

  if (command === "reseed") {
    if (shouldResetLocalDatabase()) {
      await resetLocalDatabaseToRepoMigrations();
      const admin = createAdminClient();
      await resetDemoData(admin);
      await seedDemoData(admin);
    } else {
      const admin = createAdminClient();
      await resetDemoData(admin);
      await seedDemoData(admin);
    }
    return;
  }

  if (command === "baseline-local") {
    await resetLocalDatabaseToRepoMigrations();
    const admin = createAdminClient();
    await seedDemoData(admin);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
