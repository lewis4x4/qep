#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const ACCOUNT_SPECS = [
  {
    key: "qep-pipeline-agent",
    emailEnv: "QEP_AGENT_EMAIL",
    passwordEnv: "QEP_AGENT_PASSWORD",
    fullName: "QEP Pipeline Agent",
    role: "rep",
    ironRole: "iron_advisor",
    purpose: "Non-admin automation workflow account for pipeline jobs.",
  },
  {
    key: "qep-pipeline-admin-agent",
    emailEnv: "QEP_AGENT_ADMIN_EMAIL",
    passwordEnv: "QEP_AGENT_ADMIN_PASSWORD",
    fullName: "QEP Pipeline Admin Agent",
    role: "admin",
    ironRole: "iron_manager",
    purpose: "Admin-scoped automation workflow account for controlled pipeline operations.",
  },
];

const args = parseArgs(process.argv.slice(2));
const apply = args.apply === true;
const requireEnv = args.requireEnv === true;
const workspaceId = args.workspaceId ?? process.env.QEP_AGENT_WORKSPACE_ID ?? process.env.QEP_WORKSPACE_ID ?? "default";
const requiredEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingCoreEnv = requiredEnv.filter((name) => !process.env[name]);
const accountInputs = ACCOUNT_SPECS.map((spec) => ({
  ...spec,
  email: trimEnv(spec.emailEnv),
  password: process.env[spec.passwordEnv] ?? "",
}));
const missingAccountEnv = accountInputs.flatMap((account) => {
  const missing = [];
  if (!account.email) missing.push(account.emailEnv);
  if (!account.password) missing.push(account.passwordEnv);
  return missing;
});

if (!apply) {
  console.log(JSON.stringify({
    mode: "dry-run",
    apply_with: "set required env vars, then run: node scripts/provision-agent-service-accounts.mjs --apply",
    workspace_id: workspaceId,
    core_env_ready: missingCoreEnv.length === 0,
    missing_core_env: missingCoreEnv,
    account_env_ready: missingAccountEnv.length === 0,
    missing_account_env: missingAccountEnv,
    accounts: accountInputs.map((account) => ({
      key: account.key,
      email_env: account.emailEnv,
      password_env: account.passwordEnv,
      email_configured: Boolean(account.email),
      password_configured: Boolean(account.password),
      role: account.role,
      iron_role: account.ironRole,
    })),
  }, null, 2));
  process.exit(requireEnv && (missingCoreEnv.length > 0 || missingAccountEnv.length > 0) ? 1 : 0);
}

if (missingCoreEnv.length || missingAccountEnv.length) {
  console.error(JSON.stringify({
    error: "MISSING_ENV",
    missing_core_env: missingCoreEnv,
    missing_account_env: missingAccountEnv,
  }, null, 2));
  process.exit(2);
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
for (const account of accountInputs) {
  const user = await ensureAuthUser(admin, account);
  await backfillProfile(admin, account, user.id, workspaceId);
  await markProfileAsServiceAccount(admin, account, user.id, workspaceId);
  await updateAuthMetadata(admin, account, user.id, workspaceId);
  results.push({
    key: account.key,
    user_id: user.id,
    email: account.email,
    role: account.role,
    workspace_id: workspaceId,
    status: user.created ? "created" : "updated",
  });
}

console.log(JSON.stringify({
  mode: "apply",
  workspace_id: workspaceId,
  accounts: results,
}, null, 2));

async function ensureAuthUser(admin, account) {
  const existing = await findUserByEmail(admin, account.email);
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password: account.password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
      app_metadata: {
        ...(existing.app_metadata ?? {}),
        account_kind: "agent_service",
        is_agent_service_account: true,
        agent_service_key: account.key,
      },
    });
    if (error) throw new Error(`Failed to update auth user ${account.emailEnv}: ${error.message}`);
    return { ...data.user, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.fullName },
    app_metadata: {
      account_kind: "agent_service",
      is_agent_service_account: true,
      agent_service_key: account.key,
    },
  });
  if (error) throw new Error(`Failed to create auth user ${account.emailEnv}: ${error.message}`);
  return { ...data.user, created: true };
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw new Error("Auth user search exceeded 20,000 users; narrow provisioning manually.");
}

async function backfillProfile(admin, account, userId, workspaceId) {
  const { error } = await admin.rpc("backfill_profile", {
    p_id: userId,
    p_email: account.email,
    p_full_name: account.fullName,
    p_role: account.role,
    p_iron_role: account.ironRole,
    p_workspace: workspaceId,
  });
  if (error) throw new Error(`backfill_profile failed for ${account.emailEnv}: ${error.message}`);
}

async function markProfileAsServiceAccount(admin, account, userId, workspaceId) {
  const { error } = await admin
    .from("profiles")
    .update({
      email: account.email,
      full_name: account.fullName,
      role: account.role,
      iron_role: account.ironRole,
      active_workspace_id: workspaceId,
      is_active: true,
      is_agent_service_account: true,
      agent_service_key: account.key,
      agent_service_purpose: account.purpose,
      agent_service_config: {
        provisioner: "scripts/provision-agent-service-accounts.mjs",
        email_env: account.emailEnv,
        password_env: account.passwordEnv,
        workspace_id: workspaceId,
      },
    })
    .eq("id", userId);
  if (error) throw new Error(`Profile service-account update failed for ${account.emailEnv}: ${error.message}`);
}

async function updateAuthMetadata(admin, account, userId, workspaceId) {
  const { data, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError) throw new Error(`Failed to reload auth user ${account.emailEnv}: ${getError.message}`);
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...(data.user.app_metadata ?? {}),
      workspace_id: workspaceId,
      role: account.role,
      iron_role: account.ironRole,
      account_kind: "agent_service",
      is_agent_service_account: true,
      agent_service_key: account.key,
    },
  });
  if (error) throw new Error(`Auth metadata update failed for ${account.emailEnv}: ${error.message}`);
}

function trimEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseArgs(argv) {
  const parsed = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply") parsed.apply = true;
    if (arg === "--require-env") parsed.requireEnv = true;
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      parsed[key] = match[2];
    }
  }
  return parsed;
}
