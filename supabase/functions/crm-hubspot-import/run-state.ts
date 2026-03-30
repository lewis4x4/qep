import type { SupabaseClient as SupabaseClientBase } from "jsr:@supabase/supabase-js@2";
import {
  emptyCheckpoint,
  type ImportCheckpoint,
  type ImportRunRow,
  type ImportState,
} from "./types.ts";

/** Service-role client without generated DB types (Edge bundle). */
type SupabaseClient = SupabaseClientBase<any, "public", any>;

export async function loadOrCreateImportState(
  supabase: SupabaseClient,
  runId: string | undefined,
  actorUserId: string,
  callerWorkspaceId: string,
): Promise<ImportState> {
  if (runId) {
    const { data: existingRun, error } = await supabase
      .from("crm_hubspot_import_runs")
      .select(
        "id, workspace_id, initiated_by, metadata, contacts_processed, companies_processed, deals_processed, activities_processed, error_count",
      )
      .eq("id", runId)
      .maybeSingle<ImportRunRow>();

    if (error || !existingRun) {
      throw new Error("RUN_NOT_FOUND");
    }
    if (existingRun.workspace_id !== callerWorkspaceId) {
      throw new Error("RUN_WORKSPACE_FORBIDDEN");
    }
    if (existingRun.initiated_by !== actorUserId) {
      throw new Error("RUN_ACTOR_FORBIDDEN");
    }

    const metadata =
      existingRun.metadata && typeof existingRun.metadata === "object"
        ? { ...existingRun.metadata }
        : {};
    const checkpoint = (metadata.checkpoint as ImportCheckpoint | undefined) ??
      emptyCheckpoint();

    return {
      runId: existingRun.id,
      workspaceId: existingRun.workspace_id,
      metadata,
      checkpoint,
      contactsProcessed: existingRun.contacts_processed,
      companiesProcessed: existingRun.companies_processed,
      dealsProcessed: existingRun.deals_processed,
      activitiesProcessed: existingRun.activities_processed,
      errorCount: existingRun.error_count,
    };
  }

  const { data: created, error } = await supabase
    .from("crm_hubspot_import_runs")
    .insert({
      workspace_id: callerWorkspaceId,
      initiated_by: actorUserId,
      status: "running",
      metadata: { checkpoint: emptyCheckpoint() },
    })
    .select(
      "id, workspace_id, initiated_by, metadata, contacts_processed, companies_processed, deals_processed, activities_processed, error_count",
    )
    .single<ImportRunRow>();

  if (error || !created) {
    throw new Error(`RUN_CREATE_FAILED:${error?.message ?? "unknown"}`);
  }

  return {
    runId: created.id,
    workspaceId: created.workspace_id,
    metadata: (created.metadata as Record<string, unknown>) ?? {},
    checkpoint: emptyCheckpoint(),
    contactsProcessed: created.contacts_processed,
    companiesProcessed: created.companies_processed,
    dealsProcessed: created.deals_processed,
    activitiesProcessed: created.activities_processed,
    errorCount: created.error_count,
  };
}

export async function updateRun(
  supabase: SupabaseClient,
  state: ImportState,
  status?: string,
  errorSummary?: string,
): Promise<void> {
  state.metadata.checkpoint = state.checkpoint;

  const payload: Record<string, unknown> = {
    contacts_processed: state.contactsProcessed,
    companies_processed: state.companiesProcessed,
    deals_processed: state.dealsProcessed,
    activities_processed: state.activitiesProcessed,
    error_count: state.errorCount,
    metadata: state.metadata,
  };

  if (status) payload.status = status;
  if (errorSummary !== undefined) payload.error_summary = errorSummary;
  if (
    status === "completed" || status === "completed_with_errors" ||
    status === "failed"
  ) {
    payload.completed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("crm_hubspot_import_runs")
    .update(payload)
    .eq("id", state.runId);

  if (error) {
    throw new Error(`Failed to update import run: ${error.message}`);
  }
}

export async function appendImportError(
  supabase: SupabaseClient,
  state: ImportState,
  entityType: string,
  externalId: string,
  reasonCode: string,
  message: string,
  payloadSnippet: unknown,
): Promise<void> {
  state.errorCount += 1;

  const { error } = await supabase.from("crm_hubspot_import_errors").insert({
    workspace_id: state.workspaceId,
    run_id: state.runId,
    entity_type: entityType,
    external_id: externalId,
    reason_code: reasonCode,
    message,
    payload_snippet: payloadSnippet,
  });

  if (error) {
    console.error("[crm-import] failed to persist import error", {
      runId: state.runId,
      entityType,
      externalId,
      message: error.message,
    });
  }
}
