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
