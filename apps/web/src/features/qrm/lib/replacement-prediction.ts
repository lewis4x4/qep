export type ReplacementWindow = "30d" | "60d" | "90d" | "180d";
export type ReplacementConfidence = "high" | "medium" | "low";

export interface ReplacementPredictionRow {
  fleetIntelligenceId: string;
  equipmentId: string | null;
  companyId: string | null;
  customerName: string;
  make: string;
  model: string;
  year: number | null;
  equipmentSerial: string | null;
  currentHours: number | null;
  predictedReplacementDate: string;
  replacementConfidence: number | null;
  outreachDealValue: number | null;
}

export interface ReplacementPredictionItem extends ReplacementPredictionRow {
  title: string;
  daysUntil: number;
  window: ReplacementWindow;
  confidenceBand: ReplacementConfidence;
}

export interface ReplacementPredictionBoard {
  summary: {
    due30d: number;
    due60d: number;
    due90d: number;
    due180d: number;
  };
  items: ReplacementPredictionItem[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function confidenceBand(value: number | null | undefined): ReplacementConfidence {
  if ((value ?? 0) >= 0.75) return "high";
  if ((value ?? 0) >= 0.5) return "medium";
  return "low";
}

function windowForDays(daysUntil: number): ReplacementWindow {
  if (daysUntil <= 30) return "30d";
  if (daysUntil <= 60) return "60d";
  if (daysUntil <= 90) return "90d";
  return "180d";
}

export function buildReplacementPredictionBoard(
  rows: ReplacementPredictionRow[],
  nowTime = Date.now(),
): ReplacementPredictionBoard {
  const items = rows
    .map((row) => {
      const predictedTime = parseTime(row.predictedReplacementDate);
      if (predictedTime == null) return null;
      const daysUntil = Math.ceil((predictedTime - nowTime) / 86_400_000);
      if (daysUntil < 0 || daysUntil > 180) return null;
      return {
        ...row,
        title: [row.year, row.make, row.model].filter(Boolean).join(" "),
        daysUntil,
        window: windowForDays(daysUntil),
        confidenceBand: confidenceBand(row.replacementConfidence),
      } satisfies ReplacementPredictionItem;
    })
    .filter((item): item is ReplacementPredictionItem => item != null)
    .sort((a, b) => {
      if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
      return (b.replacementConfidence ?? 0) - (a.replacementConfidence ?? 0);
    });

  return {
    summary: {
      due30d: items.filter((item) => item.daysUntil <= 30).length,
      due60d: items.filter((item) => item.daysUntil > 30 && item.daysUntil <= 60).length,
      due90d: items.filter((item) => item.daysUntil > 60 && item.daysUntil <= 90).length,
      due180d: items.filter((item) => item.daysUntil > 90 && item.daysUntil <= 180).length,
    },
    items,
  };
}
