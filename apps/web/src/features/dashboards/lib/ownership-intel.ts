export interface ForecastDealRow {
  id: string | null;
  amount: number | null;
  weighted_amount: number | null;
  expected_close_on: string | null;
}

export interface ForecastBucketSummary {
  key: "30d" | "60d" | "90d";
  label: string;
  horizonDays: number;
  dealCount: number;
  rawPipeline: number;
  weightedRevenue: number;
}

export interface ExpiringIncentiveRow {
  id: string | null;
  manufacturer: string | null;
  program_name: string | null;
  expiration_date: string | null;
}

export interface DealEquipmentLinkRow {
  deal_id: string | null;
  role: string | null;
  crm_equipment:
    | {
        make?: string | null;
        category?: string | null;
      }
    | Array<{
        make?: string | null;
        category?: string | null;
      }>
    | null;
}

export interface IncentiveEligibleDeal {
  dealId: string;
  amount: number;
  weightedAmount: number;
  manufacturers: string[];
}

export interface IncentiveExposureSummary {
  expiringIncentiveCount: number;
  affectedDealCount: number;
  totalExposure: number;
  affectedManufacturers: string[];
}

export interface PredictionLedgerRow {
  outcome: string | null;
}

export interface PredictionLedgerAccuracy {
  resolvedCount: number;
  wonCount: number;
  accuracyPct: number | null;
}

function normalizeDate(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysUntil(targetDate: string, today: Date): number | null {
  const target = new Date(targetDate);
  if (Number.isNaN(target.getTime())) return null;
  const start = normalizeDate(today).getTime();
  const end = normalizeDate(target).getTime();
  return Math.floor((end - start) / 86_400_000);
}

export function buildForecastBuckets(
  deals: ForecastDealRow[],
  today = new Date(),
): ForecastBucketSummary[] {
  const buckets: ForecastBucketSummary[] = [
    { key: "30d", label: "30 days", horizonDays: 30, dealCount: 0, rawPipeline: 0, weightedRevenue: 0 },
    { key: "60d", label: "60 days", horizonDays: 60, dealCount: 0, rawPipeline: 0, weightedRevenue: 0 },
    { key: "90d", label: "90 days", horizonDays: 90, dealCount: 0, rawPipeline: 0, weightedRevenue: 0 },
  ];

  for (const deal of deals) {
    if (!deal.expected_close_on) continue;
    const delta = daysUntil(deal.expected_close_on, today);
    if (delta === null || delta > 90) continue;

    const rawAmount = deal.amount ?? 0;
    const weightedAmount = deal.weighted_amount ?? 0;

    if (delta <= 30) {
      buckets[0].dealCount += 1;
      buckets[0].rawPipeline += rawAmount;
      buckets[0].weightedRevenue += weightedAmount;
      continue;
    }
    if (delta <= 60) {
      buckets[1].dealCount += 1;
      buckets[1].rawPipeline += rawAmount;
      buckets[1].weightedRevenue += weightedAmount;
      continue;
    }

    buckets[2].dealCount += 1;
    buckets[2].rawPipeline += rawAmount;
    buckets[2].weightedRevenue += weightedAmount;
  }

  return buckets;
}

function normalizeJoinedEquipment(
  value: DealEquipmentLinkRow["crm_equipment"],
): { make?: string | null; category?: string | null } | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

export function buildIncentiveEligibleDeals(
  deals: ForecastDealRow[],
  equipmentLinks: DealEquipmentLinkRow[],
): IncentiveEligibleDeal[] {
  const openDealMap = new Map(
    deals
      .filter((deal): deal is Required<Pick<ForecastDealRow, "id">> & ForecastDealRow => Boolean(deal.id))
      .map((deal) => [
        deal.id as string,
        {
          dealId: deal.id as string,
          amount: deal.amount ?? 0,
          weightedAmount: deal.weighted_amount ?? 0,
          manufacturers: new Set<string>(),
        },
      ]),
  );

  for (const link of equipmentLinks) {
    if (!link.deal_id || !openDealMap.has(link.deal_id)) continue;
    const equipment = normalizeJoinedEquipment(link.crm_equipment);
    const manufacturer = equipment?.make?.trim().toLowerCase();
    if (!manufacturer) continue;
    openDealMap.get(link.deal_id)?.manufacturers.add(manufacturer);
  }

  return [...openDealMap.values()].map((deal) => ({
    dealId: deal.dealId,
    amount: deal.amount,
    weightedAmount: deal.weightedAmount,
    manufacturers: [...deal.manufacturers],
  }));
}

export function summarizeIncentiveExposure(
  incentives: ExpiringIncentiveRow[],
  deals: IncentiveEligibleDeal[],
): IncentiveExposureSummary {
  const affectedManufacturers = [...new Set(
    incentives
      .map((row) => row.manufacturer?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  )];

  if (affectedManufacturers.length === 0) {
    return {
      expiringIncentiveCount: incentives.length,
      affectedDealCount: 0,
      totalExposure: 0,
      affectedManufacturers: [],
    };
  }

  const affectedDeals = deals.filter((deal) =>
    deal.manufacturers.some((manufacturer) => affectedManufacturers.includes(manufacturer)),
  );

  return {
    expiringIncentiveCount: incentives.length,
    affectedDealCount: affectedDeals.length,
    totalExposure: affectedDeals.reduce((sum, deal) => sum + deal.amount, 0),
    affectedManufacturers,
  };
}

export function computePredictionLedgerAccuracy(
  rows: PredictionLedgerRow[],
): PredictionLedgerAccuracy {
  const resolved = rows.filter((row) => row.outcome === "won" || row.outcome === "lost");
  const wonCount = resolved.filter((row) => row.outcome === "won").length;

  return {
    resolvedCount: resolved.length,
    wonCount,
    accuracyPct: resolved.length > 0 ? (wonCount / resolved.length) * 100 : null,
  };
}
