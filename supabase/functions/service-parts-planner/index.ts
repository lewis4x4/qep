/**
 * Service Parts Planner — pick / transfer / order with branch-network scoring (P0-A).
 * Creates a Traffic ticket when any transfer is planned (location_transfer).
 *
 * Auth: user JWT only
 */
import {
  requireServiceUser,
  SERVICE_PARTS_ROLES,
} from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { mirrorToFulfillmentRun } from "../_shared/parts-fulfillment-mirror.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  finiteRuleHours,
  includeOwnedReservations,
  isPlannableRequirementStatus,
  planServiceParts,
  toReconciliationRows,
} from "./planning-core.ts";

interface PlanRequest {
  job_id: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
      SERVICE_PARTS_ROLES,
    );
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
      .eq("workspace_id", auth.workspaceId)
      .single();

    if (jobErr || !job) return safeJsonError("Job not found", 404, origin);

    const jobBranchId = job.branch_id ? String(job.branch_id) : null;

    const { data: requirementsRaw, error: requirementsError } = await supabase
      .from("service_parts_requirements")
      .select("*")
      .eq("job_id", body.job_id)
      .eq("workspace_id", job.workspace_id);

    if (requirementsError) {
      console.error("service parts requirements:", requirementsError.message);
      return safeJsonError("Unable to load parts requirements", 400, origin);
    }

    const skippedSuggested = (requirementsRaw ?? []).filter(
      (r: { intake_line_status?: string | null; status?: string | null }) =>
        (r.intake_line_status ?? "accepted") === "suggested" &&
        isPlannableRequirementStatus(r.status ?? "pending"),
    ).length;

    const skippedPostProcurement = (requirementsRaw ?? []).filter(
      (r: { status?: string | null }) =>
        !isPlannableRequirementStatus(r.status ?? "pending"),
    ).length;

    const requirements = (requirementsRaw ?? []).filter(
      (r: { intake_line_status?: string | null; status?: string | null }) =>
        isPlannableRequirementStatus(r.status ?? "pending") &&
        (r.intake_line_status ?? "accepted") !== "suggested",
    );

    const noEligibleMessage = (requirementsRaw ?? []).length === 0
      ? "No parts requirements to plan"
      : requirements.length === 0 && skippedSuggested > 0
      ? "All active procurement lines are suggested — accept lines before planning"
      : requirements.length === 0
      ? "All parts requirements are already received, staged, consumed, returned, or cancelled"
      : null;

    const planBatchId = crypto.randomUUID();
    const plannedAt = new Date();

    const vendorIds = [
      ...new Set(
        requirements.map((r: { vendor_id?: string | null }) => r.vendor_id)
          .filter(Boolean),
      ),
    ] as string[];
    const { data: vendorRows, error: vendorError } = vendorIds.length > 0
      ? await supabase
        .from("vendor_profiles")
        .select("id, avg_lead_time_hours")
        .eq("workspace_id", job.workspace_id)
        .in("id", vendorIds)
      : {
        data: [] as { id: string; avg_lead_time_hours: number | null }[],
        error: null,
      };
    if (vendorError) {
      console.error("service parts vendors:", vendorError.message);
      return safeJsonError("Unable to load parts vendors", 400, origin);
    }
    const vendorLead = new Map(
      (vendorRows ?? []).map((
        v,
      ) => [v.id, Number(v.avg_lead_time_hours ?? 48)]),
    );

    const isMachineDown = Array.isArray(job.status_flags) &&
      job.status_flags.includes("machine_down");

    const plannerHeuristicLegacy =
      Deno.env.get("PLANNER_HEURISTIC_MODE") === "legacy";

    let plannerRules: Record<string, unknown> = {};
    if (jobBranchId) {
      const { data: cfg, error: configError } = await supabase
        .from("service_branch_config")
        .select("planner_rules")
        .eq("workspace_id", job.workspace_id)
        .eq("branch_id", jobBranchId)
        .maybeSingle();
      if (configError) {
        console.error("service planner config:", configError.message);
        return safeJsonError("Unable to load planner rules", 400, origin);
      }
      const raw = cfg?.planner_rules;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        plannerRules = raw as Record<string, unknown>;
      }
    }

    const defaultTransferLead = finiteRuleHours(
      plannerRules.transfer_default_lead_hours,
      8,
    );

    const partNumbers = [
      ...new Set(
        requirements.map((r: { part_number: string }) =>
          String(r.part_number ?? "").trim()
        ),
      ),
    ].filter(Boolean);

    const edgeMap = new Map<string, number>();
    const { data: edgeRows, error: edgeError } = await supabase
      .from("branch_transfer_edges")
      .select("from_branch, to_branch, lead_time_hours")
      .eq("workspace_id", job.workspace_id)
      .eq("active", true);
    if (edgeError) {
      console.error("service transfer edges:", edgeError.message);
      return safeJsonError("Unable to load transfer routes", 400, origin);
    }

    for (const e of edgeRows ?? []) {
      const f = String(e.from_branch ?? "").trim();
      const t = String(e.to_branch ?? "").trim();
      if (!f || !t) continue;
      edgeMap.set(
        `${f}|${t}`,
        Number(e.lead_time_hours ?? defaultTransferLead),
      );
    }

    /** branch_id -> part -> qty (N3.1: canonical parts_stock ledger,
     * availability = on_hand − reserved; keyed by every branch handle the
     * location carries so pick/transfer logic keeps matching job branch ids). */
    const stockByBranch = new Map<string, Map<string, number>>();
    if (partNumbers.length > 0) {
      const { data: stockRows, error: stockError } = await supabase
        .from("parts_stock")
        .select(
          "qty_on_hand, qty_reserved, branch_slug, parts:part_id(part_number), parts_locations:location_id(branch_id, branch_slug)",
        )
        .eq("workspace_id", job.workspace_id)
        .is("deleted_at", null);
      if (stockError) {
        console.error("service parts stock:", stockError.message);
        return safeJsonError("Unable to load parts availability", 400, origin);
      }

      for (const row of (stockRows ?? []) as Array<Record<string, unknown>>) {
        const part = Array.isArray(row.parts) ? row.parts[0] : row.parts;
        const pn = String(
          (part as { part_number?: string } | null)?.part_number ?? "",
        ).trim();
        if (!pn || !partNumbers.includes(pn)) continue;
        const location = Array.isArray(row.parts_locations)
          ? row.parts_locations[0]
          : row.parts_locations;
        const available = Math.max(
          0,
          Number(row.qty_on_hand ?? 0) - Number(row.qty_reserved ?? 0),
        );
        const handles = [
          String((location as { branch_id?: string } | null)?.branch_id ?? "")
            .trim(),
          String(
            row.branch_slug ??
              (location as { branch_slug?: string } | null)?.branch_slug ?? "",
          ).trim(),
        ].filter((handle) => handle.length > 0);
        for (const bid of new Set(handles)) {
          if (!stockByBranch.has(bid)) stockByBranch.set(bid, new Map());
          const m = stockByBranch.get(bid)!;
          m.set(pn, (m.get(pn) ?? 0) + available);
        }
      }
    }

    const planningRequirements =
      (requirements as Array<Record<string, unknown>>)
        .map((requirement) => ({
          id: String(requirement.id),
          partNumber: String(requirement.part_number ?? "").trim(),
          quantity: Math.max(1, Math.trunc(Number(requirement.quantity ?? 1))),
          vendorId: requirement.vendor_id
            ? String(requirement.vendor_id)
            : null,
          unitCost: Number(requirement.unit_cost ?? 0),
        }));

    const { data: ownedReservationsRaw, error: ownedReservationsError } =
      await supabase
        .from("service_parts_reservations")
        .select("requirement_id, branch_id, part_number, quantity")
        .eq("workspace_id", job.workspace_id)
        .eq("job_id", body.job_id)
        .eq("status", "active");
    if (ownedReservationsError) {
      console.error(
        "service parts reservations:",
        ownedReservationsError.message,
      );
      return safeJsonError("Unable to load existing parts holds", 400, origin);
    }
    const eligibleRequirementIds = new Set(
      planningRequirements.map((requirement) => requirement.id),
    );
    const planningStock = includeOwnedReservations(
      stockByBranch,
      (ownedReservationsRaw ?? []).map((reservation) => ({
        requirementId: String(reservation.requirement_id),
        branchId: String(reservation.branch_id ?? ""),
        partNumber: String(reservation.part_number ?? ""),
        quantity: Number(reservation.quantity ?? 0),
      })),
      eligibleRequirementIds,
    );

    const planned = planServiceParts({
      requirements: planningRequirements,
      stockByBranch: planningStock,
      edgeLeadHours: edgeMap,
      vendorLeadHours: vendorLead,
      jobBranchId,
      scheduledStartAt: job.scheduled_start_at
        ? String(job.scheduled_start_at)
        : null,
      haulRequired: job.haul_required === true,
      isMachineDown,
      plannerRules,
      legacyMode: plannerHeuristicLegacy,
      planBatchId,
      now: plannedAt,
    });

    const hasTransfer = planned.some((row) => row.actionType === "transfer");
    const reconciliationRows = toReconciliationRows(planned);
    const { data: reconciliationRaw, error: reconciliationError } =
      await supabase.rpc("reconcile_service_parts_plan", {
        p_workspace_id: String(job.workspace_id),
        p_job_id: body.job_id,
        p_actor_id: actorId,
        p_plan_batch_id: planBatchId,
        p_plan: reconciliationRows,
      });

    if (reconciliationError) {
      console.error(
        "reconcile_service_parts_plan:",
        reconciliationError.message,
      );
      const conflictMessage = reconciliationError.message ?? "";
      const isReservationConflict = conflictMessage.includes(
        "SERVICE_PART_RESERVATION_UNAVAILABLE",
      );
      const isReceivedConflict = conflictMessage.includes(
        "SERVICE_PART_DEMAND_ALREADY_RECEIVED",
      );
      const isActiveDemandConflict = conflictMessage.includes(
        "SERVICE_PART_ACTIVE_DEMAND_CONFLICT",
      );
      const isConflict = isReservationConflict || isReceivedConflict ||
        isActiveDemandConflict;
      return safeJsonError(
        isReservationConflict
          ? "Parts availability changed while planning; run the planner again"
          : isReceivedConflict
          ? "Received vendor demand cannot be replaced automatically"
          : isActiveDemandConflict
          ? "Another planner call changed this job; run the planner again"
          : "Unable to reconcile service parts plan",
        isConflict ? 409 : 400,
        origin,
      );
    }

    const reconciliation = reconciliationRaw &&
        typeof reconciliationRaw === "object" &&
        !Array.isArray(reconciliationRaw)
      ? reconciliationRaw as Record<string, unknown>
      : {};
    const actionsCreated = Number(reconciliation.actions_created ?? 0);
    const actionsReused = Number(reconciliation.actions_reused ?? 0);
    const actionsSuperseded = Number(
      reconciliation.actions_superseded ?? 0,
    );
    const trafficTicketId = typeof reconciliation.traffic_ticket_id === "string"
      ? reconciliation.traffic_ticket_id
      : null;

    if (
      job.fulfillment_run_id &&
      (actionsCreated > 0 || actionsSuperseded > 0)
    ) {
      await mirrorToFulfillmentRun(supabase, {
        jobId: body.job_id,
        workspaceId: job.workspace_id as string,
        eventType: "shop_parts_plan_batch",
        auditChannel: "shop",
        payload: {
          plan_batch_id: planBatchId,
          actions_created: actionsCreated,
          actions_reused: actionsReused,
          actions_superseded: actionsSuperseded,
          is_machine_down: isMachineDown,
          traffic_ticket_id: trafficTicketId,
          transfer_count: planned.filter((row) =>
            row.actionType === "transfer"
          ).length,
        },
      });
    }

    return safeJsonOk({
      ...(noEligibleMessage ? { message: noEligibleMessage } : {}),
      actions_created: actionsCreated,
      actions_reused: actionsReused,
      actions_superseded: actionsSuperseded,
      idempotent_replay: actionsCreated === 0 && actionsReused > 0 &&
        actionsSuperseded === 0,
      purchase_orders_created: Number(
        reconciliation.purchase_orders_created ?? 0,
      ),
      purchase_order_lines_created: Number(
        reconciliation.purchase_order_lines_created ?? 0,
      ),
      reservations_created: Number(
        reconciliation.reservations_created ?? 0,
      ),
      reservations_released: Number(
        reconciliation.reservations_released ?? 0,
      ),
      requirements_updated: Number(
        reconciliation.requirements_updated ?? planned.length,
      ),
      skipped_suggested_count: skippedSuggested,
      skipped_post_procurement_count: skippedPostProcurement,
      is_machine_down: isMachineDown,
      plan_batch_id: planBatchId,
      traffic_ticket_id: trafficTicketId,
      observability: {
        workspace_id: job.workspace_id,
        branch_id: jobBranchId,
        job_id: body.job_id,
        requirements_in_db: requirementsRaw?.length ?? 0,
        requirements_eligible: requirements.length,
        requirements_post_procurement: skippedPostProcurement,
      },
      metadata: {
        planner_mode: plannerHeuristicLegacy
          ? "legacy_line_index"
          : "stock_first",
        planner_rules: plannerRules,
        transfer_planned: hasTransfer,
        env: {
          PLANNER_HEURISTIC_MODE: plannerHeuristicLegacy
            ? "legacy"
            : "unset_or_off",
        },
      },
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "service-parts-planner", req });
    console.error("service-parts-planner error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("Origin"),
    );
  }
});
