import type { Json } from "@/lib/database.types";

export interface DriverChecklistItem {
  item: string;
  completed: boolean;
}

export interface TrafficTicketDriverRecord {
  driver_checklist: Json | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_signature_url: string | null;
  delivery_photos: Json | null;
  hour_meter_reading: number | null;
}

export const TRAFFIC_STATUS_META: Record<string, { label: string; badge: string }> = {
  haul_pending: { label: "Haul pending", badge: "bg-gray-500/10 text-gray-300" },
  scheduled: { label: "Scheduled", badge: "bg-yellow-500/10 text-yellow-300" },
  being_shipped: { label: "Being shipped", badge: "bg-orange-500/10 text-orange-300" },
  completed: { label: "Completed", badge: "bg-red-500/10 text-red-300" },
};

export const DEFAULT_DRIVER_CHECKLIST: DriverChecklistItem[] = [
  { item: "Confirm destination contact and phone number", completed: false },
  { item: "Verify unit loaded and secured", completed: false },
  { item: "Capture delivery location GPS", completed: false },
  { item: "Capture customer signature", completed: false },
  { item: "Capture delivery and hour meter proof", completed: false },
];

export function normalizeDriverChecklist(value: Json | null | undefined): DriverChecklistItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_DRIVER_CHECKLIST;
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return DEFAULT_DRIVER_CHECKLIST[index] ?? { item: `Driver step ${index + 1}`, completed: false };
    }
    const item = String((entry as { item?: unknown }).item ?? DEFAULT_DRIVER_CHECKLIST[index]?.item ?? `Driver step ${index + 1}`);
    const completed = Boolean((entry as { completed?: unknown }).completed);
    return { item, completed };
  });
}

export function updateChecklistItem(
  items: DriverChecklistItem[],
  itemLabel: string,
  completed: boolean,
): DriverChecklistItem[] {
  return items.map((item) => (item.item === itemLabel ? { ...item, completed } : item));
}

export function serializeDriverChecklist(items: DriverChecklistItem[]): Json {
  return items.map((item) => ({
    item: item.item,
    completed: item.completed,
  }));
}

function asArray(value: Json | null | undefined): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function canCompleteTrafficTicket(record: TrafficTicketDriverRecord): boolean {
  const checklist = normalizeDriverChecklist(record.driver_checklist);
  return (
    checklist.every((item) => item.completed) &&
    record.delivery_lat != null &&
    record.delivery_lng != null &&
    Boolean(record.delivery_signature_url) &&
    asArray(record.delivery_photos).length > 0 &&
    record.hour_meter_reading != null
  );
}
