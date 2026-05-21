import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceMemoCandidatePatch,
  coerceAiExtraction,
  extractDecisionActionDeterministic,
} from "./logic.ts";

Deno.test("deterministic extraction prefers block over approve wording", () => {
  const extraction = extractDecisionActionDeterministic(
    "Do not approve this yet because the cyber insurance answer is missing.",
  );

  assertEquals(extraction.action, "block");
  assertEquals(extraction.method, "deterministic");
  assertEquals(extraction.rationale, "the cyber insurance answer is missing.");
});

Deno.test("deterministic extraction maps go-ahead language to approve", () => {
  const extraction = extractDecisionActionDeterministic(
    "Go ahead and move forward because this matches how we handle manager approvals today.",
  );

  assertEquals(extraction.action, "approve");
  assertEquals(extraction.method, "deterministic");
  assertEquals(
    extraction.rationale,
    "this matches how we handle manager approvals today.",
  );
});

Deno.test("deterministic extraction falls back to need_info for ambiguous memos", () => {
  const extraction = extractDecisionActionDeterministic(
    "I listened to this and want to revisit it tomorrow.",
  );

  assertEquals(extraction.action, "need_info");
  assertEquals(extraction.method, "fallback_need_info");
});

Deno.test("AI extraction coercion only accepts supported decision actions", () => {
  const fallback = extractDecisionActionDeterministic(
    "Need more info before this can ship.",
  );

  assertEquals(
    coerceAiExtraction({
      action: "approve",
      rationale: "Owner clearly approved.",
      confidence: 0.91,
    }, fallback),
    {
      action: "approve",
      rationale: "Owner clearly approved.",
      confidence: 0.91,
      method: "ai_json",
    },
  );
  assertEquals(coerceAiExtraction({ action: "maybe" }, fallback), fallback);
});

Deno.test("candidate patch preserves existing packet and never resolves the decision", () => {
  const patch = buildVoiceMemoCandidatePatch(
    {
      context: "existing prep",
      magic_link_last_action: { action: "need_info" },
    },
    {
      transcript: "Approve it because this keeps the quote moving.",
      extraction: {
        action: "approve",
        rationale: "this keeps the quote moving.",
        confidence: 0.84,
        method: "deterministic",
        matched_phrase: "approve",
      },
      source: { kind: "test_fixture", bytes: 1024, audio_mime: "audio/webm" },
      createdAt: "2026-05-21T12:00:00.000Z",
    },
  );

  assertEquals(patch.ai_prep_packet.context, "existing prep");
  assertObjectMatch(
    patch.ai_prep_packet.voice_memo_candidate as Record<string, unknown>,
    {
      transcript: "Approve it because this keeps the quote moving.",
      action: "approve",
      rationale: "this keeps the quote moving.",
      confirmation_required: true,
      created_at: "2026-05-21T12:00:00.000Z",
    },
  );
  assertEquals("status" in patch, false);
  assertEquals("answered_at" in patch, false);
  assertEquals("answered_option" in patch, false);
});
