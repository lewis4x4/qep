/**
 * N1.1 make-ready workflow: Deposit Collected → open the pdi_new_prep
 * service job on the deal's subject unit.
 *
 * Consumes the m793-enriched deal.stage.changed payload (equipment_id +
 * stage_name). The open_internal_service_job action is idempotent per
 * (equipment, event), and the H10 defaults trigger maps pdi_new_prep to the
 * new_unit_prep cost destination. The m793 badge trigger flags the deal at
 * "Equipment Ready" while this job remains open.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const dealDepositMakeReady: FlowWorkflowDefinition = {
  slug: "deal-deposit-make-ready",
  name: "Deposit collected → make-ready PDI work order",
  description:
    "When a deal reaches Deposit Collected with a subject unit attached, open an internal pdi_new_prep service job so the machine is washed, fitted, and PDI-complete before Equipment Ready.",
  owner_role: "service",
  trigger_event_pattern: "deal.stage.changed",
  // Field root note: the condition/param resolver exposes the event's
  // properties as `payload.*` (condition-eval.ts resolveField) — NOT
  // `event.payload.*`, which silently resolves undefined.
  conditions: [
    { op: "eq", field: "payload.stage_name", value: "Deposit Collected" },
    { op: "exists", field: "payload.equipment_id" },
  ],
  actions: [
    {
      action_key: "open_internal_service_job",
      params: {
        equipment_id: "${payload.equipment_id}",
        work_class: "pdi_new_prep",
        cost_destination: "new_unit_prep",
        summary:
          "Make-ready PDI for deal ${payload.deal_id} (deposit collected): wash, install attachments, complete pre-delivery inspection.",
      },
    },
    {
      action_key: "create_audit_event",
      params: {
        tag: "make_ready_opened",
        metadata: {
          deal_id: "${payload.deal_id}",
          equipment_id: "${payload.equipment_id}",
          stage_name: "${payload.stage_name}",
        },
      },
    },
  ],
  affects_modules: ["service", "qrm"],
};
