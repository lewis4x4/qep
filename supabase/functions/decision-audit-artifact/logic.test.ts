import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AuthorizationRow,
  buildDecisionAuditStorageKey,
  buildPdfTextLines,
  type DecisionRow,
  deriveAuditArtifactPlan,
  missingRequiredAuthorizeSignerRoles,
  renderAuthorizePdfBytes,
  renderDecisionCardHtml,
  sha256Hex,
} from "./logic.ts";

const generatedAt = new Date("2026-05-21T12:00:00.000Z");

function decision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "JAR-103",
    question_plain: "Authorize the equipment sale reversal workflow?",
    lane: "authorize",
    owner_role: "tina",
    requires_two_sigs: ["tina", "ryan"],
    options: [{
      label: "Proceed",
      description: "Ship guarded flow",
      is_recommended: true,
    }],
    recommended_option: "Proceed",
    recommended_rationale:
      "Citations show low operational risk after controls.",
    ai_prep_packet: {},
    citations: [{
      source: "spec",
      ref: "section 8",
      excerpt: "Signed PDF required.",
    }],
    reversal_cost: "high",
    status: "answered",
    answered_by: "authorize-signature-flow",
    answered_at: "2026-05-21T11:00:00.000Z",
    answered_option: "Proceed",
    answered_rationale: "Both required roles signed.",
    audit_url: null,
    created_at: "2026-05-20T10:00:00.000Z",
    updated_at: "2026-05-21T11:00:00.000Z",
    ...overrides,
  };
}

const authRows: AuthorizationRow[] = [
  {
    id: "auth-1",
    signer_role: "tina",
    signer_name: "Tina Owner",
    signer_email: "tina@example.com",
    signature_hash: "a".repeat(64),
    terms_version: "v1",
    signed_at: "2026-05-21T10:30:00.000Z",
    metadata: {},
    revoked_at: null,
  },
];

Deno.test("deriveAuditArtifactPlan maps AUTO to row-only with no R2 artifact", () => {
  const plan = deriveAuditArtifactPlan(decision({ lane: "auto" }), generatedAt);

  assertEquals(plan, {
    auditGrade: "auto",
    artifactKind: "row",
    contentType: null,
    extension: null,
    retentionUntil: null,
  });
});

Deno.test("deriveAuditArtifactPlan maps RATIFY to deterministic HTML artifact", () => {
  const plan = deriveAuditArtifactPlan(
    decision({ lane: "ratify" }),
    generatedAt,
  );

  assertEquals(plan.auditGrade, "ratify");
  assertEquals(plan.artifactKind, "html");
  assertEquals(plan.contentType, "text/html; charset=utf-8");
  assertEquals(plan.retentionUntil, null);
});

Deno.test("deriveAuditArtifactPlan maps AUTHORIZE to 7-year-retained PDF", () => {
  const plan = deriveAuditArtifactPlan(decision(), generatedAt);

  assertEquals(plan.auditGrade, "authorize");
  assertEquals(plan.artifactKind, "pdf");
  assertEquals(plan.contentType, "application/pdf");
  assertEquals(plan.retentionUntil, "2033-05-21T12:00:00.000Z");
});

Deno.test("storage keys are stable and lane-scoped", () => {
  const plan = deriveAuditArtifactPlan(
    decision({ lane: "ratify" }),
    generatedAt,
  );

  assertEquals(
    buildDecisionAuditStorageKey({ decision: decision(), plan, generatedAt }),
    "qep-decisions/ratify/jar-103/2026-05-21T12-00-00-000Z.html",
  );
});

Deno.test("missingRequiredAuthorizeSignerRoles reports partial AUTHORIZE signatures", () => {
  assertEquals(
    missingRequiredAuthorizeSignerRoles(decision(), authRows),
    ["ryan"],
  );
  assertEquals(
    missingRequiredAuthorizeSignerRoles(
      decision({ requires_two_sigs: null }),
      authRows,
    ),
    [],
  );
});

Deno.test("renderDecisionCardHtml captures decision, citations, and signature evidence", () => {
  const html = renderDecisionCardHtml({
    decision: decision(),
    authorizations: authRows,
    generatedAt,
  });

  assertStringIncludes(html, "QEP Decision Audit JAR-103");
  assertStringIncludes(html, "Authorize the equipment sale reversal workflow?");
  assertStringIncludes(html, "Signed PDF required.");
  assertStringIncludes(html, "Tina Owner");
  assertStringIncludes(html, "aaaaaaaaaaaaaaaa");
});

Deno.test("renderAuthorizePdfBytes emits minimal valid deterministic PDF bytes", async () => {
  const bytes = renderAuthorizePdfBytes({
    decision: decision(),
    authorizations: authRows,
    generatedAt,
  });
  const text = new TextDecoder().decode(bytes);

  assert(text.startsWith("%PDF-1.4"));
  assertStringIncludes(text, "JAR-103");
  assertStringIncludes(text, "Signed PDF required.");
  assertStringIncludes(text, "Tina Owner");
  assert(text.trimEnd().endsWith("%%EOF"));

  const second = renderAuthorizePdfBytes({
    decision: decision(),
    authorizations: authRows,
    generatedAt,
  });
  assertEquals(await sha256Hex(bytes), await sha256Hex(second));
});

Deno.test("PDF text lines include citation and authorization sections", () => {
  const lines = buildPdfTextLines({
    decision: decision(),
    authorizations: authRows,
    generatedAt,
  });

  assert(lines.some((line) => line.includes("Citations:")));
  assert(
    lines.some((line) => line.includes("Authorization signature evidence:")),
  );
  assert(lines.some((line) => line.includes("signature hash")));
});
