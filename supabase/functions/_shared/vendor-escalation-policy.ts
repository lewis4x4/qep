/**
 * Validates vendor_escalation_policies.steps (mirrors DB trigger in migration 109).
 * Use when previewing policies in UI before save.
 */
export function validateEscalationPolicySteps(steps: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(steps)) {
    errors.push("steps must be an array");
    return errors;
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== "object") {
      errors.push(`step ${i + 1}: must be an object`);
      continue;
    }
    const o = step as Record<string, unknown>;
    const act = o.action ?? o.type ?? o.step_action;
    const actStr = typeof act === "string" ? act.trim() : "";
    if (!actStr) {
      errors.push(`step ${i + 1}: missing action, type, or step_action`);
      continue;
    }
    if (actStr.toLowerCase() === "switch_alt_vendor") {
      const hasAlt = typeof o.alt_vendor_id === "string" ||
        typeof o.alternate_vendor_id === "string";
      if (!hasAlt) {
        errors.push(
          `step ${i + 1}: switch_alt_vendor requires alt_vendor_id or alternate_vendor_id`,
        );
      }
    }
  }
  return errors;
}
