import { assertEquals } from "jsr:@std/assert@1";

import { normalizeVoiceCaptureSummaryBullets } from "./voice-capture-summary.ts";

Deno.test("normalizeVoiceCaptureSummaryBullets accepts JSON object bullets", () => {
  assertEquals(normalizeVoiceCaptureSummaryBullets({
    bullets: [
      "Customer wants a 210P excavator demo next week.",
      "Budget is still pending manager approval.",
      "Trade-in is possible if numbers work.",
      "Primary concern is machine availability.",
      "Rep should send rental-to-own options tomorrow.",
    ],
  }), [
    "Customer wants a 210P excavator demo next week.",
    "Budget is still pending manager approval.",
    "Trade-in is possible if numbers work.",
    "Primary concern is machine availability.",
    "Rep should send rental-to-own options tomorrow.",
  ]);
});

Deno.test("normalizeVoiceCaptureSummaryBullets strips markers, dedupes, and caps at 8", () => {
  assertEquals(normalizeVoiceCaptureSummaryBullets([
    "- Customer met onsite after the DFW visit.",
    "1. Customer met onsite after the DFW visit.",
    "• Skid steer upgrade remains the core equipment need.",
    "2) Timeline is before the drainage project starts.",
    "- Financing options need to be included.",
    "* Availability is the main objection.",
    "— Manager should review margin before quote.",
    "7. Next step is a demo appointment.",
    "8. Rep should send specs today.",
    "9. This ninth bullet should be ignored.",
  ]), [
    "Customer met onsite after the DFW visit.",
    "Skid steer upgrade remains the core equipment need.",
    "Timeline is before the drainage project starts.",
    "Financing options need to be included.",
    "Availability is the main objection.",
    "Manager should review margin before quote.",
    "Next step is a demo appointment.",
    "Rep should send specs today.",
  ]);
});

Deno.test("normalizeVoiceCaptureSummaryBullets returns null for fewer than five bullets", () => {
  assertEquals(normalizeVoiceCaptureSummaryBullets({ bullets: ["One", "Two", "Three", "Four"] }), null);
});

Deno.test("normalizeVoiceCaptureSummaryBullets returns null for invalid shapes", () => {
  assertEquals(normalizeVoiceCaptureSummaryBullets(null), null);
  assertEquals(normalizeVoiceCaptureSummaryBullets({}), null);
  assertEquals(normalizeVoiceCaptureSummaryBullets("not json"), null);
});
