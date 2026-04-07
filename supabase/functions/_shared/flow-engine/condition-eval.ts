/**
 * QEP Flow Engine — condition DSL evaluator.
 *
 * Pure function — same module is imported by the runner edge fn AND by
 * the future dry-run admin UI for "would this fire?" previews. No I/O.
 */
import type { FlowCondition, FlowContext } from "./types.ts";

/** Resolve a dot-walked path against the {event, context} root. */
function resolveField(field: string, context: FlowContext): unknown {
  const root: Record<string, unknown> = {
    event: context.event,
    context: context as unknown as Record<string, unknown>,
    payload: context.event.properties,
  };
  let cur: unknown = root;
  for (const segment of field.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/** Evaluate one condition. Returns true if it matches. */
export function evaluateCondition(cond: FlowCondition, ctx: FlowContext): boolean {
  switch (cond.op) {
    case "eq":   return resolveField(cond.field, ctx) === cond.value;
    case "neq":  return resolveField(cond.field, ctx) !== cond.value;
    case "gt":   return Number(resolveField(cond.field, ctx)) > Number(cond.value);
    case "gte":  return Number(resolveField(cond.field, ctx)) >= Number(cond.value);
    case "lt":   return Number(resolveField(cond.field, ctx)) < Number(cond.value);
    case "lte":  return Number(resolveField(cond.field, ctx)) <= Number(cond.value);

    case "in": {
      const v = resolveField(cond.field, ctx);
      return cond.values.includes(v);
    }
    case "nin": {
      const v = resolveField(cond.field, ctx);
      return !cond.values.includes(v);
    }

    case "exists": {
      const v = resolveField(cond.field, ctx);
      return v !== undefined && v !== null;
    }

    case "within": {
      const v = resolveField(cond.field, ctx);
      if (!v) return false;
      const ts = new Date(String(v)).getTime();
      if (Number.isNaN(ts)) return false;
      return Date.now() - ts <= cond.hours * 60 * 60 * 1000;
    }

    case "role":
      return ctx.event.properties.actor_role === cond.value;

    case "count": {
      const v = resolveField(cond.field, ctx);
      const n = Array.isArray(v) ? v.length : Number(v);
      if (cond.gte != null && n < cond.gte) return false;
      if (cond.lte != null && n > cond.lte) return false;
      return true;
    }

    case "and":
      return cond.clauses.every((c) => evaluateCondition(c, ctx));
    case "or":
      return cond.clauses.some((c) => evaluateCondition(c, ctx));
    case "not":
      return !evaluateCondition(cond.clause, ctx);

    case "no_recent_run": {
      // Slice 1: stub returns true (no suppression). Slice 2 wires recent_runs.
      const recent = ctx.recent_runs ?? [];
      const cutoff = Date.now() - cond.hours * 60 * 60 * 1000;
      return !recent.some((r) =>
        r.workflow_slug === cond.workflow_slug &&
        r.finished_at != null &&
        new Date(r.finished_at).getTime() > cutoff
      );
    }
  }
}

/** Evaluate an array of conditions as an implicit AND. */
export function evaluateConditions(conds: FlowCondition[], ctx: FlowContext): boolean {
  if (conds.length === 0) return true;
  return conds.every((c) => evaluateCondition(c, ctx));
}

/**
 * Compute an idempotency key from a template literal.
 * Replaces ${dot.path} segments with values resolved against the context.
 */
export function computeIdempotencyKey(template: string, ctx: FlowContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
    const v = resolveField(path.trim(), ctx);
    return v == null ? "null" : String(v);
  });
}
