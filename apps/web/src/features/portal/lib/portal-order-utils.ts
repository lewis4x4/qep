export interface PortalOrderLineDraft {
  part_number: string;
  quantity: number;
}

export function normalizePortalOrderLines(lines: PortalOrderLineDraft[]): PortalOrderLineDraft[] {
  return lines
    .map((line) => ({
      part_number: line.part_number.trim(),
      quantity: Math.max(1, Math.floor(Number(line.quantity)) || 1),
    }))
    .filter((line) => line.part_number.length > 0);
}

export function portalCartSummary(lines: PortalOrderLineDraft[]): {
  lineCount: number;
  totalQuantity: number;
} {
  const normalized = normalizePortalOrderLines(lines);
  return {
    lineCount: normalized.length,
    totalQuantity: normalized.reduce((sum, line) => sum + line.quantity, 0),
  };
}
