/**
 * Voice escalation detection tests.
 *
 * Run with: deno test supabase/functions/_shared/voice-escalation-detect.test.ts
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  detectEscalationFromVoice,
  type VoiceEscalationExtraction,
} from "./voice-escalation-detect.ts";

const CTX = { dealId: "deal-1", contactId: "contact-1" };

Deno.test("returns null when dealId is missing", () => {
  const result = detectEscalationFromVoice(
    { intelligence: { escalation: { issue: "hydraulic leak" } } },
    { dealId: null, contactId: "contact-1" },
  );
  assertEquals(result, null);
});

Deno.test("returns null when extracted is null", () => {
  assertEquals(detectEscalationFromVoice(null, CTX), null);
  assertEquals(detectEscalationFromVoice(undefined, CTX), null);
});

Deno.test("returns null on empty extraction", () => {
  assertEquals(detectEscalationFromVoice({}, CTX), null);
});

Deno.test("path 1 — explicit escalation block wins", () => {
  const extracted: VoiceEscalationExtraction = {
    intelligence: {
      escalation: {
        issue: "Hydraulic pump failed twice in six weeks — customer is furious.",
        department: "Service",
        severity: "high",
      },
    },
  };
  const result = detectEscalationFromVoice(extracted, CTX);
  assertExists(result);
  assertEquals(result?.reason, "explicit");
  assertEquals(result?.department, "Service");
  assertEquals(result?.severity, "high");
  assertEquals(result?.issue_description.includes("Hydraulic"), true);
});

Deno.test("path 2 — negative sentiment plus non-trivial issue", () => {
  const extracted: VoiceEscalationExtraction = {
    intelligence: { sentiment: "negative" },
    needs_assessment: {
      current_equipment_issues: "Machine has been down for a week waiting on parts; lost a shift already.",
    },
  };
  const result = detectEscalationFromVoice(extracted, CTX);
  assertExists(result);
  assertEquals(result?.reason, "sentiment_with_issue");
  assertEquals(result?.department, "Service");
  assertEquals(result?.severity, "medium");
});

Deno.test("path 2 — negative sentiment without a real issue does not escalate", () => {
  const extracted: VoiceEscalationExtraction = {
    intelligence: { sentiment: "negative" },
    needs_assessment: { current_equipment_issues: "Runs ok" }, // trivial
  };
  assertEquals(detectEscalationFromVoice(extracted, CTX), null);
});

Deno.test("path 3 — narrative keyword with a brief issue", () => {
  const extracted: VoiceEscalationExtraction = {
    needs_assessment: { current_equipment_issues: "Starter is failing" },
    qrm_narrative: "Customer is unhappy; please escalate to the service manager immediately.",
  };
  const result = detectEscalationFromVoice(extracted, CTX);
  assertExists(result);
  assertEquals(result?.reason, "narrative_keyword");
});

Deno.test("path 3 — narrative keyword without an issue is ignored", () => {
  const extracted: VoiceEscalationExtraction = {
    qrm_narrative: "Let me know if we should escalate",
  };
  assertEquals(detectEscalationFromVoice(extracted, CTX), null);
});

Deno.test("positive sentiment never fires path 2", () => {
  const extracted: VoiceEscalationExtraction = {
    intelligence: { sentiment: "positive" },
    needs_assessment: {
      current_equipment_issues: "Track roller wore out but was under warranty — resolved",
    },
  };
  assertEquals(detectEscalationFromVoice(extracted, CTX), null);
});

Deno.test("path 1 beats path 2 even when both match", () => {
  const extracted: VoiceEscalationExtraction = {
    intelligence: {
      sentiment: "negative",
      escalation: { issue: "Very specific escalation text", severity: "high" },
    },
    needs_assessment: { current_equipment_issues: "Different issue text here x x x x x" },
  };
  const result = detectEscalationFromVoice(extracted, CTX);
  assertEquals(result?.reason, "explicit");
  assertEquals(result?.severity, "high");
});
