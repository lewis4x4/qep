#!/usr/bin/env bun
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Requires SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.");
}

const WAVE5_PROVIDERS = [
  {
    key: "avatax",
    displayName: "AvaTax",
    authType: "api_key",
    category: "Tax automation",
  },
  {
    key: "vesign",
    displayName: "VESign / VitalEdge eSign",
    authType: "api_key",
    category: "Electronic signature",
  },
  {
    key: "ups_worldship",
    displayName: "UPS WorldShip",
    authType: "api_key",
    category: "Shipping labels",
  },
  {
    key: "jd_quote_ii",
    displayName: "JD Quote II",
    authType: "oauth2",
    category: "OEM quote upload",
  },
  {
    key: "oem_base_options_imports",
    displayName: "OEM Base/Options Imports",
    authType: "api_key",
    category: "OEM catalog imports",
  },
  {
    key: "tethr_telematics",
    displayName: "Tethr Telematics",
    authType: "api_key",
    category: "Fleet telematics",
  },
];

const EXPECTED_REGISTER_DOC = "docs/IntelliDealer/WAVE_5_DEFERRED_INTEGRATION_REGISTER_2026-05-03.md";

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const auditProfile = await resolveAuditProfile();
const auditClient = await createAuditClient(auditProfile.email);
const workspaceId = auditProfile.active_workspace_id ?? "default";
const checks = [];

await verifyRegistryRows(workspaceId);
await verifyAvailabilityApi(workspaceId);
await verifyTestConnectionApi();

const failed = checks.filter((check) => !check.ok);
const verdict = failed.length === 0 ? "PASS" : "FAIL";
const result = {
  verdict,
  workspace_id: workspaceId,
  audit_user: {
    id: auditProfile.id,
    email: auditProfile.email,
    role: auditProfile.role,
  },
  provider_keys: WAVE5_PROVIDERS.map((provider) => provider.key),
  checks,
  failed,
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}

async function verifyRegistryRows(targetWorkspaceId) {
  const { data, error } = await adminClient
    .from("integration_status")
    .select("workspace_id, integration_key, display_name, status, auth_type, sync_frequency, credentials_encrypted, endpoint_url, config")
    .eq("workspace_id", targetWorkspaceId)
    .in("integration_key", WAVE5_PROVIDERS.map((provider) => provider.key));

  if (error) {
    addCheck("registry query succeeds", false, error.message);
    return;
  }

  addCheck("registry query succeeds", true, `${data?.length ?? 0} rows`);
  const rowByKey = new Map((data ?? []).map((row) => [row.integration_key, row]));

  for (const provider of WAVE5_PROVIDERS) {
    const row = rowByKey.get(provider.key);
    addCheck(`registry row exists: ${provider.key}`, Boolean(row), row ? targetWorkspaceId : "missing");
    if (!row) continue;

    addCheck(`display name matches: ${provider.key}`, row.display_name === provider.displayName, String(row.display_name));
    addCheck(`auth type matches: ${provider.key}`, row.auth_type === provider.authType, String(row.auth_type));
    addCheck(`manual sync only: ${provider.key}`, row.sync_frequency === "manual", String(row.sync_frequency));
    addCheck(`pending credentials: ${provider.key}`, row.status === "pending_credentials", String(row.status));
    addCheck(`no encrypted credentials: ${provider.key}`, row.credentials_encrypted === null, row.credentials_encrypted ? "present" : "null");
    addCheck(`no endpoint URL: ${provider.key}`, row.endpoint_url === null, row.endpoint_url ?? "null");
    addCheck(`category matches: ${provider.key}`, row.config?.category === provider.category, String(row.config?.category));
    addCheck(
      `provider scope deferred: ${provider.key}`,
      row.config?.provider_scope === "wave_5_deferred_external",
      String(row.config?.provider_scope),
    );
    addCheck(
      `implementation deferred: ${provider.key}`,
      row.config?.implementation_status === "deferred",
      String(row.config?.implementation_status),
    );
    addCheck(
      `external dependency flagged: ${provider.key}`,
      row.config?.external_dependency_required === true,
      String(row.config?.external_dependency_required),
    );
    addCheck(
      `credentials required flagged: ${provider.key}`,
      row.config?.credentials_required === true,
      String(row.config?.credentials_required),
    );
    addCheck(
      `register doc linked: ${provider.key}`,
      row.config?.register_doc === EXPECTED_REGISTER_DOC,
      String(row.config?.register_doc),
    );
    addCheck(
      `deferred reason present: ${provider.key}`,
      typeof row.config?.deferred_reason === "string" && row.config.deferred_reason.length > 20,
      String(row.config?.deferred_reason ?? ""),
    );
  }
}

async function verifyAvailabilityApi(targetWorkspaceId) {
  for (const provider of WAVE5_PROVIDERS) {
    const { data, error } = await auditClient.functions.invoke("integration-availability", {
      body: { integration_key: provider.key },
    });

    if (error) {
      addCheck(`availability API call succeeds: ${provider.key}`, false, error.message);
      continue;
    }

    addCheck(`availability workspace: ${provider.key}`, data?.workspace_id === targetWorkspaceId, String(data?.workspace_id));
    addCheck(`availability status pending: ${provider.key}`, data?.status === "pending_credentials", String(data?.status));
    addCheck(`availability not connected: ${provider.key}`, data?.connected === false, String(data?.connected));
    addCheck(`availability safe mode: ${provider.key}`, data?.safe_mode === true, String(data?.safe_mode));
    addCheck(`availability not connectable: ${provider.key}`, data?.connectable === false, String(data?.connectable));
    addCheck(`availability deferred flag: ${provider.key}`, data?.deferred_provider === true, String(data?.deferred_provider));
  }
}

async function verifyTestConnectionApi() {
  for (const provider of WAVE5_PROVIDERS) {
    const { data, error } = await auditClient.functions.invoke("integration-test-connection", {
      body: { integration_key: provider.key },
    });

    if (error) {
      addCheck(`test API call succeeds: ${provider.key}`, false, error.message);
      continue;
    }

    addCheck(`test disabled success false: ${provider.key}`, data?.success === false, String(data?.success));
    addCheck(`test disabled mode mock: ${provider.key}`, data?.mode === "mock", String(data?.mode));
    addCheck(
      `test disabled code: ${provider.key}`,
      data?.error?.code === "DEFERRED_PROVIDER_TEST_DISABLED",
      String(data?.error?.code),
    );
  }
}

async function resolveAuditProfile() {
  const explicitEmail =
    process.env.WAVE5_AUDIT_EMAIL ??
    process.env.INTELLIDEALER_AUDIT_EMAIL ??
    process.env.FLOOR_AUDIT_EMAIL ??
    process.env.QEP_AUDIT_EMAIL;

  let query = adminClient
    .from("profiles")
    .select("id, email, role, active_workspace_id")
    .in("role", ["admin", "owner"])
    .not("email", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (explicitEmail) {
    query = adminClient
      .from("profiles")
      .select("id, email, role, active_workspace_id")
      .eq("email", explicitEmail)
      .in("role", ["admin", "owner"])
      .limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data?.email) {
    throw new Error(`Could not resolve admin/owner audit profile: ${error?.message ?? "not found"}`);
  }
  return data;
}

async function createAuditClient(email) {
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    throw new Error(`Could not generate audit login link: ${linkError?.message ?? "missing token"}`);
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sessionData, error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });

  if (verifyError || !sessionData.session) {
    throw new Error(`Could not verify audit login link: ${verifyError?.message ?? "missing session"}`);
  }

  return client;
}

function addCheck(name, ok, detail) {
  checks.push({
    name,
    ok,
    detail,
  });
}
