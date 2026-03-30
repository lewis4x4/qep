import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type CrmMappedObjectType =
  | "company"
  | "contact"
  | "deal"
  | "deal_stage"
  | "activity";

const HUBSPOT_SOURCE_SYSTEM = "hubspot";

interface ExternalMapRow {
  internal_id: string;
}

interface IdRow {
  id: string;
}

interface EnsureInternalIdInput {
  supabase: SupabaseClient;
  workspaceId: string;
  objectType: CrmMappedObjectType;
  externalId: string;
  table: string;
  hubspotColumn?: string;
}

export async function findMappedInternalId(
  supabase: SupabaseClient,
  workspaceId: string,
  objectType: CrmMappedObjectType,
  externalId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("crm_external_id_map")
    .select("internal_id")
    .eq("workspace_id", workspaceId)
    .eq("source_system", HUBSPOT_SOURCE_SYSTEM)
    .eq("object_type", objectType)
    .eq("external_id", externalId)
    .maybeSingle<ExternalMapRow>();

  if (error) {
    throw new Error(`Failed to read crm_external_id_map: ${error.message}`);
  }

  return data?.internal_id ?? null;
}

export async function saveExternalIdMapping(
  supabase: SupabaseClient,
  workspaceId: string,
  objectType: CrmMappedObjectType,
  externalId: string,
  internalId: string,
): Promise<void> {
  const { error } = await supabase
    .from("crm_external_id_map")
    .upsert(
      {
        workspace_id: workspaceId,
        source_system: HUBSPOT_SOURCE_SYSTEM,
        object_type: objectType,
        external_id: externalId,
        internal_id: internalId,
      },
      {
        onConflict: "workspace_id,source_system,object_type,external_id",
      },
    );

  if (error) {
    throw new Error(`Failed to upsert crm_external_id_map: ${error.message}`);
  }
}

export async function ensureInternalId(
  input: EnsureInternalIdInput,
): Promise<string> {
  const mapped = await findMappedInternalId(
    input.supabase,
    input.workspaceId,
    input.objectType,
    input.externalId,
  );
  if (mapped) return mapped;

  if (input.hubspotColumn) {
    const { data, error } = await input.supabase
      .from(input.table)
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq(input.hubspotColumn, input.externalId)
      .maybeSingle<IdRow>();

    if (error) {
      throw new Error(
        `Failed to find existing ${input.table} row: ${error.message}`,
      );
    }

    if (data?.id) {
      return data.id;
    }
  }

  return crypto.randomUUID();
}
