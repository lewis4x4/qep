import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DRIVER_CHECKLIST,
  TRAFFIC_STATUS_META,
  canCompleteTrafficTicket,
  normalizeDriverChecklist,
  updateChecklistItem,
} from "./traffic-ticket-driver";

describe("traffic-ticket-driver helpers", () => {
  test("falls back to the default driver checklist", () => {
    expect(normalizeDriverChecklist(null)).toEqual(DEFAULT_DRIVER_CHECKLIST);
  });

  test("updates a checklist item by label", () => {
    const updated = updateChecklistItem(DEFAULT_DRIVER_CHECKLIST, "Capture customer signature", true);
    expect(updated.find((item) => item.item === "Capture customer signature")?.completed).toBe(true);
  });

  test("requires gps, signature, proof photos, hour meter, and completed checklist for completion", () => {
    expect(
      canCompleteTrafficTicket({
        driver_checklist: DEFAULT_DRIVER_CHECKLIST.map((item) => ({ ...item, completed: true })),
        delivery_lat: 30.188,
        delivery_lng: -82.639,
        delivery_signature_url: "data:image/png;base64,abc",
        delivery_photos: ["proof.jpg"],
        hour_meter_reading: 125.5,
      }),
    ).toBe(true);
  });

  test("rejects completion when proof capture is missing", () => {
    expect(
      canCompleteTrafficTicket({
        driver_checklist: DEFAULT_DRIVER_CHECKLIST.map((item) => ({ ...item, completed: true })),
        delivery_lat: 30.188,
        delivery_lng: -82.639,
        delivery_signature_url: null,
        delivery_photos: [],
        hour_meter_reading: null,
      }),
    ).toBe(false);
  });

  test("exposes the expected status labels", () => {
    expect(TRAFFIC_STATUS_META.being_shipped.label).toBe("Being shipped");
  });
});
