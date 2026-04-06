/**
 * Branch `service_branch_config.planner_rules` — validated on save (UI).
 * Edge `service-parts-planner` also sanitizes numeric keys at runtime.
 */
const NUMERIC_KEYS = [
  "transfer_default_lead_hours",
  "transfer_vs_order_slack_hours",
] as const;

const MAX_HOURS = 8760;

export function normalizePlannerRules(raw: unknown):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "planner_rules must be a JSON object" };
  }
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...o };
  for (const key of NUMERIC_KEYS) {
    if (!(key in out)) continue;
    const v = out[key];
    if (v === undefined || v === null) {
      delete out[key];
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_HOURS) {
      return {
        ok: false,
        message: `${key} must be a number between 0 and ${MAX_HOURS}`,
      };
    }
    out[key] = n;
  }
  return { ok: true, value: out };
}
