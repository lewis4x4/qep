/**
 * Flagship workflow: equipment.hours_crossed_interval → service prompt
 * + asset-page surface.
 */
import type { FlowWorkflowDefinition } from "../flow-engine/types.ts";

export const equipmentHoursCrossedInterval: FlowWorkflowDefinition = {
  slug: "equipment-hours-crossed-interval",
  name: "Equipment hours crossed service interval → service prompt",
  description:
    "When telematics reports an equipment unit crossed a service interval, create a service prompt for the assigned rep and tag the asset for next dashboard refresh.",
  owner_role: "service",
  trigger_event_pattern: "equipment.hours_crossed_interval",
  conditions: [
    { op: "exists", field: "event.payload.equipment_id" },
  ],
  actions: [
    {
      action_key: "create_task",
      params: {
        activity_type: "service_prompt",
        subject: "Service interval crossed",
        body: "Equipment ${event.payload.equipment_id} has crossed the ${event.payload.interval_hours}h service interval. Schedule maintenance.",
      },
    },
    {
      action_key: "create_audit_event",
      params: {
        tag: "service_interval_crossed",
        metadata: {
          equipment_id: "${event.payload.equipment_id}",
          current_hours: "${event.payload.current_hours}",
          interval: "${event.payload.interval_hours}",
        },
      },
    },
  ],
  affects_modules: ["service", "qrm"],
};
