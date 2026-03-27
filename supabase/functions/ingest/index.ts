/**
 * Document ingestion Edge Function
 * Handles: PDF upload (multipart) + OneDrive delta sync trigger
 * Chunks text, generates embeddings, upserts to pgvector
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
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
  supabase: ReturnType<typeof createClient>,
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !["admin", "manager", "owner"].includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Forbidden: insufficient role" }), {
        status: 403,
        headers: { ...ch, "Content-Type": "application/json" },
      });
    }

    const contentType = req.headers.get("content-type") || "";

    // --- PDF UPLOAD ---
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const title = formData.get("title") as string || file?.name || "Untitled";

      if (!file) {
        return new Response(JSON.stringify({ error: "No file provided" }), {
          status: 400,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      // SEC-QEP-008: Server-side file type + size validation
      const ALLOWED_MIME_TYPES = new Set([
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ]);
      const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

      if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
        return new Response(
          JSON.stringify({ error: `File type not allowed: ${file.type || "unknown"}` }),
          { status: 415, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return new Response(
          JSON.stringify({ error: "File exceeds 50 MB limit" }),
          { status: 413, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }

      // Magic byte verification — confirm actual content matches declared MIME type
      const headerBuffer = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const isPdf = headerBuffer[0] === 0x25 && headerBuffer[1] === 0x50 &&
                    headerBuffer[2] === 0x44 && headerBuffer[3] === 0x46; // %PDF
      const isZip = headerBuffer[0] === 0x50 && headerBuffer[1] === 0x4B &&
                    headerBuffer[2] === 0x03 && headerBuffer[3] === 0x04; // PK\x03\x04 (DOCX/ZIP)

      if (file.type === "application/pdf" && !isPdf) {
        return new Response(
          JSON.stringify({ error: "File content does not match declared type (expected PDF)" }),
          { status: 415, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }
      if (
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
        !isZip
      ) {
        return new Response(
          JSON.stringify({ error: "File content does not match declared type (expected DOCX)" }),
          { status: 415, headers: { ...ch, "Content-Type": "application/json" } }
        );
      }

      // Extract text — currently supports plain text; PDF parsing done client-side
      // or via a separate PDF-to-text step
      const rawText = await file.text();

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
        return new Response(JSON.stringify({ error: docError?.message }), {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      const chunkCount = await ingestDocument(supabaseAdmin, doc.id, rawText, title);

      return new Response(
        JSON.stringify({ success: true, documentId: doc.id, chunks: chunkCount }),
        { headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    // --- ONEDRIVE DELTA SYNC ---
    const body = await req.json();
    if (body.action === "onedrive_sync") {
      const { syncStateId } = body;

      const { data: syncState } = await supabaseAdmin
        .from("onedrive_sync_state")
        .select("*")
        .eq("id", syncStateId)
        .single();

      if (!syncState) {
        return new Response(JSON.stringify({ error: "Sync state not found" }), {
          status: 404,
          headers: { ...ch, "Content-Type": "application/json" },
        });
      }

      // Fetch delta from Microsoft Graph
      const deltaUrl = syncState.delta_token
        ? `https://graph.microsoft.com/v1.0/me/drive/delta?$deltaToken=${syncState.delta_token}`
        : "https://graph.microsoft.com/v1.0/me/drive/root/delta";

      const deltaRes = await fetch(deltaUrl, {
        headers: { Authorization: `Bearer ${syncState.access_token}` },
      });
      const delta = await deltaRes.json();

      const processed = [];
      for (const item of (delta.value || [])) {
        if (item.deleted || item.folder) continue;
        if (!["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
          .includes(item.file?.mimeType)) continue;

        // Download file content
        const contentRes = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content`,
          { headers: { Authorization: `Bearer ${syncState.access_token}` } }
        );
        const rawText = await contentRes.text();

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

      return new Response(
        JSON.stringify({ success: true, processed }),
        { headers: { ...ch, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Ingest error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }
});
