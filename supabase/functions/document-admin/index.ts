import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

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

type DocumentAuditEventType =
  | "approved"
  | "archived"
  | "deleted"
  | "published"
  | "reclassified"
  | "status_changed";

type UpdateBody = {
  action: "update";
  documentId: string;
  audience?: DocumentAudience;
  status?: DocumentStatus;
  reviewOwnerUserId?: string | null;
  reviewDueAt?: string | null;
};

type DeleteBody = {
  action: "delete";
  documentId: string;
};

type RequestBody = UpdateBody | DeleteBody;

const DOCUMENT_AUDIENCES = new Set<DocumentAudience>([
  "company_wide",
  "finance",
  "leadership",
  "admin_owner",
  "owner_only",
]);

const DOCUMENT_STATUSES = new Set<DocumentStatus>([
  "draft",
  "pending_review",
  "published",
  "archived",
  "ingest_failed",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonResponse(
  payload: Record<string, unknown>,
  status: number,
  headers: Record<string, string>,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function getStoredDocumentLocation(
  metadata: unknown,
): { bucket: string; path: string } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  const bucket = typeof record.storage_bucket === "string" ? record.storage_bucket : null;
  const path = typeof record.storage_path === "string" ? record.storage_path : null;
  if (!bucket || !path) return null;
  return { bucket, path };
}

async function logAuditEvent(
  adminClient: ReturnType<typeof createAdminClient>,
  input: {
    actorUserId: string | null;
    documentId: string | null;
    documentTitleSnapshot: string;
    eventType: DocumentAuditEventType;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await adminClient.from("document_audit_events").insert({
    actor_user_id: input.actorUserId,
    document_id: input.documentId,
    document_title_snapshot: input.documentTitleSnapshot,
    event_type: input.eventType,
    metadata: input.metadata ?? {},
  });
}

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, ch);
  }

  const adminClient = createAdminClient();

  try {
    const caller = await resolveCallerContext(req, adminClient);
    if (!caller.userId || !caller.role) {
      return jsonResponse({ error: "Unauthorized" }, 401, ch);
    }

    if (caller.role !== "admin" && caller.role !== "owner") {
      return jsonResponse({ error: "Forbidden: only admin and owner can manage document access." }, 403, ch);
    }

    const body = await req.json() as Partial<RequestBody>;
    if (!body.documentId || typeof body.documentId !== "string") {
      return jsonResponse({ error: "documentId is required" }, 400, ch);
    }

    const { data: document, error: documentError } = await adminClient
      .from("documents")
      .select("id, title, audience, status, review_owner_user_id, review_due_at, metadata, workspace_id")
      .eq("id", body.documentId)
      .single();

    if (documentError || !document) {
      return jsonResponse({ error: "Document not found" }, 404, ch);
    }

    if (!caller.isServiceRole && caller.workspaceId && document.workspace_id !== caller.workspaceId) {
      return jsonResponse({ error: "Document not found" }, 404, ch);
    }

    if (body.action === "delete") {
      await logAuditEvent(adminClient, {
        actorUserId: caller.userId,
        documentId: document.id,
        documentTitleSnapshot: document.title,
        eventType: "deleted",
        metadata: {
          audience: document.audience,
          status: document.status,
        },
      });

      const { error: deleteError } = await adminClient
        .from("documents")
        .delete()
        .eq("id", document.id);

      if (deleteError) {
        console.error("[document-admin] delete failed:", deleteError.message);
        return jsonResponse({ error: "Document deletion failed." }, 500, ch);
      }

      const storedDocument = getStoredDocumentLocation(document.metadata);
      if (storedDocument) {
        const { error: storageDeleteError } = await adminClient.storage
          .from(storedDocument.bucket)
          .remove([storedDocument.path]);
        if (storageDeleteError) {
          console.error("[document-admin] original file delete failed:", storageDeleteError.message);
        }
      }

      return jsonResponse({ success: true }, 200, ch);
    }

    if (body.action !== "update") {
      return jsonResponse({ error: "Unsupported action" }, 400, ch);
    }

    const updates: Record<string, unknown> = {};
    const auditEvents: Array<Promise<void>> = [];

    if (body.audience !== undefined) {
      if (!DOCUMENT_AUDIENCES.has(body.audience)) {
        return jsonResponse({ error: "Invalid audience" }, 400, ch);
      }

      updates.audience = body.audience;
      updates.classification_updated_by = caller.userId;
      updates.classification_updated_at = new Date().toISOString();

      if (body.audience !== document.audience) {
        auditEvents.push(
          logAuditEvent(adminClient, {
            actorUserId: caller.userId,
            documentId: document.id,
            documentTitleSnapshot: document.title,
            eventType: "reclassified",
            metadata: {
              previous_audience: document.audience,
              next_audience: body.audience,
            },
          }),
        );
      }
    }

    if (body.status !== undefined) {
      if (!DOCUMENT_STATUSES.has(body.status)) {
        return jsonResponse({ error: "Invalid status" }, 400, ch);
      }

      updates.status = body.status;
      if (body.status === "published") {
        updates.approved_by = caller.userId;
        updates.approved_at = new Date().toISOString();
      }

      if (body.status !== document.status) {
        const eventType: DocumentAuditEventType =
          body.status === "published"
            ? "published"
            : body.status === "archived"
              ? "archived"
              : "status_changed";

        auditEvents.push(
          logAuditEvent(adminClient, {
            actorUserId: caller.userId,
            documentId: document.id,
            documentTitleSnapshot: document.title,
            eventType,
            metadata: {
              previous_status: document.status,
              next_status: body.status,
            },
          }),
        );

        if (body.status === "published" && document.status !== "published") {
          auditEvents.push(
            logAuditEvent(adminClient, {
              actorUserId: caller.userId,
              documentId: document.id,
              documentTitleSnapshot: document.title,
              eventType: "approved",
              metadata: {
                audience: (updates.audience as DocumentAudience | undefined) ?? document.audience,
              },
            }),
          );
        }
      }
    }

    if (body.reviewOwnerUserId !== undefined) {
      updates.review_owner_user_id = body.reviewOwnerUserId;
    }

    if (body.reviewDueAt !== undefined) {
      updates.review_due_at = body.reviewDueAt;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ error: "No changes submitted" }, 400, ch);
    }

    const { data: updatedDocument, error: updateError } = await adminClient
      .from("documents")
      .update(updates)
      .eq("id", document.id)
      .select("id, title, audience, status, review_owner_user_id, review_due_at, is_active, approved_by, approved_at, classification_updated_by, classification_updated_at")
      .single();

    if (updateError || !updatedDocument) {
      console.error("[document-admin] update failed:", updateError?.message);
      return jsonResponse({ error: "Document update failed." }, 500, ch);
    }

    await Promise.all(auditEvents);

    return jsonResponse({ success: true, document: updatedDocument }, 200, ch);
  } catch (error) {
    captureEdgeException(error, { fn: "document-admin", req });
    console.error("document-admin error:", error);
    return jsonResponse({ error: "Internal server error" }, 500, ch);
  }
});
