#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadLocalEnv(join(__dirname, "..", ".."));

function requiredEnv(name) {
  return process.env[name]?.trim() ?? "";
}

const supabaseUrl =
  requiredEnv("SUPABASE_URL") ||
  requiredEnv("VITE_SUPABASE_URL") ||
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const workspaceId = requiredEnv("KB_EVAL_WORKSPACE_ID") || "default";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("kb:bootstrap-live-corpus requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const FIXTURE_IDS = {
  serviceMemoryActivity: "7f9dcd4a-9bc6-4bf6-97dc-a54cf2cb57ad",
  competitorActivity: "07a68902-2e0d-49b1-a062-1e0c859ecf42",
};

async function getOperatorProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, email")
    .in("role", ["admin", "manager", "owner"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(`Failed to resolve operator profile: ${error?.message ?? "not found"}`);
  }

  return data;
}

async function getOverdueDeal() {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("crm_deals")
    .select("id, workspace_id, name, next_follow_up_at, expected_close_on, company_id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .lt("next_follow_up_at", nowIso)
    .order("next_follow_up_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(`Failed to resolve overdue deal in workspace ${workspaceId}: ${error?.message ?? "not found"}`);
  }

  return data;
}

function buildDealEmbeddingContent(deal) {
  return [
    `QRM Deal: ${deal.name}`,
    `Deal status: overdue for follow-up.`,
    `This deal is overdue for follow-up and needs manager attention now.`,
    `Next follow-up due: ${deal.next_follow_up_at ?? "missing"}`,
    `Expected close: ${deal.expected_close_on ?? "unknown"}`,
  ].join("\n");
}

function buildServiceMemoryActivityFixture(deal, operatorId) {
  return {
    id: FIXTURE_IDS.serviceMemoryActivity,
    workspace_id: workspaceId,
    activity_type: "note",
    body:
      "Similar machine memory: last time this issue on a similar machine was solved by replacing the feed wheel pressure solenoid and recalibrating the valve block before swapping the hydraulic pump.",
    occurred_at: new Date().toISOString(),
    deal_id: deal.id,
    created_by: operatorId,
  };
}

function buildCompetitorActivityFixture(deal, operatorId) {
  return {
    id: FIXTURE_IDS.competitorActivity,
    workspace_id: workspaceId,
    activity_type: "note",
    body:
      "Show me voice-note intelligence about competitor mentions. Voice note intelligence about competitor mentions: Fecon dealer network is being used against us on faster delivery slots and lower monthly payment framing, so leadership needs a response plan by tomorrow morning.",
    occurred_at: new Date().toISOString(),
    deal_id: deal.id,
    created_by: operatorId,
  };
}

function buildEmbeddingRows(deal, serviceMemoryActivity, competitorActivity) {
  return [
    {
      entity_type: "deal",
      entity_id: deal.id,
      content: buildDealEmbeddingContent(deal),
      metadata: {
        workspace_id: workspaceId,
        fixture: "kb-eval",
        purpose: "deal-follow-up",
      },
    },
    {
      entity_type: "activity",
      entity_id: serviceMemoryActivity.id,
      content: `QRM Activity\n${serviceMemoryActivity.body}`,
      metadata: {
        workspace_id: workspaceId,
        fixture: "kb-eval",
        purpose: "service-memory",
      },
    },
    {
      entity_type: "activity",
      entity_id: competitorActivity.id,
      content: `QRM Activity\n${competitorActivity.body}`,
      metadata: {
        workspace_id: workspaceId,
        fixture: "kb-eval",
        purpose: "voice-intelligence",
      },
    },
  ];
}

async function main() {
  const operator = await getOperatorProfile();
  const overdueDeal = await getOverdueDeal();
  const serviceMemoryActivity = buildServiceMemoryActivityFixture(overdueDeal, operator.id);
  const competitorActivity = buildCompetitorActivityFixture(overdueDeal, operator.id);

  const { error: activityError } = await supabase
    .from("crm_activities")
    .upsert([serviceMemoryActivity, competitorActivity], { onConflict: "id", ignoreDuplicates: false });
  if (activityError) {
    throw new Error(`Failed to upsert KB eval activity fixtures: ${activityError.message}`);
  }

  const embeddingRows = buildEmbeddingRows(overdueDeal, serviceMemoryActivity, competitorActivity);
  const { error: embeddingsError } = await supabase
    .from("crm_embeddings")
    .upsert(embeddingRows, { onConflict: "entity_type,entity_id", ignoreDuplicates: false });
  if (embeddingsError) {
    throw new Error(`Failed to upsert KB eval embeddings: ${embeddingsError.message}`);
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        workspace_id: workspaceId,
        overdue_deal_id: overdueDeal.id,
        service_memory_activity_fixture_id: serviceMemoryActivity.id,
        competitor_activity_fixture_id: competitorActivity.id,
        embedded_entities: embeddingRows.map((row) => ({
          entity_type: row.entity_type,
          entity_id: row.entity_id,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("kb:bootstrap-live-corpus failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
