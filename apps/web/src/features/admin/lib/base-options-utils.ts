export interface CompatibleAttachmentRecord {
  active: boolean;
  brandId: string | null;
  compatibleModelIds: string[] | null;
  universal: boolean;
}

export function attachmentMatchesModel(
  attachment: CompatibleAttachmentRecord,
  modelId: string,
  brandId: string,
  includeInactive = false,
): boolean {
  if (!includeInactive && !attachment.active) return false;
  if (attachment.brandId !== null && attachment.brandId !== brandId) return false;
  if (attachment.universal) return true;
  return Array.isArray(attachment.compatibleModelIds)
    ? attachment.compatibleModelIds.includes(modelId)
    : false;
}

export function applyPercentAdjustment(valueCents: number, percentDelta: number): number {
  const multiplier = 1 + percentDelta / 100;
  return Math.max(0, Math.round(valueCents * multiplier));
}

export function buildCopyModelCode(baseCode: string, existingCodes: string[]): string {
  const normalized = baseCode.trim();
  const occupied = new Set(existingCodes.map((code) => code.trim().toLowerCase()));
  const firstAttempt = `${normalized}-COPY`;
  if (!occupied.has(firstAttempt.toLowerCase())) return firstAttempt;

  let counter = 2;
  while (occupied.has(`${normalized}-COPY-${counter}`.toLowerCase())) {
    counter += 1;
  }
  return `${normalized}-COPY-${counter}`;
}
