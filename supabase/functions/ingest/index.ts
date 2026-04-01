/**
 * Document ingestion Edge Function
 * Handles: browser document upload (multipart) + OneDrive delta sync trigger
 * Chunks text, generates embeddings, upserts to pgvector
 */
import { Buffer } from "node:buffer";
import { createClient } from "jsr:@supabase/supabase-js@2";
import mammoth from "npm:mammoth@1.8.0";
import pdfParse from "npm:pdf-parse@1.1.1";
import XLSX from "npm:xlsx@0.18.5";
import { decryptOneDriveToken } from "../_shared/integration-crypto.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

const CHUNK_SIZE = 512;      // target tokens per chunk
const CHUNK_OVERLAP = 50;    // overlap tokens between chunks
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

type UploadKind = "pdf" | "docx" | "spreadsheet" | "text";
type UserRole = "rep" | "admin" | "manager" | "owner";
type DocumentAudience =
  | "company_wide"
  | "finance"
  | "leadership"
  | "admin_owner"
  | "owner_only";
type DocumentStatus =
  | "draft"
  | "pending_review"
  | "published"
  | "archived"
  | "ingest_failed";

const SUPPORTED_UPLOAD_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".csv", ".xlsx", ".xls"]);
const DOCUMENT_AUDIENCES = new Set<DocumentAudience>([
  "company_wide",
  "finance",
  "leadership",
  "admin_owner",
  "owner_only",
]);
const DIRECT_UPLOAD_STATUSES = new Set<DocumentStatus>(["draft", "published"]);
const MIME_TO_UPLOAD_KIND: Record<string, UploadKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.ms-excel": "spreadsheet",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/csv": "text",
};

// Naive tokenization estimate: 1 token ≈ 4 chars
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkText(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;
    let tokenCount = 0;

    while (end < words.length && tokenCount < CHUNK_SIZE) {
      tokenCount += estimateTokens(words[end]);
      end++;
    }

    const chunk = words.slice(start, end).join(" ").trim();
    if (chunk) chunks.push(chunk);

    // Overlap: step back by CHUNK_OVERLAP tokens
    let overlapTokens = 0;
    let overlapStart = end;
    while (overlapStart > start && overlapTokens < CHUNK_OVERLAP) {
      overlapStart--;
      overlapTokens += estimateTokens(words[overlapStart]);
    }
    start = overlapStart === start ? end : overlapStart;
  }

  return chunks;
}

async function extractPdfText(fileBuffer: ArrayBuffer): Promise<string> {
  const parsed = await pdfParse(Buffer.from(fileBuffer));
  return parsed.text ?? "";
}

async function extractDocxText(fileBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBuffer) });
  return result.value ?? "";
}

async function extractSpreadsheetText(fileBuffer: ArrayBuffer): Promise<string> {
  const workbook = XLSX.read(Buffer.from(fileBuffer), { type: "buffer" });
  const parts = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false }).trim();
    if (!csv) return "";
    return `Sheet: ${sheetName}\n${csv}`;
  }).filter((part) => part.length > 0);
  return parts.join("\n\n");
}

function getFileExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function inferUploadKind(
  mimeType: string | null | undefined,
  filename: string
): UploadKind | null {
  if (mimeType && mimeType in MIME_TO_UPLOAD_KIND) {
    return MIME_TO_UPLOAD_KIND[mimeType];
  }

  const extension = getFileExtension(filename);
  if (extension === ".pdf") return "pdf";
  if (extension === ".docx") return "docx";
  if (extension === ".xlsx" || extension === ".xls") return "spreadsheet";
  if (SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) return "text";
  return null;
}

function normalizeMimeType(
  mimeType: string | null | undefined,
  filename: string
): string {
  if (mimeType && mimeType.length > 0) return mimeType;

  const extension = getFileExtension(filename);
  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".txt":
    default:
      return "text/plain";
  }
}

function getDocumentSourceForUploadKind(kind: UploadKind): "pdf_upload" | "manual" {
  return kind === "pdf" ? "pdf_upload" : "manual";
}

function parseDocumentAudience(value: FormDataEntryValue | null): DocumentAudience | null {
  if (typeof value !== "string") return null;
  return DOCUMENT_AUDIENCES.has(value as DocumentAudience) ? (value as DocumentAudience) : null;
}

function parseDocumentStatus(value: FormDataEntryValue | null): DocumentStatus | null {
  if (typeof value !== "string") return null;
  return DIRECT_UPLOAD_STATUSES.has(value as DocumentStatus) ? (value as DocumentStatus) : null;
}

function resolveUploadGovernance(
  role: UserRole,
  requestedAudience: DocumentAudience | null,
  requestedStatus: DocumentStatus | null,
): { audience: DocumentAudience; status: DocumentStatus } {
  if (role === "manager") {
    return {
      audience: "company_wide",
      status: "pending_review",
    };
  }

  return {
    audience: requestedAudience ?? "company_wide",
    status: requestedStatus ?? "published",
  };
}

async function logDocumentAuditEvent(
  supabase: ReturnType<typeof createClient<any>>,
  input: {
    actorUserId: string | null;
    documentId: string | null;
    documentTitleSnapshot: string;
    eventType:
      | "uploaded"
      | "reindexed"
      | "approved"
      | "published"
      | "reclassified"
      | "status_changed"
      | "ingest_failed";
    metadata?: Record<string, unknown>;
  },
) {
  await supabase.from("document_audit_events").insert({
    actor_user_id: input.actorUserId,
    document_id: input.documentId,
    document_title_snapshot: input.documentTitleSnapshot,
    event_type: input.eventType,
    metadata: input.metadata ?? {},
  });
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Embedding API error: ${JSON.stringify(data)}`);
  return data.data[0].embedding;
}

async function ingestDocument(
  supabase: ReturnType<typeof createClient<any>>,
  documentId: string,
  rawText: string,
  title: string
) {
  const textChunks = chunkText(rawText);
  console.log(`Ingesting "${title}": ${textChunks.length} chunks`);

  // Build all new rows first before deleting old chunks — prevents data loss
  // if embedding generation or insert fails partway through.
  const allRows: Array<{
    document_id: string;
    chunk_index: number;
    content: string;
    token_count: number;
    embedding: string;
  }>  = [];
  const batchSize = 10;
  for (let i = 0; i < textChunks.length; i += batchSize) {
    const batch = textChunks.slice(i, i + batchSize);
    const rows = await Promise.all(
      batch.map(async (content, j) => {
        const embedding = await generateEmbedding(content);
        return {
          document_id: documentId,
          chunk_index: i + j,
          content,
          token_count: estimateTokens(content),
          embedding: `[${embedding.join(",")}]`,
        };
      })
    );
    allRows.push(...rows);
  }

  // All embeddings generated successfully — safe to swap old for new
  await supabase.from("chunks").delete().eq("document_id", documentId);
  for (let i = 0; i < allRows.length; i += batchSize) {
    const { error } = await supabase.from("chunks").insert(allRows.slice(i, i + batchSize));
    if (error) throw new Error(`Chunk insert error: ${error.message}`);
  }

  // Generate AI summary of the document
  let summary: string | null = null;
  try {
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (openAiKey) {
      const summarySnippet = rawText.slice(0, 6000);
      const summaryRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          max_completion_tokens: 200,
          messages: [
            {
              role: "system",
              content: "Write a 2-3 sentence summary of this document. Be specific about what it contains. No preamble.",
            },
            { role: "user", content: `Document: "${title}"\n\n${summarySnippet}` },
          ],
        }),
      });
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        summary = summaryData.choices?.[0]?.message?.content?.trim() ?? null;
      }
    }
  } catch (sumErr) {
    console.error(`Summary generation failed for "${title}":`, sumErr);
  }

  await supabase
    .from("documents")
    .update({
      updated_at: new Date().toISOString(),
      ...(summary ? { summary } : {}),
    })
    .eq("id", documentId);

  return textChunks.length;
}

function jsonResponse(
  payload: Record<string, unknown>,
  status: number,
  headers: Record<string, string>
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401, ch);
    }

    // Auth check — only admin/manager/owner roles
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401, ch);
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "manager", "owner"].includes(profile.role)) {
      return jsonResponse({ error: "Forbidden: insufficient role" }, 403, ch);
    }

    const contentType = req.headers.get("content-type") || "";

    // --- BROWSER DOCUMENT UPLOAD ---
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const title = formData.get("title") as string || file?.name || "Untitled";
      const requestedAudience = parseDocumentAudience(formData.get("audience"));
      const requestedStatus = parseDocumentStatus(formData.get("status"));

      if (!file) {
        return jsonResponse({ error: "No file provided" }, 400, ch);
      }

      if ((formData.get("audience") || formData.get("status")) && profile.role === "manager") {
        // Managers can upload, but governance is always forced to company-wide pending review.
        console.info("[ingest] Manager upload governance overridden to company_wide/pending_review");
      }

      const governance = resolveUploadGovernance(
        profile.role as UserRole,
        requestedAudience,
        requestedStatus,
      );

      const normalizedMimeType = normalizeMimeType(file.type, file.name);
      const uploadKind = inferUploadKind(file.type, file.name);

      if (!uploadKind) {
        return jsonResponse(
          { error: "Unsupported file type. Allowed: PDF, DOCX, XLSX, XLS, TXT, MD, CSV." },
          415,
          ch
        );
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return jsonResponse({ error: "File exceeds 50 MB limit" }, 413, ch);
      }

      // Magic byte verification — confirm actual content matches declared MIME type
      const headerBuffer = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const isPdf = headerBuffer[0] === 0x25 && headerBuffer[1] === 0x50 &&
                    headerBuffer[2] === 0x44 && headerBuffer[3] === 0x46; // %PDF
      const isZip = headerBuffer[0] === 0x50 && headerBuffer[1] === 0x4B &&
                    headerBuffer[2] === 0x03 && headerBuffer[3] === 0x04; // PK\x03\x04 (DOCX/ZIP)
      const isOleCompound = headerBuffer[0] === 0xD0 && headerBuffer[1] === 0xCF &&
        headerBuffer[2] === 0x11 && headerBuffer[3] === 0xE0; // legacy XLS compound binary

      if (uploadKind === "pdf" && !isPdf) {
        return jsonResponse(
          { error: "File content does not match declared type (expected PDF)" },
          415,
          ch
        );
      }
      if (uploadKind === "docx" && !isZip) {
        return jsonResponse(
          { error: "File content does not match declared type (expected DOCX)" },
          415,
          ch
        );
      }
      if (uploadKind === "spreadsheet" && !(isZip || isOleCompound)) {
        return jsonResponse(
          { error: "File content does not match declared type (expected Excel workbook)" },
          415,
          ch
        );
      }

      const fileBuffer = await file.arrayBuffer();
      const storagePath = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: storageError } = await supabaseAdmin.storage
        .from("documents")
        .upload(storagePath, fileBuffer, {
          contentType: normalizedMimeType,
          upsert: false,
        });
      if (storageError) {
        console.error("[ingest] document storage upload failed:", storageError.message);
        return jsonResponse({ error: "Failed to store the original document file." }, 500, ch);
      }

      let rawText: string;
      if (uploadKind === "pdf") {
        try {
          rawText = await extractPdfText(fileBuffer);
          if (!rawText.trim()) {
            return jsonResponse(
              {
                error:
                  "PDF contained no extractable text. It may be a scanned image — please use a text-based PDF.",
              },
              422,
              ch
            );
          }
        } catch (pdfErr) {
          console.error("PDF parse error:", pdfErr);
          return jsonResponse(
            {
              error:
                "Failed to extract text from PDF. Ensure the file is not password-protected.",
            },
            422,
            ch
          );
        }
      } else if (uploadKind === "docx") {
        try {
          rawText = await extractDocxText(fileBuffer);
          if (!rawText.trim()) {
            return jsonResponse(
              {
                error:
                  "DOCX contained no extractable text. Ensure the document is not empty or image-only.",
              },
              422,
              ch
            );
          }
        } catch (docxErr) {
          console.error("DOCX parse error:", docxErr);
          return jsonResponse(
            {
              error:
                "Failed to extract text from DOCX. Ensure the document is a standard .docx file.",
            },
            422,
            ch
          );
        }
      } else if (uploadKind === "spreadsheet") {
        try {
          rawText = await extractSpreadsheetText(fileBuffer);
          if (!rawText.trim()) {
            return jsonResponse(
              {
                error:
                  "Spreadsheet contained no extractable text. Ensure the workbook has visible cell content.",
              },
              422,
              ch
            );
          }
        } catch (sheetErr) {
          console.error("Spreadsheet parse error:", sheetErr);
          return jsonResponse(
            {
              error:
                "Failed to extract text from the spreadsheet. Ensure the workbook is a standard .xlsx or .xls file.",
            },
            422,
            ch
          );
        }
      } else {
        rawText = await file.text();
      }

      if (!rawText.trim()) {
        return jsonResponse(
          { error: "Document contained no extractable text." },
          422,
          ch
        );
      }

      const nowIso = new Date().toISOString();

      // Create document record
      const { data: doc, error: docError } = await supabaseAdmin
        .from("documents")
        .insert({
          title,
          source: getDocumentSourceForUploadKind(uploadKind),
          source_id: file.name,
          mime_type: normalizedMimeType,
          raw_text: rawText,
          word_count: rawText.split(/\s+/).length,
          uploaded_by: user.id,
          metadata: {
            storage_bucket: "documents",
            storage_path: storagePath,
            original_filename: file.name,
            upload_kind: uploadKind,
          },
          audience: governance.audience,
          status: governance.status,
          approved_by: governance.status === "published" ? user.id : null,
          approved_at: governance.status === "published" ? nowIso : null,
          classification_updated_by: user.id,
          classification_updated_at: nowIso,
        })
        .select()
        .single();

      if (docError || !doc) {
        console.error("[ingest] document insert failed:", docError?.message);
        return jsonResponse({ error: "Document record creation failed." }, 500, ch);
      }

      await logDocumentAuditEvent(supabaseAdmin, {
        actorUserId: user.id,
        documentId: doc.id,
        documentTitleSnapshot: title,
        eventType: "uploaded",
        metadata: {
          audience: governance.audience,
          status: governance.status,
          source: doc.source,
          mime_type: normalizedMimeType,
        },
      });

      let chunkCount = 0;
      try {
        chunkCount = await ingestDocument(supabaseAdmin, doc.id, rawText, title);
      } catch (ingestErr) {
        console.error("Document ingest error:", ingestErr);
        await supabaseAdmin
          .from("documents")
          .update({
            status: "ingest_failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id);

        await logDocumentAuditEvent(supabaseAdmin, {
          actorUserId: user.id,
          documentId: doc.id,
          documentTitleSnapshot: title,
          eventType: "ingest_failed",
          metadata: {
            reason: ingestErr instanceof Error ? ingestErr.message : "unknown",
          },
        });

        return jsonResponse(
          { error: "Document uploaded but indexing failed. Please re-index after reviewing the file." },
          500,
          ch,
        );
      }

      return jsonResponse(
        {
          success: true,
          documentId: doc.id,
          chunks: chunkCount,
          audience: governance.audience,
          status: governance.status,
        },
        200,
        ch
      );
    }

    const body = await req.json();
    if (typeof body.document_id === "string" && body.document_id.trim().length > 0) {
      const { data: document, error: documentError } = await supabaseAdmin
        .from("documents")
        .select("id, title, raw_text, uploaded_by")
        .eq("id", body.document_id)
        .single();

      if (!documentError && document && document.uploaded_by !== user.id && !["admin", "owner"].includes(profile.role)) {
        return jsonResponse({ error: "You do not have access to this document." }, 403, ch);
      }

      if (documentError || !document) {
        return jsonResponse({ error: "Document not found" }, 404, ch);
      }

      if (!document.raw_text?.trim()) {
        return jsonResponse(
          { error: "Document has no stored raw text to re-index" },
          422,
          ch
        );
      }

      const chunkCount = await ingestDocument(
        supabaseAdmin,
        document.id,
        document.raw_text,
        document.title
      );

      await logDocumentAuditEvent(supabaseAdmin, {
        actorUserId: user.id,
        documentId: document.id,
        documentTitleSnapshot: document.title,
        eventType: "reindexed",
        metadata: { chunks: chunkCount },
      });

      return jsonResponse(
        { success: true, documentId: document.id, chunks: chunkCount },
        200,
        ch
      );
    }

    // --- ONEDRIVE DELTA SYNC ---
    if (body.action === "onedrive_sync") {
      const { syncStateId } = body;
      if (typeof syncStateId !== "string" || syncStateId.trim().length === 0) {
        return jsonResponse({ error: "syncStateId is required" }, 400, ch);
      }

      const { data: syncState } = await supabaseAdmin
        .from("onedrive_sync_state")
        .select("*")
        .eq("id", syncStateId)
        .single();

      if (!syncState) {
        return jsonResponse({ error: "Sync state not found" }, 404, ch);
      }

      if (syncState.user_id !== user.id && profile.role !== "owner") {
        return jsonResponse({ error: "Forbidden: sync state not accessible" }, 403, ch);
      }

      // SEC-QEP-101: Decrypt OneDrive access token before use
      let accessToken: string;
      try {
        accessToken = await decryptOneDriveToken(syncState.access_token);
      } catch (_decryptErr) {
        // Token is not encrypted — it's a plaintext legacy token that must be invalidated
        console.error("[ingest] OneDrive access_token is not encrypted. Re-authorization required.");
        return new Response(
          JSON.stringify({
            error: "OneDrive token requires re-authorization. Please reconnect your OneDrive account.",
            code: "ONEDRIVE_REAUTH_REQUIRED",
          }),
          { status: 401, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }

      // Fetch delta from Microsoft Graph
      const deltaUrl = syncState.delta_token
        ? `https://graph.microsoft.com/v1.0/me/drive/delta?$deltaToken=${syncState.delta_token}`
        : "https://graph.microsoft.com/v1.0/me/drive/root/delta";

      const deltaRes = await fetch(deltaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!deltaRes.ok) {
        return jsonResponse(
          { error: "Failed to fetch OneDrive delta" },
          deltaRes.status,
          ch
        );
      }
      const delta = await deltaRes.json();

      const processed = [];
      for (const item of (delta.value || [])) {
        if (item.deleted || item.folder) continue;
        const uploadKind = inferUploadKind(item.file?.mimeType, item.name ?? "");
        if (!uploadKind) continue;

        // Download file content
        const contentRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!contentRes.ok) {
          console.error(`[ingest] Failed to download OneDrive item ${item.id}: ${contentRes.status}`);
          continue;
        }

        let rawText: string;
        if (uploadKind === "pdf") {
          try {
            rawText = await extractPdfText(await contentRes.arrayBuffer());
          } catch (pdfErr) {
            console.error(`[ingest] Failed to parse OneDrive PDF ${item.id}:`, pdfErr);
            continue;
          }
        } else if (uploadKind === "docx") {
          try {
            rawText = await extractDocxText(await contentRes.arrayBuffer());
          } catch (docxErr) {
            console.error(`[ingest] Failed to parse OneDrive DOCX ${item.id}:`, docxErr);
            continue;
          }
        } else if (uploadKind === "spreadsheet") {
          try {
            rawText = await extractSpreadsheetText(await contentRes.arrayBuffer());
          } catch (xlsxErr) {
            console.error(`[ingest] Failed to parse OneDrive spreadsheet ${item.id}:`, xlsxErr);
            continue;
          }
        } else {
          rawText = await contentRes.text();
        }

        if (!rawText.trim()) {
          continue;
        }

        // Upsert document
        const { data: doc } = await supabaseAdmin
          .from("documents")
          .upsert({
            title: item.name,
            source: "onedrive",
            source_id: item.id,
            source_url: item.webUrl,
            mime_type: normalizeMimeType(item.file?.mimeType, item.name),
            raw_text: rawText,
            word_count: rawText.split(/\s+/).length,
            uploaded_by: syncState.user_id,
            audience: "company_wide",
            status: "published",
          }, { onConflict: "source_id" })
          .select()
          .single();

        if (doc) {
          await ingestDocument(supabaseAdmin, doc.id, rawText, item.name);
          processed.push(item.name);
        }
      }

      // Save new delta token
      await supabaseAdmin
        .from("onedrive_sync_state")
        .update({
          delta_token: delta["@odata.deltaLink"]?.split("deltaToken=")[1],
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", syncStateId);

      return jsonResponse({ success: true, processed }, 200, ch);
    }

    return jsonResponse({ error: "Unknown action" }, 400, ch);
  } catch (error) {
    console.error("Ingest error:", error);
    return jsonResponse({ error: "Internal server error" }, 500, ch);
  }
});
