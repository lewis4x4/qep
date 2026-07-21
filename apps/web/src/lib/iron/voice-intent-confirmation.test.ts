import { describe, expect, test } from "bun:test";
import {
  buildConfirmedIronVoiceRequest,
  inferIronVoiceIntent,
  labelIronVoiceIntent,
} from "./voice-intent-confirmation";

describe("Iron voice intent confirmation", () => {
  test("classifies the four owner-approved voice destinations", () => {
    expect(inferIronVoiceIntent("Quote a 5T forklift for Acme")).toBe("quote");
    expect(inferIronVoiceIntent("Log my visit with Acme")).toBe("note");
    expect(inferIronVoiceIntent("Update the CRM deal stage to proposal")).toBe("crm");
    expect(inferIronVoiceIntent("What parts fit a 5T forklift?")).toBe("question");
  });

  test("builds an explicit request only after the selected intent is confirmed", () => {
    expect(buildConfirmedIronVoiceRequest("quote", "  Acme needs a 5T  ")).toBe(
      "Create a quote: Acme needs a 5T",
    );
    expect(buildConfirmedIronVoiceRequest("note", "Called the buyer")).toBe(
      "Log a note: Called the buyer",
    );
    expect(buildConfirmedIronVoiceRequest("crm", "Move Acme to proposal")).toBe(
      "Update CRM: Move Acme to proposal",
    );
    expect(buildConfirmedIronVoiceRequest("question", "What is due today?")).toBe(
      "What is due today?",
    );
    expect(buildConfirmedIronVoiceRequest("note", "   ")).toBe("");
  });

  test("exposes plain-language labels for correction controls", () => {
    expect(labelIronVoiceIntent("quote")).toBe("Quote");
    expect(labelIronVoiceIntent("crm")).toBe("CRM update");
  });
});
