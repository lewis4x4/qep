import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "718_b14_action_naming_clarification_closeout.sql");
const actionItemsWidget = readText("apps", "web", "src", "features", "floor", "widgets", "ActionItemsWidget.tsx");
const advisorActionCards = readText("apps", "web", "src", "features", "floor", "components", "AdvisorActionCards.tsx");
const registry = readText("apps", "web", "src", "features", "floor", "lib", "floor-widget-registry.tsx");
const floorAudit = readText("docs", "operations", "IRON_FLOOR_AUDIT_2026-05-17.md");
const b13ManualDoc = readText("docs", "operations", "B1.3_AI_BRIEFING_DEPTH_CHECK_2026-05-21.md");

const compactCloseout = compact(closeoutSql);
const compactActionItemsWidget = compact(actionItemsWidget);
const compactAdvisorActionCards = compact(advisorActionCards);
const compactRegistry = compact(registry);
const compactFloorAudit = compact(floorAudit);
const compactB13ManualDoc = compact(b13ManualDoc);

describe("718_b14_action_naming_clarification_closeout.sql contract", () => {
  it("marks only B1.4 shipped and leaves B1.3 manual-pending", () => {
    expect(compactCloseout).toContain("where task_id = 'b1.4'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).not.toContain("where task_id = 'b1.3'");
    expect(compactCloseout).toContain("b1.3 remains manual-pending operational review");
  });

  it("records the action-language boundary and manual limits", () => {
    expect(compactCloseout).toContain("actionitemswidget.tsx");
    expect(compactCloseout).toContain("advisoractioncards.tsx");
    expect(compactCloseout).toContain("floor-widget-registry.tsx");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("comment-only/code-contract closeout");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("keeps ActionItemsWidget documented as the live task/follow-up queue", () => {
    expect(compactActionItemsWidget).toContain("actionitemswidget — david's daily priority list");
    expect(compactActionItemsWidget).toContain("do not merge this with `advisoractioncards`");
    expect(compactActionItemsWidget).toContain("advisor ctas / quick-tool shortcuts");
    expect(compactActionItemsWidget).toContain("sales.action-items` task/follow-up queue");
    expect(compactActionItemsWidget).toContain("per-row quick actions");
    expect(compactActionItemsWidget).toContain("mark done");
  });

  it("keeps AdvisorActionCards documented as the CTA and quick-tool surface", () => {
    expect(compactAdvisorActionCards).toContain("advisoractioncards — quote-first action surface");
    expect(compactAdvisorActionCards).toContain("cta / quick-tool surface");
    expect(compactAdvisorActionCards).toContain("quote, voice quote, voice note, service request");
    expect(compactAdvisorActionCards).toContain("not the `sales.action-items` widget");
    expect(compactAdvisorActionCards).toContain("fetchadvisorfollowupstats");
    expect(compactAdvisorActionCards).toContain("fetchadvisorpipelinestats");
  });

  it("keeps the registry boundary on the sales.action-items widget entry", () => {
    const entryStart = compactRegistry.indexOf('"sales.action-items"');
    expect(entryStart).toBeGreaterThan(-1);
    const actionItemsEntry = compactRegistry.slice(entryStart, entryStart + 900);

    expect(actionItemsEntry).toContain("purpose: \"your open touchpoints, ordered by deal value");
    expect(actionItemsEntry).toContain("task/follow-up");
    expect(actionItemsEntry).toContain("queue widget");
    expect(actionItemsEntry).toContain("advisor \"log actions\" / launch shortcuts live separately");
    expect(actionItemsEntry).toContain("in advisoractioncards");
    expect(actionItemsEntry).toContain("component: actionitemswidget");
  });

  it("anchors the closeout to the original audit request and B1.3 skip reason", () => {
    expect(compactFloorAudit).toContain("### 3.4 action items widget naming collision");
    expect(compactFloorAudit).toContain("two different concepts share the word \"actions.\"");
    expect(compactFloorAudit).toContain("worth a naming clarification in code comments");

    expect(compactB13ManualDoc).toContain("blocked on operational signoff, not blocked on code");
    expect(compactB13ManualDoc).toContain("keep b1.3 **blocked/manual-pending**");
    expect(compactB13ManualDoc).toContain("no code change is required before that review");
  });
});
