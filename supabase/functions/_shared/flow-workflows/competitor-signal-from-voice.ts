/**
 * Flagship workflow: voice.capture.parsed with competitor mention →
 * account risk tag + rep prompt.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const competitorSignalFromVoice: FlowWorkflowDefinition = {
  slug: "competitor-signal-from-voice",
  name: "Competitor signal from voice → risk tag + prompt",
  description:
    "When a voice capture mentions a competitor with high confidence, tag the account as a risk and create a rep prompt to address the threat.",
  owner_role: "sales",
  trigger_event_pattern: "voice.capture.parsed",
  conditions: [
    { op: "eq", field: "event.payload.extraction_result.competitor_detected", value: true },
    { op: "gte", field: "event.payload.extraction_result.competitor_confidence", value: 0.7 },
  ],
  actions: [
    {
      action_key: "tag_account",
      params: {
        company_id: "${event.payload.extraction_result.company_id}",
        tag: "competitor_risk",
      },
    },
    {
      action_key: "create_task",
      params: {
        activity_type: "follow_up",
        subject: "Competitor signal — address account risk",
        body: "Voice capture flagged ${event.payload.extraction_result.competitor_name} as a competitive threat. Reach out today.",
      },
    },
    {
      action_key: "create_audit_event",
      params: {
        tag: "competitor_signal_recorded",
        metadata: {
          competitor: "${event.payload.extraction_result.competitor_name}",
          confidence: "${event.payload.extraction_result.competitor_confidence}",
        },
      },
    },
  ],
  affects_modules: ["qrm"],
};
