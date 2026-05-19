import { assertEquals } from "jsr:@std/assert";
import { resolveVoiceToQrmCompanyDecision } from "./company-resolution.ts";

Deno.test("linked company id forces deterministic attach and disables fuzzy/create", () => {
  const decision = resolveVoiceToQrmCompanyDecision({
    authorizedLinkedCompanyId: "company-123",
    extractedCompanyName: "Different Parsed Name",
  });

  assertEquals(decision, {
    forceCompanyId: "company-123",
    shouldFuzzyMatch: false,
    shouldCreateCompany: false,
  });
});

Deno.test("without linked company id, extracted name enables fuzzy/create path", () => {
  const decision = resolveVoiceToQrmCompanyDecision({
    authorizedLinkedCompanyId: null,
    extractedCompanyName: "Acme Equipment",
  });

  assertEquals(decision, {
    forceCompanyId: null,
    shouldFuzzyMatch: true,
    shouldCreateCompany: true,
  });
});
