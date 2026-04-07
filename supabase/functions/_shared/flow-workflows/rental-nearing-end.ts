/**
 * Flagship workflow: rental.nearing_end → off-rent prep + trade-up evaluation.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const rentalNearingEnd: FlowWorkflowDefinition = {
  slug: "rental-nearing-end",
  name: "Rental nearing end → off-rent + trade-up follow-up",
  description:
    "When a rental is within 7 days of end, create off-rent prep tasks and a rep follow-up to evaluate trade-up potential.",
  owner_role: "rental",
  trigger_event_pattern: "rental.nearing_end",
  conditions: [
    { op: "exists", field: "event.payload.rental_id" },
  ],
  actions: [
    {
      action_key: "create_task",
      params: {
        activity_type: "rental_off_rent_prep",
        subject: "Off-rent prep",
        body: "Rental ${event.payload.rental_id} ends ${event.payload.ends_at}. Schedule pickup, inspection, and disposition.",
      },
    },
    {
      action_key: "create_task",
      params: {
        activity_type: "follow_up",
        subject: "Trade-up evaluation",
        body: "Customer rental ending — evaluate fit for trade-up to ownership.",
      },
    },
  ],
  affects_modules: ["rental", "qrm"],
};
