import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type VoiceCaptureSpeakerSuggestionSource =
  | "recorder_profile"
  | "linked_contact"
  | "linked_company"
  | "extracted_contact"
  | "manual_user"
  | "system_context";

export type VoiceCaptureSpeakerEntityType = "user" | "contact" | "company" | "freeform";

export interface VoiceCaptureSpeakerSuggestion {
  speaker_key: string;
  suggested_display_name: string;
  suggested_entity_type: VoiceCaptureSpeakerEntityType;
  suggested_entity_id: string | null;
  suggestion_source: VoiceCaptureSpeakerSuggestionSource;
  suggestion_confidence: number;
}

export interface VoiceCaptureSpeakerSuggestionInput {
  workspaceId: string;
  captureId: string;
  actorUserId: string;
  captureMode: "field_note" | "live_call";
  linkedCompanyId?: string | null;
  linkedContactId?: string | null;
  linkedDealId?: string | null;
  extractedContactName?: string | null;
  extractedCompanyName?: string | null;
}

interface SuggestionContext extends VoiceCaptureSpeakerSuggestionInput {
  recorderDisplayName?: string | null;
  linkedContactName?: string | null;
  linkedCompanyName?: string | null;
}

function cleanDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function joinName(firstName: unknown, lastName: unknown): string | null {
  return cleanDisplayName(
    [typeof firstName === "string" ? firstName : "", typeof lastName === "string" ? lastName : ""]
      .join(" "),
  );
}

export function buildVoiceCaptureSpeakerSuggestions(
  input: SuggestionContext,
): VoiceCaptureSpeakerSuggestion[] {
  const recorderDisplayName = cleanDisplayName(input.recorderDisplayName) ??
    (input.captureMode === "live_call" ? "Rep" : "Recorder");

  if (input.captureMode === "field_note") {
    return [{
      speaker_key: "speaker_1",
      suggested_display_name: recorderDisplayName,
      suggested_entity_type: "user",
      suggested_entity_id: input.actorUserId,
      suggestion_source: "recorder_profile",
      suggestion_confidence: 0.95,
    }];
  }

  const suggestions: VoiceCaptureSpeakerSuggestion[] = [{
    speaker_key: "rep",
    suggested_display_name: recorderDisplayName,
    suggested_entity_type: "user",
    suggested_entity_id: input.actorUserId,
    suggestion_source: "recorder_profile",
    suggestion_confidence: 0.9,
  }];

  const linkedContactName = cleanDisplayName(input.linkedContactName);
  const linkedCompanyName = cleanDisplayName(input.linkedCompanyName);
  const extractedContactName = cleanDisplayName(input.extractedContactName);
  const extractedCompanyName = cleanDisplayName(input.extractedCompanyName);

  if (input.linkedContactId && linkedContactName) {
    suggestions.push({
      speaker_key: "customer",
      suggested_display_name: linkedContactName,
      suggested_entity_type: "contact",
      suggested_entity_id: input.linkedContactId,
      suggestion_source: "linked_contact",
      suggestion_confidence: 0.75,
    });
  } else if (input.linkedCompanyId && linkedCompanyName) {
    suggestions.push({
      speaker_key: "customer",
      suggested_display_name: linkedCompanyName,
      suggested_entity_type: "company",
      suggested_entity_id: input.linkedCompanyId,
      suggestion_source: "linked_company",
      suggestion_confidence: 0.6,
    });
  } else if (extractedContactName || extractedCompanyName) {
    suggestions.push({
      speaker_key: "customer",
      suggested_display_name: extractedContactName ?? extractedCompanyName ?? "Customer",
      suggested_entity_type: "freeform",
      suggested_entity_id: null,
      suggestion_source: extractedContactName ? "extracted_contact" : "system_context",
      suggestion_confidence: extractedContactName ? 0.5 : 0.4,
    });
  }

  return suggestions;
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return code === "23505" || /duplicate key|unique constraint/i.test(message);
}

async function maybeSingle<T>(query: unknown): Promise<T | null> {
  const result = await (query as PromiseLike<{ data?: T | null; error?: unknown }>);
  if (result?.error) return null;
  return result?.data ?? null;
}

async function loadRecorderDisplayName(
  supabaseAdmin: SupabaseClient,
  actorUserId: string,
): Promise<string | null> {
  const profile = await maybeSingle<{ full_name?: string | null; email?: string | null }>(
    supabaseAdmin
      .from("profiles")
      .select("full_name,email")
      .eq("id", actorUserId)
      .maybeSingle(),
  );
  return cleanDisplayName(profile?.full_name) ?? cleanDisplayName(profile?.email);
}

async function loadLinkedContactName(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  contactId: string | null | undefined,
): Promise<string | null> {
  if (!contactId) return null;
  const contact = await maybeSingle<{
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  }>(
    supabaseAdmin
      .from("crm_contacts")
      .select("first_name,last_name,email")
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  return joinName(contact?.first_name, contact?.last_name) ?? cleanDisplayName(contact?.email);
}

async function loadLinkedCompanyName(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  const company = await maybeSingle<{ name?: string | null; legal_name?: string | null }>(
    supabaseAdmin
      .from("crm_companies")
      .select("name,legal_name")
      .eq("id", companyId)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  return cleanDisplayName(company?.name) ?? cleanDisplayName(company?.legal_name);
}

async function createOrRefreshSuggestedLabel(
  supabaseAdmin: SupabaseClient,
  input: VoiceCaptureSpeakerSuggestionInput,
  suggestion: VoiceCaptureSpeakerSuggestion,
): Promise<void> {
  const row = {
    workspace_id: input.workspaceId,
    voice_capture_id: input.captureId,
    speaker_key: suggestion.speaker_key,
    status: "suggested",
    suggested_display_name: suggestion.suggested_display_name,
    suggested_entity_type: suggestion.suggested_entity_type,
    suggested_entity_id: suggestion.suggested_entity_id,
    suggestion_source: suggestion.suggestion_source,
    suggestion_confidence: suggestion.suggestion_confidence,
    created_by: input.actorUserId,
    metadata: {
      source: "voice_capture_speaker_suggestion_helper",
      captureMode: input.captureMode,
      linkedDealId: input.linkedDealId ?? null,
      privacy: "label_only_no_voiceprint",
    },
  };

  const inserted = await supabaseAdmin.from("voice_capture_speaker_labels").insert(row);
  if (!inserted.error) return;

  if (!isDuplicateKeyError(inserted.error)) {
    console.warn("voice speaker labels: suggestion insert skipped", inserted.error);
    return;
  }

  const refreshed = await supabaseAdmin
    .from("voice_capture_speaker_labels")
    .update({
      suggested_display_name: row.suggested_display_name,
      suggested_entity_type: row.suggested_entity_type,
      suggested_entity_id: row.suggested_entity_id,
      suggestion_source: row.suggestion_source,
      suggestion_confidence: row.suggestion_confidence,
      metadata: row.metadata,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("voice_capture_id", input.captureId)
    .eq("speaker_key", suggestion.speaker_key)
    .eq("status", "suggested");

  if (refreshed.error) {
    console.warn("voice speaker labels: suggestion refresh skipped", refreshed.error);
  }
}

export async function ensureVoiceCaptureSpeakerSuggestions(
  supabaseAdmin: SupabaseClient,
  input: VoiceCaptureSpeakerSuggestionInput,
): Promise<void> {
  try {
    if (!input.workspaceId || !input.captureId || !input.actorUserId) return;

    const [recorderDisplayName, linkedContactName, linkedCompanyName] = await Promise.all([
      loadRecorderDisplayName(supabaseAdmin, input.actorUserId),
      loadLinkedContactName(supabaseAdmin, input.workspaceId, input.linkedContactId),
      loadLinkedCompanyName(supabaseAdmin, input.workspaceId, input.linkedCompanyId),
    ]);

    const suggestions = buildVoiceCaptureSpeakerSuggestions({
      ...input,
      recorderDisplayName,
      linkedContactName,
      linkedCompanyName,
    });

    for (const suggestion of suggestions) {
      await createOrRefreshSuggestedLabel(supabaseAdmin, input, suggestion);
    }
  } catch (error) {
    console.warn("voice speaker labels: best-effort suggestion creation failed", error);
  }
}
