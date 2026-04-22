export type ApAgingBucket = "current" | "31_60" | "61_90" | "91_120" | "over_120";

export function bucketAge(days: number): ApAgingBucket {
  if (days <= 30) return "current";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  if (days <= 120) return "91_120";
  return "over_120";
}

export function labelAgeBucket(bucket: ApAgingBucket): string {
  switch (bucket) {
    case "current":
      return "Current";
    case "31_60":
      return "31-60";
    case "61_90":
      return "61-90";
    case "91_120":
      return "91-120";
    case "over_120":
      return "Over 120";
  }
}

export function sumApAmounts(rows: Array<{ balance_due: number }>): number {
  return rows.reduce((sum, row) => sum + Number(row.balance_due ?? 0), 0);
}
