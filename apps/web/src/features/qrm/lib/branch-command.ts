export interface BranchTrafficRow {
  id: string;
  ticket_type: string;
  status: string;
  from_location: string;
  to_location: string;
}

export interface BranchIntakeRow {
  id: string;
  current_stage: number;
  pdi_completed: boolean | null;
  photo_ready: boolean | null;
  ship_to_branch: string | null;
}

export interface BranchServiceJobRow {
  id: string;
  customer_id: string | null;
  current_stage: string;
  invoice_total: number | null;
}

export interface BranchInvoiceRow {
  id: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  status: string;
}

export interface BranchOpenDealRow {
  id: string;
  company_id: string | null;
  name: string;
  amount: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function normalizeBranchTrafficRows(rows: unknown): BranchTrafficRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      ticket_type: requiredString(row.ticket_type, "unknown"),
      status: requiredString(row.status, "unknown"),
      from_location: requiredString(row.from_location, ""),
      to_location: requiredString(row.to_location, ""),
    }];
  });
}

export function normalizeBranchIntakeRows(rows: unknown): BranchIntakeRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      current_stage: requiredNumber(row.current_stage, 0),
      pdi_completed: nullableBoolean(row.pdi_completed),
      photo_ready: nullableBoolean(row.photo_ready),
      ship_to_branch: nullableString(row.ship_to_branch),
    }];
  });
}

export function normalizeBranchServiceJobRows(rows: unknown): BranchServiceJobRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      customer_id: nullableString(row.customer_id),
      current_stage: requiredString(row.current_stage, "unknown"),
      invoice_total: nullableNumber(row.invoice_total),
    }];
  });
}

export function normalizeBranchInvoiceRows(rows: unknown): BranchInvoiceRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      total: requiredNumber(row.total, 0),
      amount_paid: requiredNumber(row.amount_paid, 0),
      balance_due: requiredNumber(row.balance_due, 0),
      status: requiredString(row.status, "unknown"),
    }];
  });
}

export function normalizeBranchOpenDealRows(rows: unknown): BranchOpenDealRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      company_id: nullableString(row.company_id),
      name: requiredString(row.name, "Unnamed deal"),
      amount: nullableNumber(row.amount),
    }];
  });
}

export interface BranchCommandSummary {
  logisticsOpen: number;
  rentalMoves: number;
  readinessBlocked: number;
  readinessInPrep: number;
  activeServiceJobs: number;
  serviceInvoiceValue: number;
  branchRevenue: number;
  openArBalance: number;
  serviceLinkedSalesCount: number;
  serviceLinkedSalesValue: number;
}

function matchesBranchLabel(value: string | null | undefined, labels: string[]): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return labels.some((label) => normalized.includes(label));
}

export function branchLabelCandidates(slug: string, displayName: string): string[] {
  return [...new Set([slug.trim().toLowerCase(), displayName.trim().toLowerCase()].filter(Boolean))];
}

export function summarizeBranchCommand(input: {
  slug: string;
  displayName: string;
  trafficTickets: BranchTrafficRow[];
  intake: BranchIntakeRow[];
  serviceJobs: BranchServiceJobRow[];
  invoices: BranchInvoiceRow[];
  openDeals: BranchOpenDealRow[];
}): BranchCommandSummary {
  const labels = branchLabelCandidates(input.slug, input.displayName);

  const logisticsTickets = input.trafficTickets.filter(
    (row) =>
      row.status !== "completed" &&
      (matchesBranchLabel(row.from_location, labels) || matchesBranchLabel(row.to_location, labels)),
  );

  const rentalMoves = logisticsTickets.filter((row) => row.ticket_type === "rental" || row.ticket_type === "re_rent");

  const intakeRows = input.intake.filter((row) => matchesBranchLabel(row.ship_to_branch, labels));
  const readinessBlocked = intakeRows.filter(
    (row) =>
      (row.current_stage === 3 && !row.pdi_completed) ||
      (row.current_stage === 5 && !row.photo_ready),
  ).length;
  const readinessInPrep = intakeRows.filter((row) => row.current_stage < 8).length;

  const activeServiceJobs = input.serviceJobs.filter((row) => row.current_stage !== "paid_closed").length;
  const serviceInvoiceValue = input.serviceJobs.reduce((sum, row) => sum + Number(row.invoice_total ?? 0), 0);
  const branchRevenue = input.invoices.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const openArBalance = input.invoices.reduce((sum, row) => sum + Number(row.balance_due ?? 0), 0);

  const activeCustomerIds = new Set(
    input.serviceJobs.map((row) => row.customer_id).filter((value): value is string => Boolean(value)),
  );
  const serviceLinkedDeals = input.openDeals.filter((row) => row.company_id && activeCustomerIds.has(row.company_id));

  return {
    logisticsOpen: logisticsTickets.length,
    rentalMoves: rentalMoves.length,
    readinessBlocked,
    readinessInPrep,
    activeServiceJobs,
    serviceInvoiceValue,
    branchRevenue,
    openArBalance,
    serviceLinkedSalesCount: serviceLinkedDeals.length,
    serviceLinkedSalesValue: serviceLinkedDeals.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
  };
}
