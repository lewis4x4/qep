import { assertEquals } from "jsr:@std/assert@1";
import {
  chooseQuotePipelineTargetStage,
  QUOTE_PIPELINE_STAGE_TARGETS,
  shouldAdvanceQuoteDealStage,
  type QuotePipelineStageRow,
} from "./qrm-pipeline-stage-automation.ts";

function stage(overrides: Partial<QuotePipelineStageRow>): QuotePipelineStageRow {
  return {
    id: "stage-default",
    workspace_id: "default",
    name: "Lead Received",
    sort_order: 1,
    is_closed_won: false,
    is_closed_lost: false,
    ...overrides,
  };
}

Deno.test("chooseQuotePipelineTargetStage chooses same-workspace exact name over default", () => {
  const selected = chooseQuotePipelineTargetStage({
    workspaceId: "workspace-1",
    target: QUOTE_PIPELINE_STAGE_TARGETS.quoteCreated,
    candidates: [
      stage({ id: "default-quote-created", workspace_id: "default", name: "Quote Created", sort_order: 6 }),
      stage({ id: "workspace-quote-created", workspace_id: "workspace-1", name: "Quote Created", sort_order: 6 }),
    ],
  });
  assertEquals(selected?.id, "workspace-quote-created");
});

Deno.test("chooseQuotePipelineTargetStage falls back to same-workspace sort order when name is missing", () => {
  const selected = chooseQuotePipelineTargetStage({
    workspaceId: "workspace-1",
    target: QUOTE_PIPELINE_STAGE_TARGETS.quoteCreated,
    candidates: [
      stage({ id: "workspace-sort-six", workspace_id: "workspace-1", name: "Proposal Built", sort_order: 6 }),
      stage({ id: "default-quote-created", workspace_id: "default", name: "Quote Created", sort_order: 6 }),
    ],
  });
  assertEquals(selected?.id, "workspace-sort-six");
});

Deno.test("chooseQuotePipelineTargetStage falls back to default exact name when workspace stage is missing", () => {
  const selected = chooseQuotePipelineTargetStage({
    workspaceId: "workspace-1",
    target: QUOTE_PIPELINE_STAGE_TARGETS.quoteSent,
    candidates: [stage({ id: "default-quote-sent", workspace_id: "default", name: "Quote Sent", sort_order: 7 })],
  });
  assertEquals(selected?.id, "default-quote-sent");
});

Deno.test("chooseQuotePipelineTargetStage ignores closed stages", () => {
  const selected = chooseQuotePipelineTargetStage({
    workspaceId: "workspace-1",
    target: QUOTE_PIPELINE_STAGE_TARGETS.quoteCreated,
    candidates: [
      stage({ id: "closed-name", workspace_id: "workspace-1", name: "Quote Created", sort_order: 6, is_closed_won: true }),
      stage({ id: "open-sort", workspace_id: "workspace-1", name: "Proposal Built", sort_order: 6 }),
    ],
  });
  assertEquals(selected?.id, "open-sort");
});

Deno.test("chooseQuotePipelineTargetStage prefers quote-presented sort order before Quote Sent fallback", () => {
  const selected = chooseQuotePipelineTargetStage({
    workspaceId: "workspace-1",
    target: QUOTE_PIPELINE_STAGE_TARGETS.quotePresented,
    candidates: [
      stage({ id: "quote-sent", workspace_id: "workspace-1", name: "Quote Sent", sort_order: 7 }),
      stage({ id: "walkthrough", workspace_id: "workspace-1", name: "Customer Walkthrough", sort_order: 8 }),
    ],
  });
  assertEquals(selected?.id, "walkthrough");
});

Deno.test("shouldAdvanceQuoteDealStage preserves forward-only progression", () => {
  assertEquals(shouldAdvanceQuoteDealStage({ currentSortOrder: 5, targetSortOrder: 6 }), true);
  assertEquals(shouldAdvanceQuoteDealStage({ currentSortOrder: 6, targetSortOrder: 6 }), false);
  assertEquals(shouldAdvanceQuoteDealStage({ currentSortOrder: 7, targetSortOrder: 6 }), false);
});

Deno.test("shouldAdvanceQuoteDealStage allows unknown current sort for caller-verified deals", () => {
  assertEquals(shouldAdvanceQuoteDealStage({ currentSortOrder: null, targetSortOrder: 6 }), true);
});
