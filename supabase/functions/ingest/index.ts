/**
 * Document ingestion Edge Function
 * Handles: PDF upload (multipart) + OneDrive delta sync trigger
 * Chunks text, generates embeddings, upserts to pgvector
 */
import { Buffer } from "node:buffer";
import { createClient } from "jsr:@supabase/supabase-js@2";
import pdfParse from "npm:pdf-parse@1.1.1";
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

  // Delete existing chunks for this document (re-ingest)
  await supabase.from("chunks").delete().eq("document_id", documentId);

  // Process in batches of 10 to avoid rate limits
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

    const { error } = await supabase.from("chunks").insert(rows);
    if (error) throw new Error(`Chunk insert error: ${error.message}`);
  }

  // Mark document as active
  await supabase
    .from("documents")
    .update({ is_active: true, updated_at: new Date().toISOString() })
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

    // Auth check — only admin/manager/owner roles
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
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

    // --- PDF UPLOAD ---
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const title = formData.get("title") as string || file?.name || "Untitled";

      if (!file) {
        return jsonResponse({ error: "No file provided" }, 400, ch);
      }

      // SEC-QEP-008: Server-side file type + size validation
      const ALLOWED_MIME_TYPES = new Set([
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ]);
      const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

      if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
        return jsonResponse(
          { error: `File type not allowed: ${file.type || "unknown"}` },
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

      if (file.type === "application/pdf" && !isPdf) {
        return jsonResponse(
          { error: "File content does not match declared type (expected PDF)" },
          415,
          ch
        );
      }
      if (
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
        !isZip
      ) {
        return jsonResponse(
          { error: "File content does not match declared type (expected DOCX)" },
          415,
          ch
        );
      }

      // Extract text based on file type
      let rawText: string;
      if (file.type === "application/pdf") {
        try {
          rawText = await extractPdfText(await file.arrayBuffer());
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
      } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        return jsonResponse(
          {
            error:
              "DOCX upload is not yet supported. Please convert to PDF or plain text before uploading.",
          },
          415,
          ch
        );
      } else {
        rawText = await file.text();
      }

      // Create document record
      const { data: doc, error: docError } = await supabaseAdmin
        .from("documents")
        .insert({
          title,
          source: "pdf_upload",
          source_id: file.name,
          mime_type: file.type,
          raw_text: rawText,
          word_count: rawText.split(/\s+/).length,
          uploaded_by: user.id,
          is_active: false, // will be set true after embedding
        })
        .select()
        .single();

      if (docError || !doc) {
        return jsonResponse({ error: docError?.message }, 500, ch);
      }

      const chunkCount = await ingestDocument(supabaseAdmin, doc.id, rawText, title);

      return jsonResponse(
        { success: true, documentId: doc.id, chunks: chunkCount },
        200,
        ch
      );
    }

    const body = await req.json();
    if (typeof body.document_id === "string" && body.document_id.trim().length > 0) {
      const { data: document, error: documentError } = await supabaseAdmin
        .from("documents")
        .select("id, title, raw_text")
        .eq("id", body.document_id)
        .single();

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
        if (!["application/pdf", "text/plain"]
          .includes(item.file?.mimeType)) continue;

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
        if (item.file?.mimeType === "application/pdf") {
          try {
            rawText = await extractPdfText(await contentRes.arrayBuffer());
          } catch (pdfErr) {
            console.error(`[ingest] Failed to parse OneDrive PDF ${item.id}:`, pdfErr);
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
            mime_type: item.file?.mimeType,
            raw_text: rawText,
            word_count: rawText.split(/\s+/).length,
            is_active: false,
            uploaded_by: syncState.user_id,
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
