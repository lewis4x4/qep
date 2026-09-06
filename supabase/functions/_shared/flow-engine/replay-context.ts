import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { FlowEvent } from "./types.ts";
export interface ReplayStep {
  step_index: number; action_key: string; params: Record<string, unknown>;
  status: string; result: Record<string, unknown> | null; idempotency_key: string | null;
}
export async function resolveReplayContext(admin: SupabaseClient, event: FlowEvent, workflowSlug: string) {
  const priorId = event.properties.resumed_from_run;
  if (priorId == null) return { effectEventId: event.event_id, priorSteps: [] as ReplayStep[] };
  if (typeof priorId !== "string") throw new Error("Invalid replay identity");
  const { data: run, error } = await admin.from("flow_workflow_runs")
    .select("id,workspace_id,event_id,workflow_slug,metadata")
    .eq("id", priorId).eq("workspace_id", event.workspace_id).maybeSingle();
  if (error || !run || run.workflow_slug !== workflowSlug || run.metadata?.resumed_as_event !== event.event_id || run.event_id !== event.parent_event_id) {
    throw new Error("Replay is not bound to the original authorized run");
  }
  const effectEventId = run.metadata?.effect_event_id ?? run.event_id;
  if (typeof effectEventId !== "string" || event.properties.effect_event_id !== effectEventId) throw new Error("Replay effect identity mismatch");
  const { data: steps, error: stepError } = await admin.from("flow_workflow_run_steps")
    .select("step_index,action_key,params,status,result,idempotency_key").eq("run_id", priorId);
  if (stepError) throw new Error("Prior workflow receipts could not be loaded");
  return { effectEventId, priorSteps: (steps ?? []) as ReplayStep[] };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function completedReplayStep(steps: ReplayStep[], index: number, actionKey: string, params: Record<string, unknown>): ReplayStep | undefined {
  const prior = steps.find((step) => step.step_index === index);
  if (!prior || !(prior.status === "succeeded" || (prior.status === "skipped" && prior.result?.idempotency_hit === true))) return undefined;
  if (prior.action_key !== actionKey || canonical(prior.params) !== canonical(params)) throw new Error("Workflow changed since the completed step; review it before replay");
  return prior;
}
