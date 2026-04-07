/**
 * Service Knowledge Capture — Persist service-context notes into
 * machine_knowledge_notes for institutional memory.
 *
 * Auth: user JWT only
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
interface CaptureRequest {
  equipment_id?: string;
  job_id?: string;
  note_type: string;
  content: string;
  metadata?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const userId = auth.userId;

    const body: CaptureRequest = await req.json();

    if (!body.content || !body.note_type) {
      return safeJsonError("content and note_type are required", 400, origin);
    }

    const validTypes = ["sop", "voice", "completion", "bulletin", "field_hack", "serial_specific", "general"];
    if (!validTypes.includes(body.note_type)) {
      return safeJsonError(`Invalid note_type. Must be one of: ${validTypes.join(", ")}`, 400, origin);
    }

    let workspaceId = "default";
    if (body.job_id) {
      const { data: j } = await supabase
        .from("service_jobs")
        .select("workspace_id")
        .eq("id", body.job_id)
        .maybeSingle();
      if (j?.workspace_id) workspaceId = j.workspace_id as string;
    } else if (body.equipment_id) {
      const { data: eq } = await supabase
        .from("crm_equipment")
        .select("workspace_id")
        .eq("id", body.equipment_id)
        .maybeSingle();
      if (eq?.workspace_id) workspaceId = eq.workspace_id as string;
    }

    let embeddingLiteral: string | null = null;
    try {
      embeddingLiteral = formatVectorLiteral(await embedText(body.content));
    } catch (embeddingError) {
      console.warn("knowledge capture embedding skipped:", embeddingError);
    }

    const { data: note, error } = await supabase
      .from("machine_knowledge_notes")
      .insert({
        workspace_id: workspaceId,
        equipment_id: body.equipment_id || null,
        job_id: body.job_id || null,
        note_type: body.note_type,
        content: body.content,
        embedding: embeddingLiteral,
        source_user_id: userId,
        metadata: body.metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      console.error("knowledge capture error:", error);
      return safeJsonError(error.message, 400, origin);
    }

    return safeJsonOk({ note }, origin, 201);
  } catch (err) {
    captureEdgeException(err, { fn: "service-knowledge-capture", req });
    console.error("service-knowledge-capture error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
