import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface VoiceCaptureExtractedDealData {
  customer_name: string | null;
  company_name: string | null;
  machine_interest: string | null;
  attachments_discussed: string | null;
  deal_stage: string | null;
  budget_range: string | null;
  key_concerns: string | null;
  action_items: string[];
  next_step: string | null;
  follow_up_date: string | null;
}

export interface LocalVoiceCaptureCrmSyncResult {
  saved: boolean;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  noteActivityId: string | null;
  taskActivityId: string | null;
}

interface LocalCrmTarget {
  dealId: string;
  contactId: string | null;
  companyId: string | null;
}

function buildLocalNoteBody(
  transcript: string,
  extracted: VoiceCaptureExtractedDealData,
): string {
  const lines: string[] = [];

  if (extracted.customer_name || extracted.company_name) {
    lines.push(
      [extracted.customer_name, extracted.company_name].filter(Boolean).join(" · "),
    );
  }
  if (extracted.machine_interest) {
    lines.push(`Equipment: ${extracted.machine_interest}`);
  }
  if (extracted.deal_stage) {
    lines.push(`Stage: ${extracted.deal_stage}`);
  }
  if (extracted.next_step) {
    lines.push(`Next step: ${extracted.next_step}`);
  }
  if (extracted.key_concerns) {
    lines.push(`Concerns: ${extracted.key_concerns}`);
  }
  if (extracted.action_items.length > 0) {
    lines.push(`Action items: ${extracted.action_items.join(" | ")}`);
  }

  lines.push("", transcript);
  return lines.join("\n").trim();
}

async function resolveLocalTarget(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  dealId: string | null,
): Promise<LocalCrmTarget | null> {
  if (!dealId) return null;

  const { data, error } = await supabaseAdmin
    .from("crm_deals")
    .select("id, primary_contact_id, company_id")
    .eq("workspace_id", workspaceId)
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  return {
    dealId: data.id,
    contactId: data.primary_contact_id,
    companyId: data.company_id,
  };
}

async function ensureNoteActivity(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  actorUserId: string,
  captureId: string,
  occurredAtIso: string,
  target: LocalCrmTarget,
  transcript: string,
  extracted: VoiceCaptureExtractedDealData,
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("crm_activities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("deal_id", target.dealId)
    .eq("activity_type", "note")
    .is("deleted_at", null)
    .contains("metadata", {
      source: "voice_capture",
      voiceCaptureId: captureId,
      activityKind: "note",
    })
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data, error } = await supabaseAdmin
    .from("crm_activities")
    .insert({
      workspace_id: workspaceId,
      activity_type: "note",
      body: buildLocalNoteBody(transcript, extracted),
      occurred_at: occurredAtIso,
      deal_id: target.dealId,
      created_by: actorUserId,
      metadata: {
        source: "voice_capture",
        voiceCaptureId: captureId,
        activityKind: "note",
        transcript,
        extractedSummary: {
          customerName: extracted.customer_name,
          companyName: extracted.company_name,
          machineInterest: extracted.machine_interest,
          dealStage: extracted.deal_stage,
          nextStep: extracted.next_step,
        },
      },
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function ensureTaskActivity(
  supabaseAdmin: SupabaseClient,
  workspaceId: string,
  actorUserId: string,
  captureId: string,
  occurredAtIso: string,
  target: LocalCrmTarget,
  extracted: VoiceCaptureExtractedDealData,
): Promise<string | null> {
  if (!extracted.next_step && extracted.action_items.length === 0) {
    return null;
  }

  const { data: existing } = await supabaseAdmin
    .from("crm_activities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("deal_id", target.dealId)
    .eq("activity_type", "task")
    .is("deleted_at", null)
    .contains("metadata", {
      source: "voice_capture",
      voiceCaptureId: captureId,
      activityKind: "task",
    })
    .maybeSingle();

  if (existing?.id) return existing.id;

  const dueAt = extracted.follow_up_date
    ? new Date(extracted.follow_up_date).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const taskBody = extracted.next_step
    ? `Field note follow-up: ${extracted.next_step}`
    : extracted.action_items[0] ?? "Review field note and follow up.";

  const { data, error } = await supabaseAdmin
    .from("crm_activities")
    .insert({
      workspace_id: workspaceId,
      activity_type: "task",
      body: taskBody,
      occurred_at: occurredAtIso,
      deal_id: target.dealId,
      created_by: actorUserId,
      metadata: {
        source: "voice_capture",
        voiceCaptureId: captureId,
        activityKind: "task",
        task: {
          dueAt,
          status: "open",
        },
        actionItems: extracted.action_items,
      },
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

export async function writeVoiceCaptureToLocalCrm(
  supabaseAdmin: SupabaseClient,
  input: {
    workspaceId: string;
    actorUserId: string;
    captureId: string;
    dealId: string | null;
    occurredAtIso: string;
    transcript: string;
    extracted: VoiceCaptureExtractedDealData;
  },
): Promise<LocalVoiceCaptureCrmSyncResult> {
  const target = await resolveLocalTarget(
    supabaseAdmin,
    input.workspaceId,
    input.dealId,
  );

  if (!target) {
    return {
      saved: false,
      dealId: input.dealId,
      contactId: null,
      companyId: null,
      noteActivityId: null,
      taskActivityId: null,
    };
  }

  const [noteActivityId, taskActivityId] = await Promise.all([
    ensureNoteActivity(
      supabaseAdmin,
      input.workspaceId,
      input.actorUserId,
      input.captureId,
      input.occurredAtIso,
      target,
      input.transcript,
      input.extracted,
    ),
    ensureTaskActivity(
      supabaseAdmin,
      input.workspaceId,
      input.actorUserId,
      input.captureId,
      input.occurredAtIso,
      target,
      input.extracted,
    ),
  ]);

  return {
    saved: true,
    dealId: target.dealId,
    contactId: target.contactId,
    companyId: target.companyId,
    noteActivityId,
    taskActivityId,
  };
}
