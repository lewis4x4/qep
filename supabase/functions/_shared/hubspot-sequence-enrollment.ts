import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requestHubSpot } from "./hubspot-client.ts";

export interface DealSequenceEnrollmentInput {
  supabase: SupabaseClient;
  hubId: string;
  dealId: string;
  stageValue: string;
  dealName: string;
  ownerId: string | null;
  contactId: string | null;
  contactName: string | null;
  token: string;
}

export async function applyDealStageSequences(
  input: DealSequenceEnrollmentInput,
): Promise<void> {
  const { data: sequences, error: sequenceError } = await input.supabase
    .from("follow_up_sequences")
    .select("id, name")
    .eq("trigger_stage", input.stageValue)
    .eq("is_active", true);

  if (sequenceError) {
    throw new Error(`Failed to load sequences: ${sequenceError.message}`);
  }

  if (!sequences || sequences.length === 0) {
    return;
  }

  for (const sequence of sequences) {
    const { data: firstStep, error: firstStepError } = await input.supabase
      .from("follow_up_steps")
      .select("day_offset")
      .eq("sequence_id", sequence.id)
      .eq("step_number", 1)
      .maybeSingle<{ day_offset: number }>();

    if (firstStepError) {
      throw new Error(
        `Failed to load first step for sequence ${sequence.id}: ${firstStepError.message}`,
      );
    }

    const nextDue = firstStep
      ? new Date(Date.now() + firstStep.day_offset * 86_400_000).toISOString()
      : null;

    const { data: enrollmentRows, error: enrollmentError } = await input
      .supabase
      .from("sequence_enrollments")
      .upsert(
        {
          sequence_id: sequence.id,
          deal_id: input.dealId,
          deal_name: input.dealName,
          contact_id: input.contactId,
          contact_name: input.contactName,
          owner_id: input.ownerId,
          hub_id: input.hubId,
          current_step: 1,
          next_step_due_at: nextDue,
          status: "active",
        },
        { onConflict: "deal_id,sequence_id" },
      )
      .select("id")
      .limit(1);

    if (enrollmentError || !enrollmentRows || enrollmentRows.length === 0) {
      throw new Error(
        `Failed to enroll deal ${input.dealId}: ${
          enrollmentError?.message ?? "No enrollment row returned"
        }`,
      );
    }

    await input.supabase.from("activity_log").insert({
      enrollment_id: enrollmentRows[0].id,
      deal_id: input.dealId,
      hub_id: input.hubId,
      activity_type: "enrollment_created",
      payload: { sequence_name: sequence.name, next_due: nextDue },
    });

    await requestHubSpot({
      hubId: input.hubId,
      operationKey: "deal_update",
      token: input.token,
      method: "PATCH",
      path: `/crm/v3/objects/deals/${input.dealId}`,
      body: JSON.stringify({
        properties: {
          blackrock_automation_enrolled: "true",
          blackrock_followup_step: "1",
          blackrock_last_followup_date: new Date().toISOString().split("T")[0],
        },
      }),
    });
  }
}
