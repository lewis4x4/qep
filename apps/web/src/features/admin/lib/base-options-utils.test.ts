import { describe, expect, test } from "bun:test";
import {
  applyPercentAdjustment,
  attachmentMatchesModel,
  buildCopyModelCode,
} from "./base-options-utils";

describe("base-options-utils", () => {
  test("matches explicit compatible attachments", () => {
    expect(
      attachmentMatchesModel(
        {
          active: true,
          brandId: "brand-1",
          compatibleModelIds: ["model-1"],
          universal: false,
        },
        "model-1",
        "brand-1",
      ),
    ).toBe(true);
  });

  test("matches universal attachments for the same brand", () => {
    expect(
      attachmentMatchesModel(
        {
          active: true,
          brandId: "brand-1",
          compatibleModelIds: null,
          universal: true,
        },
        "model-1",
        "brand-1",
      ),
    ).toBe(true);
  });

  test("applies percentage adjustments in cents", () => {
    expect(applyPercentAdjustment(100_000, 10)).toBe(110_000);
    expect(applyPercentAdjustment(100_000, -5)).toBe(95_000);
  });

  test("builds unique copy codes", () => {
    expect(buildCopyModelCode("RT75", [])).toBe("RT75-COPY");
    expect(buildCopyModelCode("RT75", ["rt75-copy"])).toBe("RT75-COPY-2");
  });
});
