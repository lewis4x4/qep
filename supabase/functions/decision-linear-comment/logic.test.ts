import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRecommendationComment,
  identifierFromLinearUrl,
  parseOwnerMentionMap,
  resolveLinearIssueFromPacket,
} from "./logic.ts";

Deno.test("resolveLinearIssueFromPacket reads multiple key variants", () => {
  const resolved = resolveLinearIssueFromPacket({
    linearIssueId: "lin-123",
    linear_issue_identifier: "QEP-155",
    linearUrl: "https://linear.app/acme/issue/QEP-155/decision",
  });

  assertEquals(resolved.issueId, "lin-123");
  assertEquals(resolved.issueIdentifier, "QEP-155");
  assertEquals(resolved.issueUrl, "https://linear.app/acme/issue/QEP-155/decision");
});

Deno.test("identifierFromLinearUrl extracts identifier path segment", () => {
  assertEquals(identifierFromLinearUrl("https://linear.app/acme/issue/QEP-155/test"), "QEP-155");
  assertEquals(identifierFromLinearUrl("https://linear.app/acme/project/qep"), null);
});

Deno.test("parseOwnerMentionMap normalizes keys and ignores invalid values", () => {
  const map = parseOwnerMentionMap('{"Brian":"@Brian Lewis","ryan":"@Ryan","bad":42}');
  assertEquals(map.brian, "@Brian Lewis");
  assertEquals(map.ryan, "@Ryan");
  assertEquals(map.bad, undefined);
});

Deno.test("buildRecommendationComment includes owner mention and decision details", () => {
  const body = buildRecommendationComment({
    decision: {
      id: "d1",
      code: "QEP-155",
      question_plain: "Should we post the recommendation to Linear for gated decisions?",
      owner_role: "brian",
      recommended_option: "approve",
      recommended_rationale: "Creates owner-visible audit trail on the mirrored issue.",
    },
    ownerMention: "@Brian Lewis",
    issueRef: { taskId: "F2.3", issueIdentifier: "QEP-155" },
  });

  assertStringIncludes(body, "@Brian Lewis recommendation ready for review.");
  assertStringIncludes(body, "Decision **QEP-155** requires owner action.");
  assertStringIncludes(body, "Recommended option: **approve**");
  assertStringIncludes(body, "Context: task F2.3 · issue QEP-155");
});
