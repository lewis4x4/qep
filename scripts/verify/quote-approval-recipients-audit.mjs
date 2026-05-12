#!/usr/bin/env bun
/**
 * Audit the candidate recipients for QRM "Quote approval required" notifications.
 *
 * Mirrors the live resolver in supabase/functions/quote-builder-v2/index.ts
 * (authorityBand is hard-pinned to "owner_admin" in production today), and
 * reports:
 *
 *   1. The owner/admin candidate pool per workspace
 *      - role ∈ {owner, admin}
 *      - is_active = true
 *      - email NOT ending in @qep-demo.local / @example.com
 *   2. The single profile that WOULD currently win the route per workspace
 *      (prefers role = ownerEscalationRole "owner", else admin, else first)
 *   3. Filtered demo accounts (so you can see what was dropped)
 *   4. Branch-level routing slots (sales_manager_id / general_manager_id) so
 *      you can preview what would change if authorityBand flips to
 *      "branch_manager" in #2 of the workstream.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun ./scripts/verify/quote-approval-recipients-audit.mjs
 *
 * Optional:
 *   QEP_AUDIT_WORKSPACE_ID=default    Restrict to one workspace
 *   QEP_AUDIT_JSON=1                  Emit JSON (default: pretty table)
 */

import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../_shared/local-env.mjs";

loadLocalEnv();

const DEMO_SUFFIXES = ["@qep-demo.local", "@example.com"];

function client() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function isDemoEmail(email) {
  const e = typeof email === "string" ? email.toLowerCase() : "";
  return DEMO_SUFFIXES.some((s) => e.endsWith(s));
}

async function fetchOwnerAdminProfiles(admin, workspaceId) {
  const query = admin
    .from("profiles")
    .select("id, full_name, email, role, is_active, active_workspace_id")
    .in("role", ["owner", "admin"])
    .eq("is_active", true);
  const { data, error } = workspaceId
    ? await query.eq("active_workspace_id", workspaceId)
    : await query;
  if (error) throw new Error(`profiles fetch failed: ${error.message}`);
  return data ?? [];
}

async function fetchBranches(admin, workspaceId) {
  const query = admin
    .from("branches")
    .select(
      "id, slug, display_name, workspace_id, sales_manager_id, general_manager_id, is_active, deleted_at",
    )
    .is("deleted_at", null);
  const { data, error } = workspaceId
    ? await query.eq("workspace_id", workspaceId)
    : await query;
  if (error) throw new Error(`branches fetch failed: ${error.message}`);
  return data ?? [];
}

async function fetchProfilesByIds(admin, ids) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .in("id", unique);
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

function pickWinningOwner(profiles, ownerEscalationRole = "owner") {
  const real = profiles.filter((p) => !isDemoEmail(p.email));
  const preferred = real.find((p) => p.role === ownerEscalationRole);
  return preferred ?? real[0] ?? null;
}

function groupByWorkspace(rows, key = "active_workspace_id") {
  const map = new Map();
  for (const row of rows) {
    const id = row[key] ?? "default";
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function fmtProfile(p) {
  if (!p) return "—";
  const name = p.full_name?.trim() || "(no name)";
  const email = p.email?.trim() || "(no email)";
  return `${name} <${email}>  [role=${p.role}, id=${p.id}]`;
}

async function main() {
  const restrictWorkspace = process.env.QEP_AUDIT_WORKSPACE_ID?.trim() || null;
  const asJson = process.env.QEP_AUDIT_JSON === "1";
  const admin = client();

  const [ownerAdmins, branches] = await Promise.all([
    fetchOwnerAdminProfiles(admin, restrictWorkspace),
    fetchBranches(admin, restrictWorkspace),
  ]);

  // Resolve branch manager profiles in one batch
  const branchProfileIds = branches.flatMap((b) => [
    b.sales_manager_id,
    b.general_manager_id,
  ]);
  const branchProfiles = await fetchProfilesByIds(admin, branchProfileIds);

  const byWorkspace = groupByWorkspace(ownerAdmins);
  const branchesByWorkspace = groupByWorkspace(branches, "workspace_id");

  // Build report
  const report = [];
  const workspaceIds = new Set([
    ...byWorkspace.keys(),
    ...branchesByWorkspace.keys(),
  ]);

  for (const workspaceId of [...workspaceIds].sort()) {
    const profilesForWs = byWorkspace.get(workspaceId) ?? [];
    const realProfiles = profilesForWs.filter((p) => !isDemoEmail(p.email));
    const demoProfiles = profilesForWs.filter((p) => isDemoEmail(p.email));
    const winner = pickWinningOwner(profilesForWs, "owner");

    const branchRows = (branchesByWorkspace.get(workspaceId) ?? []).map(
      (b) => {
        const salesManager = branchProfiles.get(b.sales_manager_id) ?? null;
        const generalManager = branchProfiles.get(b.general_manager_id) ?? null;
        return {
          slug: b.slug,
          displayName: b.display_name,
          isActive: b.is_active,
          salesManager,
          generalManager,
        };
      },
    );

    report.push({
      workspaceId,
      currentRouting: {
        authorityBand: "owner_admin",
        winner,
        candidates: realProfiles,
        demoFilteredOut: demoProfiles,
      },
      branchRouting: {
        // Preview only — would activate if authorityBand flips to branch_manager
        wouldActivate: false,
        branches: branchRows,
      },
    });
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("");
  console.log("============================================================");
  console.log(" QRM Quote Approval — Recipient Audit");
  console.log(" authorityBand pinned to: owner_admin (line 5430 of index.ts)");
  console.log("============================================================");
  if (restrictWorkspace) {
    console.log(` Workspace filter: ${restrictWorkspace}`);
  } else {
    console.log(" Workspace filter: (all workspaces)");
  }
  console.log("");

  for (const ws of report) {
    console.log(`── Workspace: ${ws.workspaceId} ────────────────────────`);
    console.log("");
    console.log("  CURRENT WINNER (this person gets the email + bell):");
    console.log(`    → ${fmtProfile(ws.currentRouting.winner)}`);
    console.log("");
    console.log(
      `  Candidate pool (active owner/admin, non-demo): ${ws.currentRouting.candidates.length}`,
    );
    for (const p of ws.currentRouting.candidates) {
      const marker = p === ws.currentRouting.winner ? " ★" : "  ";
      console.log(`   ${marker} ${fmtProfile(p)}`);
    }
    if (ws.currentRouting.demoFilteredOut.length > 0) {
      console.log("");
      console.log(
        `  Filtered out (demo emails): ${ws.currentRouting.demoFilteredOut.length}`,
      );
      for (const p of ws.currentRouting.demoFilteredOut) {
        console.log(`     • ${fmtProfile(p)}`);
      }
    }

    if (ws.branchRouting.branches.length > 0) {
      console.log("");
      console.log("  Branch routing preview (would activate if authorityBand → branch_manager):");
      for (const b of ws.branchRouting.branches) {
        const tag = b.isActive ? "" : " [inactive]";
        console.log(`    Branch: ${b.displayName} (${b.slug})${tag}`);
        console.log(`      Sales Manager:   ${fmtProfile(b.salesManager)}`);
        console.log(`      General Manager: ${fmtProfile(b.generalManager)}`);
      }
    } else {
      console.log("");
      console.log("  (no branches configured for this workspace)");
    }
    console.log("");
  }

  console.log("============================================================");
  console.log("  Tip: add QEP_AUDIT_JSON=1 to emit machine-readable JSON.");
  console.log("============================================================");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
