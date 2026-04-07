/**
 * QEP Flow Engine — action registry.
 *
 * Slice 1 ships an empty registry. Slice 2 fills it with 12 actions
 * wrapping the existing _shared/* dispatch helpers (resend-email,
 * service-lifecycle-notify, vendor-escalation-resend, etc.).
 *
 * Workflows reference actions by string key only. The registry is the
 * single point of truth for "what can a workflow do".
 */
import type { FlowAction } from "./types.ts";

export const ACTION_REGISTRY: Record<string, FlowAction> = {
  // Slice 2 fills this in.
};

/** Look up an action; throws if missing so workflow validation catches typos. */
export function getAction(key: string): FlowAction {
  const action = ACTION_REGISTRY[key];
  if (!action) {
    throw new Error(`flow_engine: action '${key}' not found in registry`);
  }
  return action;
}
