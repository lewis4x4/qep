import { assertEquals } from "@std/assert@1";

import { isVoiceCaptureClusterMatch } from "./voice-capture-crm.ts";

Deno.test("voice cluster matching accepts same-target near-duplicate transcript", () => {
  const matched = isVoiceCaptureClusterMatch({
    transcript: "Met with ACME and discussed Cat 320 purchase next week.",
    summary: {
      contactName: "Jane Smith",
      companyName: "ACME Aggregates",
      machineInterest: "Cat 320",
      nextStep: "Send updated quote",
    },
    candidateTranscript:
      "Met today with ACME Aggregates about CAT 320 purchase and we should send updated quote next week.",
    candidateSummary: {
      companyName: "ACME Aggregates",
      machineInterest: "CAT 320",
    },
  });

  assertEquals(matched, true);
});

Deno.test("voice cluster matching rejects unrelated transcript", () => {
  const matched = isVoiceCaptureClusterMatch({
    transcript: "Need a follow-up quote for Cat 320 at ACME Aggregates.",
    summary: {
      contactName: "Jane Smith",
      companyName: "ACME Aggregates",
      machineInterest: "Cat 320",
      nextStep: "Send updated quote",
    },
    candidateTranscript:
      "Service dispatch scheduled hydraulic repair for yard loader.",
    candidateSummary: {
      companyName: "Different Company",
      machineInterest: "Service truck",
    },
  });

  assertEquals(matched, false);
});
