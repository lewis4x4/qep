#!/usr/bin/env bun

import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function assertIncludes(filePath, needle, message) {
  const content = read(filePath);
  if (!content.includes(needle)) {
    fail(`${message} (${filePath})`);
    return;
  }
  ok(message);
}

function assertNotIncludes(filePath, needle, message) {
  const content = read(filePath);
  if (content.includes(needle)) {
    fail(`${message} (${filePath})`);
    return;
  }
  ok(message);
}

assertIncludes(
  "supabase/migrations/204_workspace_identity_hardening.sql",
  "create or replace function public.get_my_workspace()",
  "migration 204 redefines get_my_workspace",
);
assertIncludes(
  "supabase/migrations/204_workspace_identity_hardening.sql",
  "create trigger reconcile_profile_active_workspace",
  "migration 204 reconciles active_workspace_id on membership delete",
);
assertIncludes(
  "supabase/migrations/204_workspace_identity_hardening.sql",
  "raise exception 'profile % is missing; cannot set active workspace'",
  "migration 204 makes set_active_workspace fail loudly when profile is missing",
);
assertIncludes(
  "supabase/functions/_shared/workspace.ts",
  "resolver disagreement; using profile.active_workspace_id",
  "shared workspace resolver logs JWT/profile disagreements",
);
assertNotIncludes(
  "supabase/functions/chat/index.ts",
  "parseWorkspaceIdFromAuthHeader",
  "chat no longer parses workspace id directly from JWT payload",
);
assertNotIncludes(
  "supabase/functions/voice-to-parts-order/index.ts",
  ".from(\"profile_workspaces\")",
  "voice-to-parts-order no longer selects profile_workspaces directly",
);
assertNotIncludes(
  "supabase/functions/parts-identify-photo/index.ts",
  ".from(\"profile_workspaces\")",
  "parts-identify-photo no longer selects profile_workspaces directly",
);
assertIncludes(
  "supabase/functions/nudge-scheduler/index.ts",
  ".select(\"id, full_name, active_workspace_id\")",
  "nudge-scheduler uses active_workspace_id instead of first membership row",
);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("workspace-identity-contracts: all static checks passed.");
