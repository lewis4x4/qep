/**
 * Service Parts Planner — pick / transfer / order with branch-network scoring (P0-A).
 * Creates a Traffic ticket when any transfer is planned (location_transfer).
 *
 * Auth: user JWT only
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { mirrorToFulfillmentRun } from "../_shared/parts-fulfillment-mirror.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
interface PlanRequest {
  job_id: string;
}

type ActionKind = "pick" | "transfer" | "order";

interface PlannedRow {
  requirementId: string;
  actionType: ActionKind;
  nextLineStatus: string;
  fromBranch: string | null;
  toBranch: string | null;
  expectedDelivery: Date | null;
  needByIso: string;
  vendorId: string | null;
  meta: Record<string, unknown>;
}

function finiteRuleHours(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 8760) return fallback;
  return n;
}

function getEdgeLead(
  edgeMap: Map<string, number>,
  from: string,
  to: string,
  defaultHours: number,
): number {
  const a = `${from}|${to}`;
  const b = `${to}|${from}`;
  if (edgeMap.has(a)) return edgeMap.get(a)!;
  if (edgeMap.has(b)) return edgeMap.get(b)!;
  return defaultHours;
}

/** Mutate nested map qty for part at branch */
function takeStock(
  byBranch: Map<string, Map<string, number>>,
  branch: string,
  part: string,
  qty: number,
): void {
  const m = byBranch.get(branch);
  if (!m) return;
  const cur = m.get(part) ?? 0;
  m.set(part, Math.max(0, cur - qty));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;
    const actorId = auth.userId;

    const body: PlanRequest = await req.json();
    if (!body.job_id) return safeJsonError("job_id required", 400, origin);

    const { data: job, error: jobErr } = await supabase
      .from("service_jobs")
      .select(
        "id, workspace_id, branch_id, haul_required, scheduled_start_at, status_flags, fulfillment_run_id",
      )
      .eq("id", body.job_id)
      .single();

    if (jobErr || !job) return safeJsonError("Job not found", 404, origin);

    const jobBranchId = job.branch_id ? String(job.branch_id) : null;

    const { data: requirementsRaw } = await supabase
      .from("service_parts_requirements")
      .select("*")
      .eq("job_id", body.job_id)
      .neq("status", "cancelled");

    const skippedSuggested = (requirementsRaw ?? []).filter(
      (r: { intake_line_status?: string | null }) =>
        (r.intake_line_status ?? "accepted") === "suggested",
    ).length;

    const requirements = (requirementsRaw ?? []).filter(
      (r: { intake_line_status?: string | null }) =>
        (r.intake_line_status ?? "accepted") !== "suggested",
    );

    if (!requirementsRaw || requirementsRaw.length === 0) {
      return safeJsonOk({ message: "No parts requirements to plan", actions_created: 0 }, origin);
    }

    if (requirements.length === 0) {
      return safeJsonOk({
        message:
          "All lines are still suggested — accept lines in the job drawer before planning",
        actions_created: 0,
        skipped_suggested_count: skippedSuggested,
      }, origin);
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
    if (jobBranchId) {
      const { data: cfg } = await supabase
        .from("service_branch_config")
        .select("planner_rules")
        .eq("workspace_id", job.workspace_id)
        .eq("branch_id", jobBranchId)
        .maybeSingle();
      const raw = cfg?.planner_rules;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        plannerRules = raw as Record<string, unknown>;
      }
    }

    const defaultTransferLead = finiteRuleHours(
      plannerRules.transfer_default_lead_hours,
      8,
    );
    const transferVsOrderSlack = finiteRuleHours(
      plannerRules.transfer_vs_order_slack_hours,
      0,
    );

    const partNumbers = [
      ...new Set(
        requirements.map((r: { part_number: string }) =>
          String(r.part_number ?? "").trim()
        ),
      ),
    ].filter(Boolean);

    const edgeMap = new Map<string, number>();
    const { data: edgeRows } = await supabase
      .from("branch_transfer_edges")
      .select("from_branch, to_branch, lead_time_hours")
      .eq("workspace_id", job.workspace_id)
      .eq("active", true);

    for (const e of edgeRows ?? []) {
      const f = String(e.from_branch ?? "").trim();
      const t = String(e.to_branch ?? "").trim();
      if (!f || !t) continue;
      edgeMap.set(`${f}|${t}`, Number(e.lead_time_hours ?? defaultTransferLead));
    }

    /** branch_id -> part -> qty */
    const stockByBranch = new Map<string, Map<string, number>>();
    if (partNumbers.length > 0) {
      const { data: invRows } = await supabase
        .from("parts_inventory")
        .select("branch_id, part_number, qty_on_hand")
        .eq("workspace_id", job.workspace_id)
        .is("deleted_at", null)
        .in("part_number", partNumbers);

      for (const row of invRows ?? []) {
        const bid = String(row.branch_id ?? "").trim();
        const pn = String(row.part_number ?? "").trim();
        if (!bid || !pn) continue;
        if (!stockByBranch.has(bid)) stockByBranch.set(bid, new Map());
        const m = stockByBranch.get(bid)!;
        m.set(pn, Number(row.qty_on_hand ?? 0));
      }
    }

    const planned: PlannedRow[] = [];

    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i] as Record<string, unknown> & {
        id: string;
        vendor_id?: string | null;
        part_number: string;
        quantity?: number;
      };
      const pn = String(req.part_number ?? "").trim();
      const needQty = Math.max(1, Number(req.quantity ?? 1));
      const vendorLeadH = req.vendor_id ? (vendorLead.get(req.vendor_id) ?? 48) : 48;

      const baseDate = job.scheduled_start_at
        ? new Date(job.scheduled_start_at as string)
        : new Date(Date.now() + 48 * 3600_000);
      const bufferHours = 4 + (job.haul_required ? 24 : 0);

      if (plannerHeuristicLegacy) {
        let actionType: ActionKind = "order";
        let nextLineStatus = "ordering";
        if (!isMachineDown && jobBranchId && i === 0) {
          actionType = "pick";
          nextLineStatus = "picking";
        } else if (!isMachineDown && jobBranchId && i === 1) {
          actionType = "transfer";
          nextLineStatus = "transferring";
        }
        const leadMs = actionType === "order" ? vendorLeadH * 3600_000 : 0;
        const needBy = new Date(baseDate.getTime() - bufferHours * 3600_000 - leadMs);
        const effectiveNeedBy = isMachineDown
          ? new Date(Date.now() + 8 * 3600_000)
          : needBy;
        const expectedDelivery = actionType === "order"
          ? new Date(effectiveNeedBy.getTime())
          : null;

        const meta: Record<string, unknown> = {
          confidence: "medium",
          planned_at: new Date().toISOString(),
          plan_batch_id: planBatchId,
          planner_rules: plannerRules,
          planner_mode: "legacy_line_index",
          heuristic: "branch_first_pick_then_transfer_then_order",
          inventory_assumption: "legacy_heuristic_no_inventory",
        };
        if (actionType === "transfer" && jobBranchId) {
          meta.from_branch = jobBranchId;
          meta.to_branch = jobBranchId;
        }
        if (actionType === "order") {
          meta.vendor_lead_time_hours = vendorLeadH;
        }

        planned.push({
          requirementId: req.id,
          actionType,
          nextLineStatus,
          fromBranch: actionType === "transfer" ? jobBranchId : null,
          toBranch: actionType === "transfer" ? jobBranchId : null,
          expectedDelivery,
          needByIso: effectiveNeedBy.toISOString(),
          vendorId: req.vendor_id ?? null,
          meta,
        });
        continue;
      }

      // Stock-first + cross-branch transfer scoring
      if (!jobBranchId) {
        const leadMs = vendorLeadH * 3600_000;
        const needBy = new Date(baseDate.getTime() - bufferHours * 3600_000 - leadMs);
        const effectiveNeedBy = isMachineDown
          ? new Date(Date.now() + 8 * 3600_000)
          : needBy;
        planned.push({
          requirementId: req.id,
          actionType: "order",
          nextLineStatus: "ordering",
          fromBranch: null,
          toBranch: null,
          expectedDelivery: new Date(effectiveNeedBy.getTime()),
          needByIso: effectiveNeedBy.toISOString(),
          vendorId: req.vendor_id ?? null,
          meta: {
            confidence: "high",
            planned_at: new Date().toISOString(),
            plan_batch_id: planBatchId,
            planner_rules: plannerRules,
            planner_mode: "stock_first",
            heuristic: "no_job_branch_vendor_order",
            inventory_assumption: "parts_inventory_branch_qty",
            vendor_lead_time_hours: vendorLeadH,
          },
        });
        continue;
      }

      const localAvail = stockByBranch.get(jobBranchId)?.get(pn) ?? 0;

      let bestRemote: { branch: string; leadH: number } | null = null;
      for (const [otherBranch, pmap] of stockByBranch) {
        if (otherBranch === jobBranchId) continue;
        const avail = pmap.get(pn) ?? 0;
        if (avail < needQty) continue;
        const leadH = getEdgeLead(edgeMap, otherBranch, jobBranchId, defaultTransferLead);
        if (!bestRemote || leadH < bestRemote.leadH) {
          bestRemote = { branch: otherBranch, leadH };
        }
      }

      const transferWins = isMachineDown && bestRemote !== null
        ? true
        : bestRemote !== null &&
          bestRemote.leadH <= vendorLeadH + transferVsOrderSlack;

      if (!isMachineDown && localAvail >= needQty) {
        takeStock(stockByBranch, jobBranchId, pn, needQty);
        const leadMs = 0;
        const needBy = new Date(baseDate.getTime() - bufferHours * 3600_000 - leadMs);
        const effectiveNeedByPick = isMachineDown
          ? new Date(Date.now() + 8 * 3600_000)
          : needBy;
        planned.push({
          requirementId: req.id,
          actionType: "pick",
          nextLineStatus: "picking",
          fromBranch: null,
          toBranch: null,
          expectedDelivery: null,
          needByIso: effectiveNeedByPick.toISOString(),
          vendorId: req.vendor_id ?? null,
          meta: {
            confidence: "high",
            planned_at: new Date().toISOString(),
            plan_batch_id: planBatchId,
            planner_rules: plannerRules,
            planner_mode: "stock_first",
            heuristic: "parts_inventory_stock_first_local_pick",
            inventory_assumption: "parts_inventory_branch_qty",
            scoring: {
              local_pick: true,
              machine_down: isMachineDown,
            },
          },
        });
        continue;
      }

      if (transferWins && bestRemote) {
        takeStock(stockByBranch, bestRemote.branch, pn, needQty);
        const leadMs = bestRemote.leadH * 3600_000;
        const needBy = new Date(baseDate.getTime() - bufferHours * 3600_000 - leadMs);
        const effectiveNeedByTx = isMachineDown
          ? new Date(Date.now() + 8 * 3600_000)
          : needBy;
        planned.push({
          requirementId: req.id,
          actionType: "transfer",
          nextLineStatus: "transferring",
          fromBranch: bestRemote.branch,
          toBranch: jobBranchId,
          expectedDelivery: effectiveNeedByTx,
          needByIso: effectiveNeedByTx.toISOString(),
          vendorId: req.vendor_id ?? null,
          meta: {
            confidence: "high",
            planned_at: new Date().toISOString(),
            plan_batch_id: planBatchId,
            planner_rules: plannerRules,
            planner_mode: "stock_first",
            heuristic: "parts_inventory_transfer_vs_order",
            inventory_assumption: "parts_inventory_branch_qty",
            transfer_lead_hours: bestRemote.leadH,
            vendor_lead_time_hours: vendorLeadH,
            scoring: {
              chosen: "transfer",
              machine_down: isMachineDown,
              slack_hours: transferVsOrderSlack,
            },
          },
        });
        continue;
      }

      {
        const leadMs = vendorLeadH * 3600_000;
        const needBy = new Date(baseDate.getTime() - bufferHours * 3600_000 - leadMs);
        const effectiveNeedByOrd = isMachineDown
          ? new Date(Date.now() + 8 * 3600_000)
          : needBy;
        planned.push({
          requirementId: req.id,
          actionType: "order",
          nextLineStatus: "ordering",
          fromBranch: null,
          toBranch: null,
          expectedDelivery: new Date(effectiveNeedByOrd.getTime()),
          needByIso: effectiveNeedByOrd.toISOString(),
          vendorId: req.vendor_id ?? null,
          meta: {
            confidence: "high",
            planned_at: new Date().toISOString(),
            plan_batch_id: planBatchId,
            planner_rules: plannerRules,
            planner_mode: "stock_first",
            heuristic: "parts_inventory_vendor_order",
            inventory_assumption: "parts_inventory_branch_qty",
            vendor_lead_time_hours: vendorLeadH,
            scoring: {
              chosen: "order",
              had_transfer_candidate: bestRemote !== null,
              machine_down: isMachineDown,
            },
          },
        });
      }
    }

    let trafficTicketId: string | null = null;
    const hasTransfer = planned.some((p) => p.actionType === "transfer");
    if (hasTransfer) {
      const first = planned.find((p) => p.actionType === "transfer");
      const fromLabel = first?.fromBranch ?? "unknown";
      const toLabel = first?.toBranch ?? jobBranchId ?? "unknown";
      const { data: ticket, error: tErr } = await supabase
        .from("traffic_tickets")
        .insert({
          workspace_id: job.workspace_id,
          stock_number: `PARTS-${planBatchId.replace(/-/g, "").slice(0, 10)}`,
          equipment_id: null,
          from_location: `Branch ${fromLabel}`,
          to_location: `Branch ${toLabel}`,
          to_contact_name: "Parts / Service",
          to_contact_phone: "—",
          shipping_date: new Date().toISOString().slice(0, 10),
          department: "Service",
          billing_comments:
            `Parts transfer plan ${planBatchId} for service job ${body.job_id}.`,
          ticket_type: "location_transfer",
          status: "haul_pending",
          requested_by: actorId,
          service_job_id: body.job_id,
        })
        .select("id")
        .single();

      if (tErr) {
        console.error("traffic ticket for parts transfer:", tErr);
        return safeJsonError(tErr.message, 400, origin);
      }
      trafficTicketId = ticket?.id ?? null;
    }

    const actionsToInsert: Record<string, unknown>[] = [];
    const requirementUpdates: { id: string; status: string; need_by_date: string | null }[] =
      [];

    for (const row of planned) {
      const meta = { ...row.meta };
      if (row.actionType === "transfer" && trafficTicketId) {
        meta.traffic_ticket_id = trafficTicketId;
      }
      if (row.actionType === "transfer" && row.fromBranch && row.toBranch) {
        meta.from_branch = row.fromBranch;
        meta.to_branch = row.toBranch;
      }

      actionsToInsert.push({
        workspace_id: job.workspace_id,
        requirement_id: row.requirementId,
        job_id: body.job_id,
        action_type: row.actionType,
        vendor_id: row.vendorId,
        from_branch: row.fromBranch,
        to_branch: row.toBranch,
        expected_date: row.expectedDelivery?.toISOString() ?? null,
        plan_batch_id: planBatchId,
        metadata: meta,
      });

      requirementUpdates.push({
        id: row.requirementId,
        status: row.nextLineStatus,
        need_by_date: row.needByIso,
      });
    }

    if (actionsToInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from("service_parts_actions")
        .insert(actionsToInsert);
      if (insertErr) {
        console.error("parts actions insert error:", insertErr);
        return safeJsonError(insertErr.message, 400, origin);
      }
      if (job.fulfillment_run_id) {
        await mirrorToFulfillmentRun(supabase, {
          jobId: body.job_id,
          workspaceId: job.workspace_id as string,
          eventType: "shop_parts_plan_batch",
          auditChannel: "shop",
          payload: {
            plan_batch_id: planBatchId,
            actions_created: actionsToInsert.length,
            is_machine_down: isMachineDown,
            traffic_ticket_id: trafficTicketId,
            transfer_count: planned.filter((p) => p.actionType === "transfer").length,
          },
        });
      }
    }

    for (const upd of requirementUpdates) {
      await supabase
        .from("service_parts_requirements")
        .update({
          status: upd.status,
          need_by_date: upd.need_by_date,
          intake_line_status: "planned",
        })
        .eq("id", upd.id);
    }

    return safeJsonOk({
      actions_created: actionsToInsert.length,
      requirements_updated: requirementUpdates.length,
      skipped_suggested_count: skippedSuggested,
      is_machine_down: isMachineDown,
      plan_batch_id: planBatchId,
      traffic_ticket_id: trafficTicketId,
      observability: {
        workspace_id: job.workspace_id,
        branch_id: jobBranchId,
        job_id: body.job_id,
        requirements_in_db: requirementsRaw?.length ?? 0,
        requirements_eligible: requirements.length,
      },
      metadata: {
        planner_mode: plannerHeuristicLegacy ? "legacy_line_index" : "stock_first",
        planner_rules: plannerRules,
        transfer_planned: hasTransfer,
        env: { PLANNER_HEURISTIC_MODE: plannerHeuristicLegacy ? "legacy" : "unset_or_off" },
      },
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "service-parts-planner", req });
    console.error("service-parts-planner error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
