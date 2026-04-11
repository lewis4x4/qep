#!/usr/bin/env bun

import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./_shared/local-env.mjs";
import {
  buildDocumentChunks,
  type UploadKind,
} from "../supabase/functions/ingest/chunking.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
loadLocalEnv(repoRoot);

function requiredEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const workspaceArg = process.argv.find((arg) => arg.startsWith("--workspace="));

  return {
    dryRun: args.has("--dry-run"),
    limit: limitArg ? Number(limitArg.split("=")[1]) : 100,
    workspaceId: workspaceArg ? workspaceArg.split("=")[1] : null,
  };
}

function inferUploadKind(mimeType: string | null | undefined, title: string): UploadKind {
  const normalized = (mimeType ?? "").toLowerCase();
  if (normalized === "application/pdf") return "pdf";
  if (normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (
    normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    normalized === "application/vnd.ms-excel" ||
    normalized === "text/csv" ||
    normalized === "application/csv"
  ) {
    return "spreadsheet";
  }

  const lowerTitle = title.toLowerCase();
  if (lowerTitle.endsWith(".pdf")) return "pdf";
  if (lowerTitle.endsWith(".docx")) return "docx";
  if (lowerTitle.endsWith(".xlsx") || lowerTitle.endsWith(".xls") || lowerTitle.endsWith(".csv")) {
    return "spreadsheet";
  }
  return "text";
}

async function embedTexts(texts: string[]): Promise<Array<string | null>> {
  if (texts.length === 0) return [];

  const apiKey = requiredEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return texts.map(() => null);
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Embedding API failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const payload = await response.json() as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };

  return (payload.data ?? [])
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((item) => item.embedding ? `[${item.embedding.join(",")}]` : null);
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const { dryRun, limit, workspaceId } = parseArgs();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase
    .from("documents")
    .select("id, title, raw_text, mime_type, workspace_id")
    .eq("status", "published")
    .not("raw_text", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data: documents, error } = await query;
  if (error) throw new Error(`Failed to list documents: ${error.message}`);

  const results: Array<Record<string, unknown>> = [];
  for (const doc of documents ?? []) {
    const uploadKind = inferUploadKind(doc.mime_type, doc.title);
    const built = buildDocumentChunks({
      rawText: doc.raw_text ?? "",
      uploadKind,
      title: doc.title,
    });

    results.push({
      document_id: doc.id,
      title: doc.title,
      workspace_id: doc.workspace_id,
      strategy: built.strategy,
      chunk_count: built.chunks.length,
    });

    if (dryRun) continue;

    const batchSize = 10;
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < built.chunks.length; i += batchSize) {
      const batch = built.chunks.slice(i, i + batchSize);
      const embeddings = await embedTexts(batch.map((chunk) => chunk.content));
      rows.push(...batch.map((chunk, index) => ({
        id: chunk.id,
        document_id: doc.id,
        chunk_index: chunk.chunk_index,
        content: chunk.content,
        token_count: chunk.token_count,
        chunk_kind: chunk.chunk_kind,
        parent_chunk_id: chunk.parent_chunk_id,
        metadata: chunk.metadata,
        embedding: embeddings[index],
      })));
    }

    const sectionRows = rows.filter((row) => row.chunk_kind === "section");
    const paragraphRows = rows.filter((row) => row.chunk_kind === "paragraph");

    const { error: deleteError } = await supabase.from("chunks").delete().eq("document_id", doc.id);
    if (deleteError) throw new Error(`Failed to clear chunks for ${doc.id}: ${deleteError.message}`);

    for (const insertRows of [sectionRows, paragraphRows]) {
      for (let i = 0; i < insertRows.length; i += batchSize) {
        const { error: insertError } = await supabase.from("chunks").insert(insertRows.slice(i, i + batchSize));
        if (insertError) throw new Error(`Failed to insert chunks for ${doc.id}: ${insertError.message}`);
      }
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", doc.id);
    if (updateError) throw new Error(`Failed to stamp ${doc.id}: ${updateError.message}`);
  }

  console.log(JSON.stringify({
    success: true,
    dry_run: dryRun,
    document_count: results.length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error("kb:reindex:tier1 failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
