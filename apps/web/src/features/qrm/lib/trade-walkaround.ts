export type TradePhotoType =
  | "front_left"
  | "front_right"
  | "rear_left"
  | "rear_right"
  | "serial_plate"
  | "hour_meter";

export interface TradePhotoSlot {
  type: TradePhotoType;
  label: string;
  prompt: string;
}

export interface TradeWalkaroundPhoto {
  type: string;
  url: string;
}

export const REQUIRED_TRADE_PHOTO_SLOTS: TradePhotoSlot[] = [
  { type: "front_left", label: "Front left", prompt: "Capture the full front-left corner." },
  { type: "front_right", label: "Front right", prompt: "Capture the full front-right corner." },
  { type: "rear_left", label: "Rear left", prompt: "Capture the full rear-left corner." },
  { type: "rear_right", label: "Rear right", prompt: "Capture the full rear-right corner." },
  { type: "serial_plate", label: "Serial plate", prompt: "Capture a readable serial plate photo." },
  { type: "hour_meter", label: "Hour meter", prompt: "Capture the hour meter display clearly." },
];

export function normalizeTradePhotos(value: unknown): TradeWalkaroundPhoto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      type: typeof row.type === "string" ? row.type : "",
      url: typeof row.url === "string" ? row.url : "",
    }))
    .filter((row) => row.type.length > 0 && row.url.length > 0);
}

export function missingRequiredTradePhotos(
  photos: TradeWalkaroundPhoto[],
): TradePhotoSlot[] {
  const seen = new Set(photos.map((photo) => photo.type));
  return REQUIRED_TRADE_PHOTO_SLOTS.filter((slot) => !seen.has(slot.type));
}

export function canSubmitTradeWalkaround(input: {
  make: string;
  model: string;
  photos: TradeWalkaroundPhoto[];
}): boolean {
  return (
    input.make.trim().length > 0 &&
    input.model.trim().length > 0 &&
    missingRequiredTradePhotos(input.photos).length === 0
  );
}

export function buildTradeWalkaroundHref(dealId: string): string {
  return `/qrm/deals/${dealId}/trade-walkaround`;
}
