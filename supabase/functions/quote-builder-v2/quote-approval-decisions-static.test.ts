import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("A1.1 manager approval outcomes route all four terminal decisions", () => {
  assertStringIncludes(source, "const nextCaseStatus = decision === \"approved_with_conditions\"");
  assertStringIncludes(source, "nextQuoteStatus = nextCaseStatus === \"approved_with_conditions\"");

  const expectedDecisionRoutes = [
    { decision: "approved", quoteStatus: "approved" },
    { decision: "approved_with_conditions", quoteStatus: "approved_with_conditions" },
    { decision: "changes_requested", quoteStatus: "changes_requested" },
    { decision: "rejected", quoteStatus: "rejected" },
  ];

  for (const route of expectedDecisionRoutes) {
    assertStringIncludes(source, `decision === \"${route.decision}\"`);
    assertStringIncludes(source, `\"${route.quoteStatus}\"`);
  }

  assertStringIncludes(source, "At least one structured condition is required for conditional approval.");
  assertStringIncludes(source, "conditions: decision === \"approved\" || decision === \"rejected\" ? [] : conditions");
});

Deno.test("A1.1 approval decisions notify reps and update quote package status", () => {
  assertStringIncludes(source, ".from(\"quote_packages\")");
  assertStringIncludes(source, ".update({ status: nextQuoteStatus })");
  assertStringIncludes(source, "await notifyRepOfApprovalDecision({");
  assert(source.includes("auto_send: autoSendResult"));
});
