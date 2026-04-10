import { describe, expect, test } from "bun:test";
import {
  buildTradeWalkaroundHref,
  canSubmitTradeWalkaround,
  missingRequiredTradePhotos,
  normalizeTradePhotos,
} from "./trade-walkaround";

describe("trade walkaround helpers", () => {
  test("normalizes stored photo payloads", () => {
    expect(
      normalizeTradePhotos([
        { type: "front_left", url: "https://example.com/front.jpg" },
        { bad: true },
      ]),
    ).toEqual([{ type: "front_left", url: "https://example.com/front.jpg" }]);
  });

  test("reports missing required photo slots", () => {
    const missing = missingRequiredTradePhotos([
      { type: "front_left", url: "a" },
      { type: "serial_plate", url: "b" },
    ]);
    expect(missing.map((slot) => slot.type)).toEqual([
      "front_right",
      "rear_left",
      "rear_right",
      "hour_meter",
    ]);
  });

  test("requires make, model, and every required photo before submit", () => {
    expect(
      canSubmitTradeWalkaround({
        make: "Develon",
        model: "DX225LC-7",
        photos: [
          { type: "front_left", url: "1" },
          { type: "front_right", url: "2" },
          { type: "rear_left", url: "3" },
          { type: "rear_right", url: "4" },
          { type: "serial_plate", url: "5" },
          { type: "hour_meter", url: "6" },
        ],
      }),
    ).toBe(true);
  });

  test("builds the canonical deal walkaround route", () => {
    expect(buildTradeWalkaroundHref("deal-123")).toBe("/qrm/deals/deal-123/trade-walkaround");
  });
});
