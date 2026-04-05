/**
 * Service Parts Planner — Auto-split parts requirements into pick/transfer/order
 * actions with system-generated need-by dates.
 *
 * Auth: user JWT only
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface PlanRequest {
  job_id: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;

    const body: PlanRequest = await req.json();
    if (!body.job_id) return safeJsonError("job_id required", 400, origin);

    // Fetch job and its parts requirements
    const { data: job, error: jobErr } = await supabase
      .from("service_jobs")
      .select("id, workspace_id, branch_id, haul_required, scheduled_start_at, status_flags")
      .eq("id", body.job_id)
      .single();

    if (jobErr || !job) return safeJsonError("Job not found", 404, origin);

    const { data: requirements } = await supabase
      .from("service_parts_requirements")
      .select("*")
      .eq("job_id", body.job_id)
      .neq("status", "cancelled");

    if (!requirements || requirements.length === 0) {
      return safeJsonOk({ message: "No parts requirements to plan", actions_created: 0 }, origin);
    }

    const planBatchId = crypto.randomUUID();
    const supersedeAt = new Date().toISOString();
    await supabase
      .from("service_parts_actions")
      .update({ superseded_at: supersedeAt })
      .eq("job_id", body.job_id)
      .is("completed_at", null)
      .is("superseded_at", null);

    const vendorIds = [
      ...new Set(
        requirements.map((r: { vendor_id?: string | null }) => r.vendor_id).filter(Boolean),
      ),
    ] as string[];
    const { data: vendorRows } = vendorIds.length > 0
      ? await supabase
        .from("vendor_profiles")
        .select("id, avg_lead_time_hours")
        .in("id", vendorIds)
      : { data: [] as { id: string; avg_lead_time_hours: number | null }[] };
    const vendorLead = new Map(
      (vendorRows ?? []).map((v) => [v.id, Number(v.avg_lead_time_hours ?? 48)]),
    );

    const isMachineDown = Array.isArray(job.status_flags) &&
      job.status_flags.includes("machine_down");

    const plannerHeuristicLegacy =
      Deno.env.get("PLANNER_HEURISTIC_MODE") === "legacy";

    let plannerRules: Record<string, unknown> = {};
    if (job.branch_id) {
      const { data: cfg } = await supabase
        .from("service_branch_config")
        .select("planner_rules")
        .eq("workspace_id", job.workspace_id)
        .eq("branch_id", job.branch_id)
        .maybeSingle();
      if (cfg?.planner_rules && typeof cfg.planner_rules === "object") {
        plannerRules = cfg.planner_rules as Record<string, unknown>;
      }
    }

    const partNumbers = [
      ...new Set(
        requirements.map((r: { part_number: string }) =>
          String(r.part_number ?? "").trim()
        ),
      ),
    ].filter(Boolean);

    const stockRemaining = new Map<string, number>();
    if (!plannerHeuristicLegacy && job.branch_id && partNumbers.length > 0) {
      const { data: invRows } = await supabase
        .from("parts_inventory")
        .select("part_number, qty_on_hand")
        .eq("workspace_id", job.workspace_id)
        .eq("branch_id", job.branch_id)
        .is("deleted_at", null)
        .in("part_number", partNumbers);
      for (const row of invRows ?? []) {
        const pn = String(row.part_number ?? "").trim();
        stockRemaining.set(pn, Number(row.qty_on_hand ?? 0));
      }
    }

    const actionsToInsert: Record<string, unknown>[] = [];
    const requirementUpdates: { id: string; status: string; need_by_date: string | null }[] = [];

    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i] as Record<string, unknown> & {
        id: string;
        vendor_id?: string | null;
        part_number?: string;
        quantity?: number;
      };
      const pn = String(req.part_number ?? "").trim();
      const needQty = Math.max(1, Number(req.quantity ?? 1));

      let actionType: "pick" | "order" | "transfer" = "order";
      let nextLineStatus = "ordering";

      if (plannerHeuristicLegacy) {
        if (!isMachineDown && job.branch_id && i === 0) {
          actionType = "pick";
          nextLineStatus = "picking";
        } else if (!isMachineDown && job.branch_id && i === 1) {
          actionType = "transfer";
          nextLineStatus = "transferring";
        } else {
          actionType = "order";
          nextLineStatus = "ordering";
        }
      } else {
        let avail = stockRemaining.get(pn) ?? 0;
        if (!isMachineDown && avail >= needQty) {
          actionType = "pick";
          nextLineStatus = "picking";
          stockRemaining.set(pn, avail - needQty);
        } else {
          actionType = "order";
          nextLineStatus = "ordering";
        }
      }

      const confidence = plannerHeuristicLegacy ? "medium" : "high";
      const leadH = req.vendor_id ? (vendorLead.get(req.vendor_id) ?? 48) : 48;

      const baseDate = job.scheduled_start_at
        ? new Date(job.scheduled_start_at as string)
        : new Date(Date.now() + 48 * 3600_000);

      const bufferHours = 4 + (job.haul_required ? 24 : 0);
      const leadMs = actionType === "order" ? leadH * 3600_000 : 0;
      const needBy = new Date(baseDate.getTime() - bufferHours * 3600_000 - leadMs);

      const effectiveNeedBy = isMachineDown
        ? new Date(Date.now() + 8 * 3600_000)
        : needBy;

      const expectedDelivery = actionType === "order"
        ? new Date(effectiveNeedBy.getTime())
        : null;

      const meta: Record<string, unknown> = {
        confidence,
        planned_at: new Date().toISOString(),
        plan_batch_id: planBatchId,
        planner_rules: plannerRules,
        planner_mode: plannerHeuristicLegacy ? "legacy_line_index" : "stock_first",
      };
      if (plannerHeuristicLegacy) {
        meta.heuristic = "branch_first_pick_then_transfer_then_order";
        meta.inventory_assumption = "legacy_heuristic_no_inventory";
      } else {
        meta.heuristic = "parts_inventory_stock_first_else_order";
        meta.inventory_assumption = "parts_inventory_branch_qty";
      }
      if (actionType === "transfer" && job.branch_id) {
        meta.from_branch = job.branch_id;
        meta.to_branch = job.branch_id;
      }
      if (actionType === "order") {
        meta.vendor_lead_time_hours = leadH;
      }

      actionsToInsert.push({
        workspace_id: job.workspace_id,
        requirement_id: req.id,
        job_id: body.job_id,
        action_type: actionType,
        vendor_id: req.vendor_id ?? null,
        expected_date: expectedDelivery?.toISOString() ?? null,
        plan_batch_id: planBatchId,
        metadata: meta,
      });

      requirementUpdates.push({
        id: req.id,
        status: nextLineStatus,
        need_by_date: effectiveNeedBy.toISOString(),
      });
    }

    // Batch insert actions
    if (actionsToInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from("service_parts_actions")
        .insert(actionsToInsert);
      if (insertErr) {
        console.error("parts actions insert error:", insertErr);
        return safeJsonError(insertErr.message, 400, origin);
      }
    }

    // Update requirements with need-by dates and status
    for (const upd of requirementUpdates) {
      await supabase
        .from("service_parts_requirements")
        .update({ status: upd.status, need_by_date: upd.need_by_date })
        .eq("id", upd.id);
    }

    return safeJsonOk({
      actions_created: actionsToInsert.length,
      requirements_updated: requirementUpdates.length,
      is_machine_down: isMachineDown,
      plan_batch_id: planBatchId,
      metadata: {
        planner_mode: plannerHeuristicLegacy ? "legacy_line_index" : "stock_first",
        planner_rules: plannerRules,
        env: { PLANNER_HEURISTIC_MODE: plannerHeuristicLegacy ? "legacy" : "unset_or_off" },
      },
    }, origin);
  } catch (err) {
    console.error("service-parts-planner error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
