#!/usr/bin/env bun

import { createClient } from "@supabase/supabase-js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

import { loadLocalEnv } from "./_shared/local-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
loadLocalEnv(repoRoot);

type DocumentRow = {
  id: string;
  title: string;
  source: string | null;
  uploaded_by: string | null;
  workspace_id: string | null;
  created_at: string | null;
};

type ProfileRow = {
  id: string;
  active_workspace_id: string | null;
};

type ProfileWorkspaceRow = {
  profile_id: string;
  workspace_id: string;
};

type Proposal = {
  documentId: string;
  title: string;
  source: string | null;
  uploadedBy: string | null;
  currentWorkspaceId: string | null;
  proposedWorkspaceId: string;
  confidence: number;
  cause:
    | "existing_workspace"
    | "uploader_active_workspace"
    | "uploader_default_membership"
    | "uploader_first_membership"
    | "fallback_default";
  needsReview: boolean;
};

function requiredEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const csvArg = process.argv.find((arg) => arg.startsWith("--csv="));
  const workspaceArg = process.argv.find((arg) => arg.startsWith("--workspace="));

  return {
    apply: args.has("--apply"),
    workspaceId: workspaceArg ? workspaceArg.split("=")[1] : null,
    csvPath: csvArg
      ? resolve(process.cwd(), csvArg.split("=")[1])
      : resolve(process.cwd(), "artifacts/document-workspace-backfill-review.csv"),
  };
}

function groupByCause(rows: Proposal[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.cause] = (acc[row.cause] ?? 0) + 1;
    return acc;
  }, {});
}

function buildProposal(
  document: DocumentRow,
  profileById: Map<string, ProfileRow>,
  membershipsByProfileId: Map<string, string[]>,
): Proposal {
  if (document.workspace_id) {
    return {
      documentId: document.id,
      title: document.title,
      source: document.source,
      uploadedBy: document.uploaded_by,
      currentWorkspaceId: document.workspace_id,
      proposedWorkspaceId: document.workspace_id,
      confidence: 1,
      cause: "existing_workspace",
      needsReview: false,
    };
  }

  const profile = document.uploaded_by ? profileById.get(document.uploaded_by) ?? null : null;
  const memberships = document.uploaded_by
    ? [...(membershipsByProfileId.get(document.uploaded_by) ?? [])].sort((left, right) => left.localeCompare(right))
    : [];

  if (profile?.active_workspace_id) {
    return {
      documentId: document.id,
      title: document.title,
      source: document.source,
      uploadedBy: document.uploaded_by,
      currentWorkspaceId: document.workspace_id,
      proposedWorkspaceId: profile.active_workspace_id,
      confidence: 0.98,
      cause: "uploader_active_workspace",
      needsReview: false,
    };
  }

  if (memberships.includes("default")) {
    return {
      documentId: document.id,
      title: document.title,
      source: document.source,
      uploadedBy: document.uploaded_by,
      currentWorkspaceId: document.workspace_id,
      proposedWorkspaceId: "default",
      confidence: 0.7,
      cause: "uploader_default_membership",
      needsReview: true,
    };
  }

  if (memberships.length > 0) {
    return {
      documentId: document.id,
      title: document.title,
      source: document.source,
      uploadedBy: document.uploaded_by,
      currentWorkspaceId: document.workspace_id,
      proposedWorkspaceId: memberships[0],
      confidence: 0.55,
      cause: "uploader_first_membership",
      needsReview: true,
    };
  }

  return {
    documentId: document.id,
    title: document.title,
    source: document.source,
    uploadedBy: document.uploaded_by,
    currentWorkspaceId: document.workspace_id,
    proposedWorkspaceId: "default",
    confidence: 0.2,
    cause: "fallback_default",
    needsReview: true,
  };
}

function toCsv(rows: Proposal[]): string {
  const header = [
    "document_id",
    "title",
    "source",
    "uploaded_by",
    "current_workspace_id",
    "proposed_workspace_id",
    "confidence",
    "cause",
    "needs_review",
  ];

  const escape = (value: string | number | boolean | null) => {
    const normalized = value == null ? "" : String(value);
    return `"${normalized.replaceAll('"', '""')}"`;
  };

  return [
    header.join(","),
    ...rows.map((row) =>
      [
        row.documentId,
        row.title,
        row.source,
        row.uploadedBy,
        row.currentWorkspaceId,
        row.proposedWorkspaceId,
        row.confidence.toFixed(2),
        row.cause,
        row.needsReview,
      ].map(escape).join(","),
    ),
  ].join("\n");
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL") || requiredEnv("VITE_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const { apply, workspaceId, csvPath } = parseArgs();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let documentsQuery = supabase
    .from("documents")
    .select("id, title, source, uploaded_by, workspace_id, created_at")
    .order("created_at", { ascending: true });

  if (workspaceId) {
    documentsQuery = documentsQuery.eq("workspace_id", workspaceId);
  }

  const { data: documents, error: documentsError } = await documentsQuery;
  if (documentsError) {
    throw new Error(`Failed to load documents: ${documentsError.message}`);
  }

  const uploaderIds = Array.from(
    new Set((documents ?? []).map((row) => row.uploaded_by).filter((value): value is string => Boolean(value))),
  );

  const profileById = new Map<string, ProfileRow>();
  if (uploaderIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, active_workspace_id")
      .in("id", uploaderIds);
    if (profilesError) {
      throw new Error(`Failed to load profiles: ${profilesError.message}`);
    }
    for (const profile of (profiles ?? []) as ProfileRow[]) {
      profileById.set(profile.id, profile);
    }
  }

  const membershipsByProfileId = new Map<string, string[]>();
  if (uploaderIds.length > 0) {
    const { data: memberships, error: membershipsError } = await supabase
      .from("profile_workspaces")
      .select("profile_id, workspace_id")
      .in("profile_id", uploaderIds);
    if (membershipsError) {
      throw new Error(`Failed to load profile_workspaces: ${membershipsError.message}`);
    }

    for (const membership of (memberships ?? []) as ProfileWorkspaceRow[]) {
      const existing = membershipsByProfileId.get(membership.profile_id) ?? [];
      existing.push(membership.workspace_id);
      membershipsByProfileId.set(membership.profile_id, existing);
    }
  }

  const proposals = ((documents ?? []) as DocumentRow[]).map((document) =>
    buildProposal(document, profileById, membershipsByProfileId),
  );

  const reviewRows = proposals.filter((row) => row.needsReview);
  const updates = proposals.filter(
    (row) => row.currentWorkspaceId !== row.proposedWorkspaceId && row.proposedWorkspaceId.trim().length > 0,
  );

  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, toCsv(proposals), "utf8");

  if (apply && updates.length > 0) {
    for (const row of updates) {
      const { error } = await supabase
        .from("documents")
        .update({ workspace_id: row.proposedWorkspaceId })
        .eq("id", row.documentId);
      if (error) {
        throw new Error(`Failed to update ${row.documentId}: ${error.message}`);
      }
    }
  }

  const summary = {
    success: true,
    apply,
    documentCount: proposals.length,
    updatesApplied: apply ? updates.length : 0,
    needsReviewCount: reviewRows.length,
    groupedByCause: groupByCause(proposals),
    csvPath,
    sampleReviewRows: reviewRows.slice(0, 20),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(
    "document-workspace-backfill failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
