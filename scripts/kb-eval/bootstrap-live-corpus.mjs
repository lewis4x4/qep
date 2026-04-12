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
  publicDoc: "188a47aa-cd13-4a0d-9489-51546c4b6510",
  publicDocSection: "55c65cf1-3f41-4381-b2c2-b283bd52d2f8",
  publicDocParagraph: "395d8709-56dd-4338-bb27-bf4880f2c707",
  financeDoc: "c812d1e1-4f5d-4053-9ccd-fbf176792d78",
  financeDocParagraph: "8895b859-5d48-43ea-b402-36d40404f10d",
};

const QRM_DEALS_TABLE = "qrm_deals";
const QRM_EMBEDDINGS_TABLE = "qrm_embeddings";

async function supportsTier1ChunkSchema() {
  const { error } = await supabase
    .from("chunks")
    .select("chunk_kind, parent_chunk_id")
    .limit(1);

  return !error;
}

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
    .from(QRM_DEALS_TABLE)
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
    "Similar machine memory: last time this issue on a similar machine was solved by replacing the feed wheel pressure solenoid and recalibrating the valve block before swapping the hydraulic pump.",
    "Voice note intelligence about competitor mentions: Fecon dealer network is being used against us on faster delivery slots and lower monthly payment framing, so leadership needs a response plan by tomorrow morning.",
  ].join("\n");
}
function buildEmbeddingRows(deal) {
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
  ];
}

function buildDocumentFixtures(operatorId, supportsTier1Schema) {
  const publicTitle = "HX-77-ALPHA Shutdown Pressure Release Procedure";
  const publicParagraph =
    "Before shutdown for HX-77-ALPHA, follow the shutdown pressure release procedure, park on level ground, release hydraulic pressure, and inspect the valve block for trapped heat before disconnecting lines.";
  const publicSection =
    `Shutdown Pressure Release Procedure\n\n${publicParagraph}\n\nRecord HX-77-ALPHA on the service board before handing off the machine.`;
  const financePhrase = "QEP_FINANCE_ONLY_ESCALATION_POLICY";

  return {
    documents: [
      {
        id: FIXTURE_IDS.publicDoc,
        title: publicTitle,
        source: "manual",
        source_id: "kb-eval-tier1-public-doc",
        mime_type: "text/plain",
        raw_text: [
          "# Startup Procedure",
          "",
          "Verify HX-77-ALPHA against the service board before energizing the machine.",
          "",
          "## Shutdown Pressure Release Procedure",
          "",
          publicParagraph,
          "",
          "Record HX-77-ALPHA on the service board before handing off the machine.",
        ].join("\n"),
        word_count: 41,
        uploaded_by: operatorId,
        audience: "company_wide",
        status: "published",
      },
      {
        id: FIXTURE_IDS.financeDoc,
        title: "QEP Finance Escalation Policy",
        source: "manual",
        source_id: "kb-eval-tier1-finance-doc",
        mime_type: "text/plain",
        raw_text: `${financePhrase}: approvals over $25,000 require finance and owner review before release.`,
        word_count: 12,
        uploaded_by: operatorId,
        audience: "finance",
        status: "published",
      },
    ],
    chunks: supportsTier1Schema
      ? [
          {
            id: FIXTURE_IDS.publicDocSection,
            document_id: FIXTURE_IDS.publicDoc,
            chunk_index: 0,
            content: publicSection,
            token_count: Math.ceil(publicSection.length / 4),
            chunk_kind: "section",
            parent_chunk_id: null,
            metadata: {
              section_title: "Shutdown Procedure",
              chunking_strategy: "semantic_v1",
              upload_kind: "text",
            },
          },
          {
            id: FIXTURE_IDS.publicDocParagraph,
            document_id: FIXTURE_IDS.publicDoc,
            chunk_index: 1,
            content: publicParagraph,
            token_count: Math.ceil(publicParagraph.length / 4),
            chunk_kind: "paragraph",
            parent_chunk_id: FIXTURE_IDS.publicDocSection,
            metadata: {
              section_title: "Shutdown Procedure",
              chunking_strategy: "semantic_v1",
              upload_kind: "text",
            },
          },
          {
            id: FIXTURE_IDS.financeDocParagraph,
            document_id: FIXTURE_IDS.financeDoc,
            chunk_index: 0,
            content: `${financePhrase}: approvals over $25,000 require finance and owner review before release.`,
            token_count: Math.ceil(financePhrase.length / 4) + 18,
            chunk_kind: "paragraph",
            parent_chunk_id: null,
            metadata: {
              chunking_strategy: "semantic_v1",
              upload_kind: "text",
            },
          },
        ]
      : [
          {
            id: FIXTURE_IDS.publicDocParagraph,
            document_id: FIXTURE_IDS.publicDoc,
            chunk_index: 0,
            content: publicSection,
            token_count: Math.ceil(publicSection.length / 4),
            metadata: {
              section_title: "Shutdown Procedure",
              chunking_strategy: "legacy_fixed",
              upload_kind: "text",
            },
          },
          {
            id: FIXTURE_IDS.financeDocParagraph,
            document_id: FIXTURE_IDS.financeDoc,
            chunk_index: 0,
            content: `${financePhrase}: approvals over $25,000 require finance and owner review before release.`,
            token_count: Math.ceil(financePhrase.length / 4) + 18,
            metadata: {
              chunking_strategy: "legacy_fixed",
              upload_kind: "text",
            },
          },
        ],
  };
}

export async function bootstrapLiveCorpus() {
  const supportsTier1Schema = await supportsTier1ChunkSchema();
  const operator = await getOperatorProfile();
  const overdueDeal = await getOverdueDeal();
  const docFixtures = buildDocumentFixtures(operator.id, supportsTier1Schema);
  const embeddingRows = buildEmbeddingRows(overdueDeal);
  const { error: embeddingsError } = await supabase
    .from(QRM_EMBEDDINGS_TABLE)
    .upsert(embeddingRows, { onConflict: "entity_type,entity_id", ignoreDuplicates: false });
  if (embeddingsError) {
    throw new Error(`Failed to upsert KB eval embeddings: ${embeddingsError.message}`);
  }

  const { error: documentsError } = await supabase
    .from("documents")
    .upsert(docFixtures.documents, { onConflict: "id", ignoreDuplicates: false });
  if (documentsError) {
    throw new Error(`Failed to upsert KB eval documents: ${documentsError.message}`);
  }

  const { error: chunkDeleteError } = await supabase
    .from("chunks")
    .delete()
    .in("document_id", docFixtures.documents.map((doc) => doc.id));
  if (chunkDeleteError) {
    throw new Error(`Failed to clear KB eval document chunks: ${chunkDeleteError.message}`);
  }

  const { error: chunksError } = await supabase
    .from("chunks")
    .insert(docFixtures.chunks);
  if (chunksError) {
    throw new Error(`Failed to insert KB eval document chunks: ${chunksError.message}`);
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        workspace_id: workspaceId,
        supports_tier1_schema: supportsTier1Schema,
        overdue_deal_id: overdueDeal.id,
        document_fixture_ids: docFixtures.documents.map((doc) => doc.id),
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

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrapLiveCorpus().catch((error) => {
    console.error("kb:bootstrap-live-corpus failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
