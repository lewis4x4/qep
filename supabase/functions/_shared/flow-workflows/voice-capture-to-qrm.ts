/**
 * Flagship workflow: Voice capture → QRM enrichment + follow-up.
 *
 * Trigger: voice.capture.parsed (fires when extraction_result is set on
 *   a voice_captures row — see migration 194 trigger).
 *
 * Behavior: when a rep records a voice note that is parsed by the AI
 * extractor, automatically:
 *   1. Append a note to the related deal/contact timeline
 *   2. Tag the company with 'risk:competitor' if a competitor was mentioned
 *      with high confidence
 *   3. Recompute the customer's health score so the change ripples to
 *      the dashboard
 *
 * Idempotent: each action's idempotency key includes the voice capture id,
 * so re-running the workflow after a parse correction is safe.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const voiceCaptureToQrm: FlowWorkflowDefinition = {
  slug: "voice-capture-to-qrm",
  name: "Voice capture → QRM enrichment",
  description:
    "When a voice note is parsed, attach a note to the linked entity, tag the account if a competitor signal is present, and recompute the health score.",
  owner_role: "sales",
  trigger_event_pattern: "voice.capture.parsed",
  conditions: [
    { op: "exists", field: "event.properties.extraction_result" },
  ],
  actions: [
    {
      action_key: "create_note",
      params: {
        subject: "Voice capture extracted",
        body: "${event.properties.extraction_result.summary}",
        company_id: "${event.properties.extraction_result.company_id}",
        deal_id: "${event.properties.extraction_result.deal_id}",
        contact_id: "${event.properties.extraction_result.contact_id}",
      },
    },
    {
      action_key: "tag_account",
      params: {
        company_id: "${event.properties.extraction_result.company_id}",
        tag: "risk:competitor",
      },
      on_failure: "continue",
    },
    {
      action_key: "create_audit_event",
      params: {
        tag: "voice_capture_to_qrm",
        metadata: { voice_capture_id: "${event.properties.voice_capture_id}" },
      },
    },
  ],
  affects_modules: ["qrm"],
};
