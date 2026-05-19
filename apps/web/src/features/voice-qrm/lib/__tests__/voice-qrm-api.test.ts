import { describe, expect, test } from "bun:test";
import { buildVoiceQrmFormData } from "../voice-qrm-api";

describe("buildVoiceQrmFormData", () => {
  test("includes linked_company_id when launched from known customer record", () => {
    const form = buildVoiceQrmFormData({
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      fileName: "capture.webm",
      linkedCompanyId: "company-123",
    });

    expect(form.get("linked_company_id")).toBe("company-123");
  });

  test("supports deal_id and linked_company_id together", () => {
    const form = buildVoiceQrmFormData({
      audioBlob: new Blob(["audio"], { type: "audio/webm" }),
      fileName: "capture.webm",
      dealId: "deal-456",
      linkedCompanyId: "company-123",
    });

    expect(form.get("deal_id")).toBe("deal-456");
    expect(form.get("linked_company_id")).toBe("company-123");
  });
});
