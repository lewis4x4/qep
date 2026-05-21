import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAutoTriageDraft,
  buildDeterministicCitations,
  draftRecommendation,
  rewriteQuestionPlain,
  routeOwnerRole,
} from "./logic.ts";

Deno.test("rewriteQuestionPlain normalizes explicit question", () => {
  assertEquals(rewriteQuestionPlain({ question: "  Approve finance close  " }), "Approve finance close?");
});

Deno.test("routeOwnerRole honors keyword mapping order", () => {
  assertEquals(routeOwnerRole({ title: "Sales campaign launch" }).owner_role, "rylee");
  assertEquals(routeOwnerRole({ title: "Brand scope reset" }).owner_role, "ryan");
  assertEquals(routeOwnerRole({ title: "TILA compliance update" }).owner_role, "angela");
  assertEquals(routeOwnerRole({ title: "Parts shelf policy" }).owner_role, "norman");
  assertEquals(routeOwnerRole({ title: "Accounting AP close" }).owner_role, "tina");
  assertEquals(routeOwnerRole({ title: "Unknown routing" }).owner_role, "brian");
});

Deno.test("buildDeterministicCitations emits stable payload-derived references", () => {
  const citations = buildDeterministicCitations({
    evidence_link: "https://example.com/evidence",
    task_ids: ["QEP-158"],
    title: "Need compliance ruling",
    citations: [{ source: "doc", ref: "wiki/abc", excerpt: "quoted" }],
  });

  assertEquals(citations, [
    {
      source: "evidence_link",
      ref: "https://example.com/evidence",
      excerpt: "Primary evidence link provided with pending decision payload.",
    },
    {
      source: "task",
      ref: "QEP-158",
      excerpt: "Pending decision references task QEP-158.",
    },
    {
      source: "payload",
      ref: "title",
      excerpt: "Need compliance ruling",
    },
    {
      source: "doc",
      ref: "wiki/abc",
      excerpt: "quoted",
    },
  ]);
});

Deno.test("draftRecommendation returns conservative lane defaults", () => {
  assertEquals(draftRecommendation("authorize").reversal_cost, "high");
  assertEquals(draftRecommendation("authorize").silence_threshold_days, null);
  assertEquals(draftRecommendation("ratify").recommended_option, "ratify_with_owner");
  assertEquals(draftRecommendation("ratify").silence_threshold_days, 7);
  assertEquals(draftRecommendation("auto").silence_threshold_days, 1);
});

Deno.test("buildAutoTriageDraft reuses lane-classifier and composes triage packet", () => {
  const draft = buildAutoTriageDraft({
    code: "QEP-158",
    title: "Security credential cutover",
    description: "Schema cutover requires legal and compliance checks",
    owner_hint: "Angela",
    options: [{ label: "Proceed" }, { label: "Pause" }],
  });

  assertEquals(draft.code, "QEP-158");
  assertEquals(draft.lane, "authorize");
  assertEquals(draft.owner_role, "angela");
  assertEquals(draft.status, "open");
  assertEquals(draft.ai_prep_packet.triage_version, "auto-triage-pipeline-v1");
});
