/**
 * L9.4 — telematics faults open service, not just sales signals (RF-030).
 *
 * The m808 signals trigger emits equipment.telematics.fault enriched with
 * the machine's ownership + company. This pair routes on ownership:
 *
 *   rental_fleet   → open_internal_service_job (work_class
 *                    rental_fleet_maintenance) — the m774 H10 trigger then
 *                    flips readiness to in_service automatically, pulling
 *                    the unit out of the bookable pool.
 *   everything else → open_service_intake — a request_received service job
 *                    on the owning customer, i.e. real service intake
 *                    instead of only a QRM pulse signal.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const telematicsFaultRentalService: FlowWorkflowDefinition = {
  slug: "telematics-fault-rental-service",
  name: "High-severity fault on rental iron → internal work order",
  description:
    "A high/critical telematics fault on a rental-fleet unit opens the H10 internal work order immediately — readiness flips to in_service and the unit leaves the bookable pool.",
  owner_role: "rental",
  trigger_event_pattern: "equipment.telematics.fault",
  conditions: [
    { op: "in", field: "payload.severity", values: ["high", "critical"] },
    { op: "eq", field: "payload.ownership", value: "rental_fleet" },
  ],
  actions: [
    {
      action_key: "open_internal_service_job",
      params: {
        equipment_id: "${payload.equipment_id}",
        work_class: "rental_fleet_maintenance",
        summary: "Telematics fault ${payload.code}: ${payload.title}",
      },
    },
    {
      action_key: "create_audit_event",
      params: { tag: "telematics_fault_work_order" },
      on_failure: "continue",
    },
  ],
  affects_modules: ["rental", "service"],
};

export const telematicsFaultCustomerIntake: FlowWorkflowDefinition = {
  slug: "telematics-fault-customer-intake",
  name: "High-severity fault on customer iron → service intake",
  description:
    "A high/critical telematics fault on a customer-owned machine opens a service intake (request_received) on the owning account so the shop calls the customer before the customer calls the shop.",
  owner_role: "service",
  trigger_event_pattern: "equipment.telematics.fault",
  conditions: [
    { op: "in", field: "payload.severity", values: ["high", "critical"] },
    { op: "neq", field: "payload.ownership", value: "rental_fleet" },
  ],
  actions: [
    {
      action_key: "open_service_intake",
      params: {
        equipment_id: "${payload.equipment_id}",
        company_id: "${payload.company_id}",
        summary: "Telematics fault ${payload.code}: ${payload.title}",
      },
    },
  ],
  affects_modules: ["service", "qrm"],
};
