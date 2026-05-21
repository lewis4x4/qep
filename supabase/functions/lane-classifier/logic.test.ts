import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyDecisionLane, mergeLaneClassificationInput } from "./logic.ts";

Deno.test("classifies AUTHORIZE when high-risk keywords are present", () => {
  const result = classifyDecisionLane({
    question_plain: "Should we do the customer data retention legal policy cutover?",
  });

  assertEquals(result.lane, "authorize");
});

Deno.test("classifies AUTO when reversible low-risk defaults are present", () => {
  const result = classifyDecisionLane({
    question_plain: "Set a reversible feature flag and UI default copy change",
  });

  assertEquals(result.lane, "auto");
});

Deno.test("classifies RATIFY for mid-reversibility policy/integration choices", () => {
  const result = classifyDecisionLane({
    question_plain: "Pick the integration policy with citations for operations",
  });

  assertEquals(result.lane, "ratify");
});

Deno.test("AUTHORIZE takes precedence over AUTO keywords", () => {
  const result = classifyDecisionLane({
    question_plain: "Reversible feature flag for schema cutover touching security credentials",
  });

  assertEquals(result.lane, "authorize");
});

Deno.test("merged persisted payload is used for classification when request is sparse", () => {
  const merged = mergeLaneClassificationInput(
    {
      code: "Q11",
      question_plain: "IntelliDealer data cutover authorization",
      recommended_rationale: "Irreversible data cutover and compliance risk",
      reversal_cost: "high",
      options: [{ label: "Proceed" }],
      citations: [{ excerpt: "Legal review required" }],
      ai_prep_packet: { context: "schema migration" },
    },
    {},
  );

  const result = classifyDecisionLane(merged);
  assertEquals(result.lane, "authorize");
});
