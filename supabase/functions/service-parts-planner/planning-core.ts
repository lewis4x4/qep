export type ActionKind = "pick" | "transfer" | "order";

/**
 * Only requirements that are still in procurement may be planned. Received,
 * staged, consumed, returned, and cancelled lines are post-procurement facts;
 * re-opening one would create a second stock/vendor commitment for work that
 * has already advanced.
 */
export const PLANNABLE_REQUIREMENT_STATUSES = [
  "pending",
  "picking",
  "transferring",
  "ordering",
] as const;

export type PlannableRequirementStatus =
  (typeof PLANNABLE_REQUIREMENT_STATUSES)[number];

export function isPlannableRequirementStatus(
  value: unknown,
): value is PlannableRequirementStatus {
  return typeof value === "string" &&
    (PLANNABLE_REQUIREMENT_STATUSES as readonly string[]).includes(value);
}

export interface PlanningRequirement {
  id: string;
  partNumber: string;
  quantity: number;
  vendorId: string | null;
  unitCost: number;
}

export interface PlannedRow {
  requirementId: string;
  partNumber: string;
  quantity: number;
  unitCostCents: number;
  actionType: ActionKind;
  nextLineStatus: "picking" | "transferring" | "ordering";
  fromBranch: string | null;
  toBranch: string | null;
  expectedDelivery: Date | null;
  needByIso: string;
  vendorId: string | null;
  meta: Record<string, unknown>;
}

export interface PlanningInput {
  requirements: PlanningRequirement[];
  stockByBranch: Map<string, Map<string, number>>;
  edgeLeadHours: Map<string, number>;
  vendorLeadHours: Map<string, number>;
  jobBranchId: string | null;
  scheduledStartAt: string | null;
  haulRequired: boolean;
  isMachineDown: boolean;
  plannerRules: Record<string, unknown>;
  legacyMode: boolean;
  planBatchId: string;
  now: Date;
}

export interface ReconciliationRow {
  requirement_id: string;
  action_type: ActionKind;
  next_line_status: "picking" | "transferring" | "ordering";
  from_branch: string | null;
  to_branch: string | null;
  expected_date: string | null;
  need_by_date: string;
  vendor_id: string | null;
  part_number: string;
  quantity: number;
  unit_cost_cents: number;
  demand_key: string;
  demand_fingerprint: string;
  metadata: Record<string, unknown>;
}

export type DemandMutation = "create" | "reuse" | "replace" | "cancel";

export function finiteRuleHours(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 8760) return fallback;
  return n;
}

export function demandKeyForRequirement(requirementId: string): string {
  const normalized = requirementId.trim().toLowerCase();
  if (!normalized) throw new Error("requirement id is required");
  return `service-requirement:${normalized}`;
}

function normalizePartNumber(partNumber: string): string {
  return partNumber.trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeBranch(branch: string | null): string {
  return branch?.trim().toLowerCase() || "-";
}

/**
 * Stable identity for the vendor/shelf commitment represented by a requirement.
 * Dates and plan-batch IDs are intentionally absent: they are scheduling/audit
 * details, not a reason to buy or reserve the same part twice.
 */
export function demandFingerprint(input: {
  actionType: ActionKind;
  vendorId: string | null;
  partNumber: string;
  quantity: number;
  unitCostCents: number;
  fromBranch: string | null;
  toBranch: string | null;
}): string {
  const quantity = Math.max(1, Math.trunc(Number(input.quantity) || 1));
  const unitCostCents = Math.max(
    0,
    Math.trunc(Number(input.unitCostCents) || 0),
  );
  return [
    "v1",
    input.actionType,
    input.vendorId?.trim().toLowerCase() || "-",
    normalizePartNumber(input.partNumber),
    String(quantity),
    String(unitCostCents),
    normalizeBranch(input.fromBranch),
    normalizeBranch(input.toBranch),
  ].join("|");
}

export function decideDemandMutation(
  existing: { demandKey: string; demandFingerprint: string } | null,
  next: { demandKey: string; demandFingerprint: string } | null,
): DemandMutation {
  if (!existing) return next ? "create" : "reuse";
  if (!next) return "cancel";
  if (existing.demandKey !== next.demandKey) return "replace";
  return existing.demandFingerprint === next.demandFingerprint
    ? "reuse"
    : "replace";
}

function getEdgeLead(
  edgeMap: Map<string, number>,
  from: string,
  to: string,
  defaultHours: number,
): number {
  const forward = `${from}|${to}`;
  const reverse = `${to}|${from}`;
  if (edgeMap.has(forward)) return edgeMap.get(forward)!;
  if (edgeMap.has(reverse)) return edgeMap.get(reverse)!;
  return defaultHours;
}

function cloneStock(
  stockByBranch: Map<string, Map<string, number>>,
): Map<string, Map<string, number>> {
  return new Map(
    [...stockByBranch.entries()].map(([branch, parts]) => [
      branch,
      new Map(parts),
    ]),
  );
}

/**
 * parts_stock availability excludes every reservation. A job must add back
 * only its own active holds before re-planning, otherwise an unchanged pick
 * appears unavailable and flips into a duplicate vendor order.
 */
export function includeOwnedReservations(
  stockByBranch: Map<string, Map<string, number>>,
  reservations: Array<{
    requirementId: string;
    branchId: string;
    partNumber: string;
    quantity: number;
  }>,
  eligibleRequirementIds: ReadonlySet<string>,
): Map<string, Map<string, number>> {
  const effectiveStock = cloneStock(stockByBranch);
  for (const reservation of reservations) {
    if (!eligibleRequirementIds.has(reservation.requirementId)) continue;
    const branchId = reservation.branchId.trim();
    const partNumber = reservation.partNumber.trim();
    const quantity = Math.max(0, Math.trunc(Number(reservation.quantity) || 0));
    if (!branchId || !partNumber || quantity === 0) continue;
    if (!effectiveStock.has(branchId)) {
      effectiveStock.set(branchId, new Map());
    }
    const branchStock = effectiveStock.get(branchId)!;
    branchStock.set(
      partNumber,
      (branchStock.get(partNumber) ?? 0) + quantity,
    );
  }
  return effectiveStock;
}

function takeStock(
  byBranch: Map<string, Map<string, number>>,
  branch: string,
  part: string,
  qty: number,
): void {
  const stock = byBranch.get(branch);
  if (!stock) return;
  stock.set(part, Math.max(0, (stock.get(part) ?? 0) - qty));
}

function validDateOr(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

export function planServiceParts(input: PlanningInput): PlannedRow[] {
  const stockByBranch = cloneStock(input.stockByBranch);
  const defaultTransferLead = finiteRuleHours(
    input.plannerRules.transfer_default_lead_hours,
    8,
  );
  const transferVsOrderSlack = finiteRuleHours(
    input.plannerRules.transfer_vs_order_slack_hours,
    0,
  );
  const fallbackStart = new Date(input.now.getTime() + 48 * 3_600_000);
  const baseDate = validDateOr(input.scheduledStartAt, fallbackStart);
  const bufferHours = 4 + (input.haulRequired ? 24 : 0);
  const planned: PlannedRow[] = [];

  for (let index = 0; index < input.requirements.length; index++) {
    const requirement = input.requirements[index];
    const partNumber = requirement.partNumber.trim();
    const quantity = Math.max(
      1,
      Math.trunc(Number(requirement.quantity) || 1),
    );
    const unitCostCents = Math.max(
      0,
      Math.round((Number(requirement.unitCost) || 0) * 100),
    );
    const vendorLeadHours = requirement.vendorId
      ? (input.vendorLeadHours.get(requirement.vendorId) ?? 48)
      : 48;

    const makeRow = (
      actionType: ActionKind,
      fromBranch: string | null,
      toBranch: string | null,
      leadHours: number,
      meta: Record<string, unknown>,
    ): PlannedRow => {
      const calculatedNeedBy = new Date(
        baseDate.getTime() - (bufferHours + leadHours) * 3_600_000,
      );
      const effectiveNeedBy = input.isMachineDown
        ? new Date(input.now.getTime() + 8 * 3_600_000)
        : calculatedNeedBy;
      return {
        requirementId: requirement.id,
        partNumber,
        quantity,
        unitCostCents,
        actionType,
        nextLineStatus: actionType === "pick"
          ? "picking"
          : actionType === "transfer"
          ? "transferring"
          : "ordering",
        fromBranch,
        toBranch,
        expectedDelivery: actionType === "pick" ? null : effectiveNeedBy,
        needByIso: effectiveNeedBy.toISOString(),
        vendorId: requirement.vendorId,
        meta: {
          confidence: input.legacyMode ? "medium" : "high",
          planned_at: input.now.toISOString(),
          plan_batch_id: input.planBatchId,
          planner_rules: input.plannerRules,
          ...meta,
        },
      };
    };

    if (input.legacyMode) {
      let actionType: ActionKind = "order";
      if (!input.isMachineDown && input.jobBranchId && index === 0) {
        actionType = "pick";
      } else if (
        !input.isMachineDown && input.jobBranchId && index === 1
      ) {
        actionType = "transfer";
      }
      const branch = actionType === "transfer" ? input.jobBranchId : null;
      planned.push(makeRow(
        actionType,
        branch,
        branch,
        actionType === "order" ? vendorLeadHours : 0,
        {
          planner_mode: "legacy_line_index",
          heuristic: "branch_first_pick_then_transfer_then_order",
          inventory_assumption: "legacy_heuristic_no_inventory",
          ...(actionType === "order"
            ? { vendor_lead_time_hours: vendorLeadHours }
            : {}),
        },
      ));
      continue;
    }

    if (!input.jobBranchId) {
      planned.push(makeRow("order", null, null, vendorLeadHours, {
        planner_mode: "stock_first",
        heuristic: "no_job_branch_vendor_order",
        inventory_assumption: "parts_stock_branch_available",
        vendor_lead_time_hours: vendorLeadHours,
      }));
      continue;
    }

    const localAvailable = stockByBranch.get(input.jobBranchId)?.get(
      partNumber,
    ) ?? 0;
    let bestRemote: { branch: string; leadHours: number } | null = null;
    for (const [otherBranch, parts] of stockByBranch) {
      if (otherBranch === input.jobBranchId) continue;
      if ((parts.get(partNumber) ?? 0) < quantity) continue;
      const leadHours = getEdgeLead(
        input.edgeLeadHours,
        otherBranch,
        input.jobBranchId,
        defaultTransferLead,
      );
      if (!bestRemote || leadHours < bestRemote.leadHours) {
        bestRemote = { branch: otherBranch, leadHours };
      }
    }

    if (!input.isMachineDown && localAvailable >= quantity) {
      takeStock(stockByBranch, input.jobBranchId, partNumber, quantity);
      planned.push(makeRow("pick", null, null, 0, {
        planner_mode: "stock_first",
        heuristic: "parts_stock_local_pick",
        inventory_assumption: "parts_stock_branch_available",
        scoring: { local_pick: true, machine_down: false },
      }));
      continue;
    }

    const transferWins = bestRemote !== null && (
      input.isMachineDown ||
      bestRemote.leadHours <= vendorLeadHours + transferVsOrderSlack
    );
    if (transferWins && bestRemote) {
      takeStock(stockByBranch, bestRemote.branch, partNumber, quantity);
      planned.push(makeRow(
        "transfer",
        bestRemote.branch,
        input.jobBranchId,
        bestRemote.leadHours,
        {
          planner_mode: "stock_first",
          heuristic: "parts_stock_transfer_vs_order",
          inventory_assumption: "parts_stock_branch_available",
          transfer_lead_hours: bestRemote.leadHours,
          vendor_lead_time_hours: vendorLeadHours,
          scoring: {
            chosen: "transfer",
            machine_down: input.isMachineDown,
            slack_hours: transferVsOrderSlack,
          },
        },
      ));
      continue;
    }

    planned.push(makeRow("order", null, null, vendorLeadHours, {
      planner_mode: "stock_first",
      heuristic: "parts_stock_vendor_order",
      inventory_assumption: "parts_stock_branch_available",
      vendor_lead_time_hours: vendorLeadHours,
      scoring: {
        chosen: "order",
        had_transfer_candidate: bestRemote !== null,
        machine_down: input.isMachineDown,
      },
    }));
  }

  return planned;
}

export function toReconciliationRows(
  planned: PlannedRow[],
): ReconciliationRow[] {
  const seen = new Set<string>();
  return planned.map((row) => {
    if (seen.has(row.requirementId)) {
      throw new Error(`duplicate requirement in plan: ${row.requirementId}`);
    }
    seen.add(row.requirementId);
    const demandKey = demandKeyForRequirement(row.requirementId);
    const fingerprint = demandFingerprint({
      actionType: row.actionType,
      vendorId: row.vendorId,
      partNumber: row.partNumber,
      quantity: row.quantity,
      unitCostCents: row.unitCostCents,
      fromBranch: row.fromBranch,
      toBranch: row.toBranch,
    });
    return {
      requirement_id: row.requirementId,
      action_type: row.actionType,
      next_line_status: row.nextLineStatus,
      from_branch: row.fromBranch,
      to_branch: row.toBranch,
      expected_date: row.expectedDelivery?.toISOString() ?? null,
      need_by_date: row.needByIso,
      vendor_id: row.vendorId,
      part_number: row.partNumber,
      quantity: row.quantity,
      unit_cost_cents: row.unitCostCents,
      demand_key: demandKey,
      demand_fingerprint: fingerprint,
      metadata: {
        ...row.meta,
        service_demand_key: demandKey,
        demand_fingerprint: fingerprint,
      },
    };
  });
}
