type QueryResult<T> = { data: T | null; error: { message: string } | null };

export interface CallerCompanyAccessClient {
  from(table: "crm_companies"): any;
}

export async function assertCallerCanAccessLinkedCompany(
  callerClient: CallerCompanyAccessClient,
  linkedCompanyId: string | null,
): Promise<string | null> {
  if (!linkedCompanyId) return null;
  const { data, error } = (await callerClient
    .from("crm_companies")
    .select("id")
    .eq("id", linkedCompanyId)
    .maybeSingle()) as QueryResult<{ id: string }>;

  if (error) {
    throw new Error("Could not verify the selected company.");
  }
  if (!data?.id) {
    throw new Error("FORBIDDEN_LINKED_COMPANY");
  }
  return data.id;
}

export interface VoiceCaptureInsertPayloadInput {
  userId: string;
  workspaceId: string;
  audioUrl: string;
  transcript: string;
  extractedData: unknown;
  dealId: string | null;
  companyId: string | null;
  contactId: string | null;
}

export function buildVoiceCaptureInsertPayload(input: VoiceCaptureInsertPayloadInput) {
  return {
    user_id: input.userId,
    workspace_id: input.workspaceId,
    audio_url: input.audioUrl,
    transcript: input.transcript,
    linked_company_id: input.companyId,
    linked_deal_id: input.dealId,
    linked_contact_id: input.contactId,
    extracted_data: input.extractedData,
    sync_status: "completed" as const,
    deal_id: input.dealId,
  };
}

export interface CrmActivitiesInsertClient {
  from(table: "crm_activities"): {
    insert(payload: Record<string, unknown>): any;
  };
}

export interface VoiceCapturesInsertClient {
  from(table: "voice_captures"): {
    insert(payload: Record<string, unknown>): {
      select(columns: "id"): {
        single(): any;
      };
    };
  };
}

export async function insertVoiceCaptureWithVc1Links(
  db: VoiceCapturesInsertClient,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const { data, error } = (await db.from("voice_captures").insert(payload).select("id").single()) as QueryResult<{
    id: string;
  }>;
  if (error || !data?.id) {
    throw new Error("Failed to persist voice capture.");
  }
  return { id: data.id };
}

export async function insertKnownCompanyOrDealActivity(
  db: CrmActivitiesInsertClient,
  input: {
    workspaceId: string;
    createdBy: string;
    body: string;
    companyId: string | null;
    dealId: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  if (!input.companyId && !input.dealId) return;
  const { error } = (await db.from("crm_activities").insert({
    workspace_id: input.workspaceId,
    activity_type: "note",
    body: input.body,
    deal_id: input.companyId ? null : input.dealId,
    contact_id: null,
    company_id: input.companyId,
    created_by: input.createdBy,
    metadata: input.metadata,
  })) as QueryResult<unknown>;

  if (error) {
    throw new Error("Unable to create company activity timeline entry.");
  }
}
