export type EcosystemConfidence = "high" | "medium" | "low";

export interface EcosystemFinanceRate {
  lenderName: string;
  creditTier: string;
  ratePct: number;
  termMonths: number;
  minAmount: number | null;
  maxAmount: number | null;
  expiryDate: string | null;
}

export interface EcosystemAssessmentSignal {
  dealId: string;
  financingPreference: string | null;
  monthlyPaymentTarget: number | null;
  brandPreference: string | null;
  budgetType: string | null;
}

export interface EcosystemCoverageSignal {
  equipmentId: string | null;
  label: string;
  warrantyExpiry: string | null;
  warrantyType: string | null;
  nextServiceDue: string | null;
}

export interface EcosystemTransportSignal {
  id: string;
  dealId: string | null;
  status: string;
  shippingDate: string;
  promisedDeliveryAt: string | null;
  blockerReason: string | null;
  lateReason: string | null;
  ticketType: string;
}

export interface EcosystemOemSignal {
  oemName: string;
  programName: string;
  endDate: string | null;
  requiresApproval: boolean;
  discountType: string;
  discountValue: number;
}

export interface EcosystemAuctionSignal {
  make: string;
  model: string;
  year: number | null;
  auctionDate: string;
  hammerPrice: number;
  location: string | null;
}

export interface EcosystemRow {
  key: string;
  title: string;
  confidence: EcosystemConfidence;
  trace: string[];
  actionLabel: string;
  href: string;
}

export interface EcosystemLayerBoard {
  summary: {
    lenderLanes: number;
    coverageAlerts: number;
    transportMoves: number;
    marketSignals: number;
  };
  finance: EcosystemRow[];
  coverage: EcosystemRow[];
  transport: EcosystemRow[];
  market: EcosystemRow[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function monthDay(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function buildEcosystemLayerBoard(input: {
  accountId: string;
  amountAnchor: number | null;
  assessments: EcosystemAssessmentSignal[];
  financeRates: EcosystemFinanceRate[];
  coverage: EcosystemCoverageSignal[];
  transport: EcosystemTransportSignal[];
  oemSignals: EcosystemOemSignal[];
  auctionSignals: EcosystemAuctionSignal[];
  nowTime?: number;
}): EcosystemLayerBoard {
  const nowTime = input.nowTime ?? Date.now();
  const commandHref = `/qrm/accounts/${input.accountId}/command`;
  const strategistHref = `/qrm/accounts/${input.accountId}/strategist`;

  const financingPreferences = new Set(
    input.assessments
      .map((row) => normalize(row.financingPreference))
      .filter((value): value is string => Boolean(value)),
  );
  const monthlyTargets = input.assessments
    .map((row) => row.monthlyPaymentTarget)
    .filter((value): value is number => typeof value === "number");
  const brandPreferences = new Set(
    input.assessments
      .map((row) => normalize(row.brandPreference))
      .filter((value): value is string => Boolean(value)),
  );

  const matchingRates = input.financeRates
    .filter((row) => {
      if (input.amountAnchor == null) return true;
      if (row.minAmount != null && input.amountAnchor < row.minAmount) return false;
      if (row.maxAmount != null && input.amountAnchor > row.maxAmount) return false;
      return true;
    })
    .sort((a, b) => a.ratePct - b.ratePct || a.termMonths - b.termMonths)
    .slice(0, 4);

  const finance: EcosystemRow[] = matchingRates.map((row) => ({
    key: `${row.lenderName}:${row.creditTier}:${row.termMonths}`,
    title: `${row.lenderName} ${row.termMonths}m ${row.creditTier} lane`,
    confidence: row.expiryDate && (parseTime(row.expiryDate) ?? 0) <= nowTime + 45 * 86_400_000
      ? "high"
      : financingPreferences.size > 0 || monthlyTargets.length > 0
        ? "medium"
        : "low",
    trace: [
      `${row.ratePct.toFixed(2)}% rate for ${row.termMonths} months.`,
      input.amountAnchor != null
        ? `Current commercial anchor is about $${Math.round(input.amountAnchor).toLocaleString()}.`
        : "No current deal or quote amount anchor is available.",
      financingPreferences.size > 0
        ? `Observed financing preference${financingPreferences.size === 1 ? "" : "s"}: ${[...financingPreferences].map(titleize).join(", ")}.`
        : "No explicit financing preference is recorded on current assessments.",
      monthlyTargets.length > 0
        ? `${monthlyTargets.length} assessment${monthlyTargets.length === 1 ? "" : "s"} include a monthly payment target.`
        : "No monthly payment targets are recorded yet.",
    ],
    actionLabel: "Open strategist",
    href: strategistHref,
  }));

  const coverageAlerts: Array<EcosystemRow & { urgent: boolean }> = input.coverage
    .map((row) => {
      const warrantyDays = row.warrantyExpiry ? Math.ceil(((parseTime(row.warrantyExpiry) ?? nowTime) - nowTime) / 86_400_000) : null;
      const serviceDays = row.nextServiceDue ? Math.ceil(((parseTime(row.nextServiceDue) ?? nowTime) - nowTime) / 86_400_000) : null;
      const urgent = (warrantyDays != null && warrantyDays <= 90) || (serviceDays != null && serviceDays <= 30);
      const confidence: EcosystemConfidence = urgent ? "high" : row.warrantyType ? "medium" : "low";
      return {
        key: row.equipmentId ?? row.label,
        title: row.label,
        confidence,
        trace: [
          row.warrantyType ? `${titleize(row.warrantyType)} warranty coverage.` : "No warranty type is recorded.",
          row.warrantyExpiry ? `Warranty expires ${monthDay(row.warrantyExpiry)}.` : "No warranty expiry is recorded.",
          row.nextServiceDue ? `Next service due ${monthDay(row.nextServiceDue)}.` : "No next service due date is recorded.",
        ],
        actionLabel: "Open account command",
        href: commandHref,
        urgent,
      };
    })
    .sort((a, b) => Number(b.urgent) - Number(a.urgent))
    .slice(0, 6);

  const transport: EcosystemRow[] = input.transport
    .map((row) => {
      const late = row.promisedDeliveryAt ? (parseTime(row.promisedDeliveryAt) ?? nowTime) < nowTime : false;
      const blocked = Boolean(row.blockerReason || row.lateReason);
      const confidence: EcosystemConfidence = blocked ? "high" : late ? "medium" : "low";
      return {
        key: row.id,
        title: `${titleize(row.ticketType)} movement`,
        confidence,
        trace: [
          `Status: ${titleize(row.status)}.`,
          `Shipping date ${monthDay(row.shippingDate)}${row.promisedDeliveryAt ? ` · promised ${monthDay(row.promisedDeliveryAt)}` : ""}.`,
          row.blockerReason
            ? `Blocker: ${row.blockerReason}.`
            : row.lateReason
              ? `Late reason: ${row.lateReason}.`
              : "No current transport blocker is recorded.",
        ],
        actionLabel: "Open traffic",
        href: "/ops/traffic",
      };
    })
    .slice(0, 6);

  const market: EcosystemRow[] = [
    ...input.oemSignals.slice(0, 3).map((row) => ({
      key: `oem:${row.oemName}:${row.programName}`,
      title: `${row.oemName} program: ${row.programName}`,
      confidence: row.endDate && (parseTime(row.endDate) ?? 0) <= nowTime + 30 * 86_400_000
        ? "high" as const
        : brandPreferences.has(normalize(row.oemName) ?? "")
          ? "medium" as const
          : "low" as const,
      trace: [
        `${titleize(row.discountType)} value ${row.discountValue}.`,
        row.endDate ? `Program ends ${monthDay(row.endDate)}.` : "No program end date is recorded.",
        row.requiresApproval ? "Requires approval before use." : "No additional approval requirement is recorded.",
      ],
      actionLabel: "Open incentives",
      href: "/admin/incentives",
    })),
    ...input.auctionSignals.slice(0, 3).map((row) => ({
      key: `auction:${row.make}:${row.model}:${row.auctionDate}`,
      title: `${row.make} ${row.model}${row.year ? ` ${row.year}` : ""} auction comp`,
      confidence: "medium" as const,
      trace: [
        `Hammer price $${Math.round(row.hammerPrice).toLocaleString()}.`,
        `Auction date ${monthDay(row.auctionDate)}${row.location ? ` · ${row.location}` : ""}.`,
        "Use this as external market context when the account moves toward trade, exit, or repositioning.",
      ],
      actionLabel: "Open price intelligence",
      href: "/price-intelligence",
    })),
  ];

  return {
    summary: {
      lenderLanes: finance.length,
      coverageAlerts: coverageAlerts.filter((row) => row.urgent).length,
      transportMoves: transport.length,
      marketSignals: market.length,
    },
    finance,
    coverage: coverageAlerts.map(({ urgent: _urgent, ...row }) => row),
    transport,
    market,
  };
}
