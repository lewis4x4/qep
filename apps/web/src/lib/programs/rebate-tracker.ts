/**
 * QEP Program Engine — Rebate Deadline Tracker (Slice 03)
 *
 * getUpcomingRebateDeadlines() queries qb_deals for deals where:
 *   - rebate_filing_due_date is not null (warranty has been registered)
 *   - rebate_filed_at is null (hasn't been filed yet)
 *   - rebate_filing_due_date <= now() + daysAhead (within the alert window)
 *
 * The rebate_filing_due_date is auto-computed by the qb_compute_rebate_due_date
 * trigger in migration 286 (warranty_registration_date + 45 days).
 *
 * Urgency levels:
 *   green   — 14+ days remaining
 *   yellow  — 7–13 days remaining
 *   red     — 1–6 days remaining
 *   overdue — 0 or fewer days (missed the deadline)
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types.ts";
import type { RebateDeadline } from "./types.ts";

interface GetDeadlinesParams {
  /** How many days ahead to look. Default 30. */
  daysAhead?: number;
  /** If provided, filters to deals owned by this salesman_id. */
  assignedToUserId?: string;
}

export async function getUpcomingRebateDeadlines(
  params: GetDeadlinesParams,
  supabase: ReturnType<typeof createClient<Database>>,
): Promise<RebateDeadline[]> {
  const daysAhead = params.daysAhead ?? 30;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + daysAhead);
  const cutoffIso = cutoffDate.toISOString().split("T")[0];
  const todayIso  = new Date().toISOString().split("T")[0];

  // Fetch deals within the window (include overdue — past due_date but unfiled)
  let query = supabase
    .from("qb_deals")
    .select(
      `
      id,
      deal_number,
      salesman_id,
      applied_program_ids,
      warranty_registration_date,
      rebate_filing_due_date,
      total_revenue_cents,
      company:company_id (id, name),
      salesman:salesman_id (id, raw_user_meta_data)
      `,
    )
    .is("rebate_filed_at", null)
    .not("rebate_filing_due_date", "is", null)
    .lte("rebate_filing_due_date", cutoffIso);

  if (params.assignedToUserId) {
    query = query.eq("salesman_id", params.assignedToUserId);
  }

  const { data: deals, error } = await query;

  if (error) {
    throw new Error(`Failed to load rebate deadlines: ${error.message}`);
  }

  const today = new Date(todayIso);
  const results: RebateDeadline[] = [];

  for (const deal of deals ?? []) {
    const dueDate = new Date(deal.rebate_filing_due_date as string);
    const diffMs = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let urgency: RebateDeadline["urgency"];
    if (daysRemaining <= 0)       urgency = "overdue";
    else if (daysRemaining <= 6)  urgency = "red";
    else if (daysRemaining <= 13) urgency = "yellow";
    else                          urgency = "green";

    // Program details — we resolve names from applied_program_ids if present
    // For now we surface the program IDs; the edge function enriches with names.
    const programIds: string[] = (deal.applied_program_ids as string[] | null) ?? [];

    // Company and salesman names from joins
    const companyAny = deal.company as any;
    const salesmanAny = deal.salesman as any;
    const companyName  = companyAny?.name ?? "Unknown Company";
    const salesmanName = salesmanAny?.raw_user_meta_data?.full_name
      ?? salesmanAny?.raw_user_meta_data?.name
      ?? "Unknown Rep";

    results.push({
      dealId: deal.id,
      dealNumber: deal.deal_number,
      companyName,
      salesmanName,
      programs: programIds.map((id) => ({
        name: id, // edge function will resolve IDs to names
        programType: "unknown",
        programCode: id,
      })),
      warrantyRegistrationDate: deal.warranty_registration_date as string,
      filingDueDate: deal.rebate_filing_due_date as string,
      daysRemaining,
      urgency,
      totalRebateAmountCents: 0, // enriched by edge function from program details
    });
  }

  // Sort: overdue first, then by days remaining ascending
  results.sort((a, b) => {
    if (a.urgency === "overdue" && b.urgency !== "overdue") return -1;
    if (b.urgency === "overdue" && a.urgency !== "overdue") return 1;
    return a.daysRemaining - b.daysRemaining;
  });

  return results;
}

/**
 * Enriches a RebateDeadline list with program names and rebate amounts
 * by fetching the qb_programs rows for all applied_program_ids in the batch.
 */
export async function enrichWithProgramDetails(
  deadlines: RebateDeadline[],
  supabase: ReturnType<typeof createClient<Database>>,
): Promise<RebateDeadline[]> {
  // Collect all unique program IDs (currently stored as UUIDs in programs[].name)
  const allIds = [...new Set(deadlines.flatMap((d) => d.programs.map((p) => p.name)))].filter(
    (id) => id.length === 36, // basic UUID format check
  );

  if (allIds.length === 0) return deadlines;

  const { data: programRows } = await supabase
    .from("qb_programs")
    .select("id, name, program_type, program_code, details")
    .in("id", allIds);

  const programMap = new Map(
    (programRows ?? []).map((p) => [p.id, p]),
  );

  return deadlines.map((d) => {
    const enrichedPrograms = d.programs.map((p) => {
      const row = programMap.get(p.name);
      if (!row) return p;

      // Estimate rebate amount from the program details
      // CIL and aged_inventory have per-model rebate arrays; sum them for a total
      let totalCents = 0;
      const details = row.details as any;
      if (details?.rebates && Array.isArray(details.rebates)) {
        totalCents = details.rebates.reduce(
          (sum: number, r: { amount_cents: number }) => sum + (r.amount_cents ?? 0),
          0,
        );
      }

      return {
        name: row.name,
        programType: row.program_type,
        programCode: row.program_code,
        _estimatedTotalCents: totalCents,
      };
    });

    const totalRebateAmountCents = enrichedPrograms.reduce(
      (sum: number, p: any) => sum + (p._estimatedTotalCents ?? 0),
      0,
    );

    return {
      ...d,
      programs: enrichedPrograms.map((p) => ({
        name: p.name,
        programType: p.programType,
        programCode: p.programCode,
      })),
      totalRebateAmountCents,
    };
  });
}
