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

import type { RebateDeadline } from "./types.ts";

/** Minimal duck-type for a Supabase client — avoids a bare npm import in Deno. */
interface SupabaseLike {
  from: <Row>(table: string) => SupabaseQueryBuilder<Row>;
}

interface SupabaseQueryResult<Data> {
  data: Data | null;
  error: { message: string } | null;
}

interface SupabaseQueryBuilder<Row> extends PromiseLike<SupabaseQueryResult<Row[]>> {
  select(columns: string): SupabaseQueryBuilder<Row>;
  is(column: string, value: unknown): SupabaseQueryBuilder<Row>;
  not(column: string, operator: string, value: unknown): SupabaseQueryBuilder<Row>;
  lte(column: string, value: unknown): SupabaseQueryBuilder<Row>;
  eq(column: string, value: unknown): SupabaseQueryBuilder<Row>;
  in(column: string, values: readonly unknown[]): SupabaseQueryBuilder<Row>;
}

interface CompanyJoin {
  id: string;
  name: string | null;
}

interface SalesmanJoin {
  id: string;
  raw_user_meta_data: Record<string, unknown> | null;
}

interface DealRow {
  id: string;
  deal_number: string;
  workspace_id: string | null;
  salesman_id: string | null;
  applied_program_ids: unknown;
  warranty_registration_date: string;
  rebate_filing_due_date: string;
  total_revenue_cents: number | null;
  company: CompanyJoin | CompanyJoin[] | null;
  salesman: SalesmanJoin | SalesmanJoin[] | null;
}

interface ProgramDetailsRow {
  id: string;
  name: string;
  program_type: string;
  program_code: string;
  details: Record<string, unknown>;
}

interface RebateDetail {
  amount_cents?: number;
}

type EnrichedDeadlineProgram = RebateDeadline["programs"][number] & {
  _estimatedTotalCents?: number;
};

function firstJoin<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function joinedSalesmanName(salesman: SalesmanJoin | null): string {
  const fullName = salesman?.raw_user_meta_data?.full_name;
  if (typeof fullName === "string" && fullName.length > 0) return fullName;

  const name = salesman?.raw_user_meta_data?.name;
  return typeof name === "string" && name.length > 0 ? name : "Unknown Rep";
}

function isRebateDetail(value: unknown): value is RebateDetail {
  if (typeof value !== "object" || value === null) return false;
  const amountCents = (value as Record<string, unknown>).amount_cents;
  return amountCents === undefined || typeof amountCents === "number";
}

function rebateTotalCents(details: Record<string, unknown>): number {
  const rebates = details.rebates;
  if (!Array.isArray(rebates)) return 0;

  return rebates
    .filter(isRebateDetail)
    .reduce((sum, rebate) => sum + (rebate.amount_cents ?? 0), 0);
}

interface GetDeadlinesParams {
  /** How many days ahead to look. Default 30. */
  daysAhead?: number;
  /** If provided, filters to deals owned by this salesman_id. */
  assignedToUserId?: string;
}

export async function getUpcomingRebateDeadlines(
  params: GetDeadlinesParams,
  supabase: SupabaseLike,
): Promise<RebateDeadline[]> {
  const daysAhead = params.daysAhead ?? 30;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + daysAhead);
  const cutoffIso = cutoffDate.toISOString().split("T")[0];
  const todayIso  = new Date().toISOString().split("T")[0];

  // Fetch deals within the window (include overdue — past due_date but unfiled)
  // workspace_id is required so the cron can scope fan-out to the owning tenant.
  let query = supabase
    .from<DealRow>("qb_deals")
    .select(
      `
      id,
      deal_number,
      workspace_id,
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
    const dueDate = new Date(deal.rebate_filing_due_date);
    const diffMs = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let urgency: RebateDeadline["urgency"];
    if (daysRemaining <= 0)       urgency = "overdue";
    else if (daysRemaining <= 6)  urgency = "red";
    else if (daysRemaining <= 13) urgency = "yellow";
    else                          urgency = "green";

    // Program details — we resolve names from applied_program_ids if present
    // For now we surface the program IDs; the edge function enriches with names.
    const programIds = isStringArray(deal.applied_program_ids) ? deal.applied_program_ids : [];

    // Company and salesman names from joins
    const company = firstJoin(deal.company);
    const salesman = firstJoin(deal.salesman);
    const companyName  = company?.name ?? "Unknown Company";
    const salesmanName = joinedSalesmanName(salesman);

    results.push({
      dealId: deal.id,
      dealNumber: deal.deal_number,
      workspaceId: deal.workspace_id ?? "default",
      companyName,
      salesmanName,
      programs: programIds.map((id) => ({
        name: id, // edge function will resolve IDs to names
        programType: "unknown",
        programCode: id,
      })),
      warrantyRegistrationDate: deal.warranty_registration_date,
      filingDueDate: deal.rebate_filing_due_date,
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
  supabase: SupabaseLike,
): Promise<RebateDeadline[]> {
  // Collect all unique program IDs (currently stored as UUIDs in programs[].name)
  const allIds = [...new Set(deadlines.flatMap((d) => d.programs.map((p) => p.name)))].filter(
    (id) => id.length === 36, // basic UUID format check
  );

  if (allIds.length === 0) return deadlines;

  const { data: programRows } = await supabase
    .from<ProgramDetailsRow>("qb_programs")
    .select("id, name, program_type, program_code, details")
    .in("id", allIds);

  const programMap = new Map(
    (programRows ?? []).map((p): [string, ProgramDetailsRow] => [p.id, p]),
  );

  return deadlines.map((d) => {
    const enrichedPrograms: EnrichedDeadlineProgram[] = d.programs.map((p) => {
      const row = programMap.get(p.name);
      if (!row) return p;

      // Estimate rebate amount from the program details
      // CIL and aged_inventory have per-model rebate arrays; sum them for a total
      const totalCents = rebateTotalCents(row.details);

      return {
        name: row.name,
        programType: row.program_type,
        programCode: row.program_code,
        _estimatedTotalCents: totalCents,
      };
    });

    const totalRebateAmountCents = enrichedPrograms.reduce(
      (sum, p) => sum + (p._estimatedTotalCents ?? 0),
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
