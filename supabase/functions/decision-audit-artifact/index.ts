import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import {
  createR2GetUrl,
  createR2PutUrl,
  R2StorageConfigurationError,
  readR2StorageConfig,
} from "../_shared/r2-storage.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  type AuthorizationRow,
  buildDecisionAuditStorageKey,
  type DecisionRow,
  deriveAuditArtifactPlan,
  isResolvedDecisionStatus,
  missingRequiredAuthorizeSignerRoles,
  renderAuthorizePdfBytes,
  renderDecisionCardHtml,
  sha256Hex,
} from "./logic.ts";

type AdminClient = any;

type RequestBody = {
  decision_id?: string;
  decision_code?: string;
  actor?: string;
  dry_run?: boolean;
  include_download_url?: boolean;
  now?: string;
};

type ArtifactInsert = {
  decision_id: string;
  audit_grade: string;
  artifact_kind: string;
  storage_provider: string;
  storage_bucket: string | null;
  storage_key: string | null;
  content_type: string | null;
  checksum_sha256: string | null;
  byte_size: number | null;
  retention_until: string | null;
  status: "row_only" | "stored" | "failed";
  error_message?: string | null;
  generated_by: string;
  generated_at: string;
  metadata: Record<string, unknown>;
};

const FUNCTION_NAME = "decision-audit-artifact";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("POST only", 405, origin);

  try {
    const body = await req.json().catch(() => ({})) as RequestBody;
    const requestedActorLabel = body.actor?.trim() || null;
    const serviceCaller = isServiceRoleCaller(req);
    let actor = requestedActorLabel ?? FUNCTION_NAME;

    if (!serviceCaller) {
      const auth = await requireServiceUser(
        req.headers.get("Authorization"),
        origin,
      );
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError("Forbidden", 403, origin);
      }
      actor = `${auth.role}:${auth.userId}`;
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return safeJsonError("Server misconfiguration", 500, origin);
    }

    const generatedAt = body.now ? new Date(body.now) : new Date();
    if (Number.isNaN(generatedAt.getTime())) {
      return safeJsonError("Invalid now timestamp", 400, origin);
    }

    const admin: AdminClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

    const decision = await loadDecision(admin, body);
    if (!decision) return safeJsonError("Decision not found", 404, origin);
    if (!isResolvedDecisionStatus(decision.status)) {
      return safeJsonError(
        `Decision ${decision.code} is not resolved; status=${decision.status}`,
        400,
        origin,
      );
    }

    const authorizations = await loadAuthorizations(admin, decision.id);
    const plan = deriveAuditArtifactPlan(decision, generatedAt);
    if (plan.auditGrade === "authorize") {
      const missingSigners = missingRequiredAuthorizeSignerRoles(
        decision,
        authorizations,
      );
      if (missingSigners.length > 0) {
        return safeJsonError(
          `AUTHORIZE artifact requires active signatures from: ${
            missingSigners.join(", ")
          }`,
          409,
          origin,
        );
      }
    }
    const storageKey = buildDecisionAuditStorageKey({
      decision,
      plan,
      generatedAt,
    });
    const generatedAtIso = generatedAt.toISOString();

    let bytes: Uint8Array | null = null;
    let html: string | null = null;
    if (plan.artifactKind === "html") {
      html = renderDecisionCardHtml({ decision, authorizations, generatedAt });
      bytes = new TextEncoder().encode(html);
    } else if (plan.artifactKind === "pdf") {
      bytes = renderAuthorizePdfBytes({
        decision,
        authorizations,
        generatedAt,
      });
    }

    const checksum = bytes ? await sha256Hex(bytes) : null;
    const byteSize = bytes?.byteLength ?? null;
    const metadata = buildMetadata({
      decision,
      authorizations,
      actor,
      requestedActorLabel,
      serviceCaller,
    });

    if (body.dry_run === true) {
      return safeJsonOk({
        ok: true,
        dry_run: true,
        decision_id: decision.id,
        decision_code: decision.code,
        audit_grade: plan.auditGrade,
        artifact_kind: plan.artifactKind,
        storage_key: storageKey,
        content_type: plan.contentType,
        checksum_sha256: checksum,
        byte_size: byteSize,
        retention_until: plan.retentionUntil,
        html_preview: html,
        metadata,
      }, origin);
    }

    if (plan.artifactKind === "row") {
      const artifact = await insertArtifact(admin, {
        decision_id: decision.id,
        audit_grade: plan.auditGrade,
        artifact_kind: plan.artifactKind,
        storage_provider: "r2",
        storage_bucket: null,
        storage_key: null,
        content_type: null,
        checksum_sha256: null,
        byte_size: null,
        retention_until: null,
        status: "row_only",
        generated_by: actor,
        generated_at: generatedAtIso,
        metadata,
      });
      const roadmap_event_error = await logRoadmapAuditEvent(
        admin,
        decision,
        artifact.id,
        actor,
        "row_only",
      );
      return safeJsonOk({
        ok: true,
        dry_run: false,
        artifact,
        roadmap_event_error,
      }, origin);
    }

    if (!bytes || !storageKey || !plan.contentType) {
      return safeJsonError("Artifact rendering failed", 500, origin);
    }

    let bucket: string | null = null;
    try {
      const config = readR2StorageConfig();
      bucket = config.bucket;
      const putUrl = await createR2PutUrl(storageKey, config);
      const uploadResponse = await fetch(putUrl.url, {
        method: "PUT",
        headers: {
          "Content-Type": plan.contentType,
          "Cache-Control": "private, max-age=31536000, immutable",
        },
        body: bytes,
        signal: AbortSignal.timeout(30_000),
      });
      if (!uploadResponse.ok) {
        const detail = await uploadResponse.text().catch(() => "");
        throw new Error(
          `R2 PUT returned HTTP ${uploadResponse.status}: ${
            detail.slice(0, 300)
          }`,
        );
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "R2 upload failed";
      await insertArtifact(admin, {
        decision_id: decision.id,
        audit_grade: plan.auditGrade,
        artifact_kind: plan.artifactKind,
        storage_provider: "r2",
        storage_bucket: bucket,
        storage_key: storageKey,
        content_type: plan.contentType,
        checksum_sha256: checksum,
        byte_size: byteSize,
        retention_until: plan.retentionUntil,
        status: "failed",
        error_message: message,
        generated_by: actor,
        generated_at: generatedAtIso,
        metadata: { ...metadata, upload_failed: true },
      });

      if (error instanceof R2StorageConfigurationError) {
        return safeJsonError(error.message, 500, origin);
      }
      return safeJsonError(message, 502, origin);
    }

    const artifact = await insertArtifact(admin, {
      decision_id: decision.id,
      audit_grade: plan.auditGrade,
      artifact_kind: plan.artifactKind,
      storage_provider: "r2",
      storage_bucket: bucket,
      storage_key: storageKey,
      content_type: plan.contentType,
      checksum_sha256: checksum,
      byte_size: byteSize,
      retention_until: plan.retentionUntil,
      status: "stored",
      generated_by: actor,
      generated_at: generatedAtIso,
      metadata,
    });
    const roadmap_event_error = await logRoadmapAuditEvent(
      admin,
      decision,
      artifact.id,
      actor,
      "stored",
    );

    let downloadUrl: string | null = null;
    if (body.include_download_url === true && storageKey) {
      downloadUrl = (await createR2GetUrl(storageKey)).url;
    }

    return safeJsonOk({
      ok: true,
      dry_run: false,
      artifact,
      download_url: downloadUrl,
      roadmap_event_error,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: FUNCTION_NAME, req });
    return safeJsonError(
      error instanceof Error ? error.message : "Internal error",
      500,
      origin,
    );
  }
});

async function loadDecision(
  admin: AdminClient,
  body: RequestBody,
): Promise<DecisionRow | null> {
  let query = admin
    .from("qep_decisions")
    .select(
      "id, code, question_plain, lane, owner_role, requires_two_sigs, options, recommended_option, recommended_rationale, ai_prep_packet, citations, reversal_cost, status, answered_by, answered_at, answered_option, answered_rationale, audit_url, created_at, updated_at",
    )
    .limit(1);

  if (body.decision_id?.trim()) query = query.eq("id", body.decision_id.trim());
  else if (body.decision_code?.trim()) {
    query = query.eq("code", body.decision_code.trim());
  } else throw new Error("decision_id or decision_code is required");

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load decision: ${error.message}`);
  return (data as DecisionRow | null) ?? null;
}

async function loadAuthorizations(
  admin: AdminClient,
  decisionId: string,
): Promise<AuthorizationRow[]> {
  const { data, error } = await admin
    .from("qep_decision_authorizations")
    .select(
      "id, signer_role, signer_name, signer_email, signature_hash, terms_version, signed_at, metadata, revoked_at",
    )
    .eq("decision_id", decisionId)
    .is("revoked_at", null)
    .order("signed_at", { ascending: true });

  if (error) throw new Error(`Failed to load authorizations: ${error.message}`);
  return (data ?? []) as AuthorizationRow[];
}

async function insertArtifact(
  admin: AdminClient,
  row: ArtifactInsert,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from("qep_decision_audit_artifacts")
    .insert(row)
    .select(
      "id, decision_id, audit_grade, artifact_kind, storage_bucket, storage_key, content_type, checksum_sha256, byte_size, retention_until, status, generated_at, metadata",
    )
    .single();

  if (error) {
    throw new Error(
      `Failed to insert audit artifact ledger row: ${error.message}`,
    );
  }
  return data as Record<string, unknown>;
}

async function logRoadmapAuditEvent(
  admin: AdminClient,
  decision: DecisionRow,
  artifactId: unknown,
  actor: string,
  status: "row_only" | "stored",
): Promise<string | null> {
  const { error } = await admin
    .from("qep_roadmap_sync_events")
    .insert({
      direction: "reconcile",
      action: "skip",
      actor,
      changed_fields: {
        reason: "decision_audit_artifact_generated",
        decision_id: decision.id,
        decision_code: decision.code,
        decision_lane: decision.lane,
        artifact_id: artifactId,
        artifact_status: status,
      },
    });

  if (error) {
    return `Failed to log roadmap audit event: ${error.message}`;
  }
  return null;
}

function buildMetadata(input: {
  decision: DecisionRow;
  authorizations: AuthorizationRow[];
  actor: string;
  requestedActorLabel: string | null;
  serviceCaller: boolean;
}): Record<string, unknown> {
  return {
    decision_code: input.decision.code,
    decision_status: input.decision.status,
    answered_at: input.decision.answered_at,
    answered_by: input.decision.answered_by,
    signer_roles: input.authorizations.map((row) => row.signer_role),
    signer_count: input.authorizations.length,
    generated_by_function: FUNCTION_NAME,
    requested_by: input.actor,
    service_role_caller: input.serviceCaller,
    requested_actor_label: input.requestedActorLabel,
  };
}
