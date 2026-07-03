import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "735_b55_save_draft_back_collision_closeout.sql");
const mobileShell = readText(
  "apps",
  "web",
  "src",
  "features",
  "quote-builder",
  "components",
  "QuoteBuilderV2PageMobileShell.tsx",
);
const mobileShellTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "quote-builder",
  "components",
  "__tests__",
  "QuoteBuilderV2PageMobileShell.mobile.test.tsx",
);
const stickyAction = readText("apps", "web", "src", "features", "sales", "components", "MobileStickyActionBar.tsx");
const stickyActionTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "components",
  "MobileStickyActionBar.test.tsx",
);

const compactCloseout = compact(closeoutSql);
const compactMobileShell = compact(mobileShell);
const compactMobileShellTest = compact(mobileShellTest);
const compactStickyAction = compact(stickyAction);
const compactStickyActionTest = compact(stickyActionTest);

describe("735_b55_save_draft_back_collision_closeout.sql contract", () => {
  it("marks only B5.5 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.5'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("without accidentally navigating backward");
    expect(compactCloseout).not.toContain("where task_id = 'b5.4'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.6'");
  });

  it("keeps manual and financial-path boundaries explicit", () => {
    expect(compactCloseout).toContain("no live mobile-device uat");
    expect(compactCloseout).toContain("credential-gated playwright authenticated quote-builder mobile navigation was not rerun");
    expect(compactCloseout).toContain("does not change quote save semantics");
    expect(compactCloseout).toContain("quote financial totals");
    expect(compactCloseout).toContain("approval routing");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("uses MobileStickyActionBar as the mobile quote action footer", () => {
    expect(compactMobileShell).toContain("import { mobilestickyactionbar } from \"@/features/sales/components/mobilestickyactionbar\"");
    expect(compactMobileShell).toContain("data-testid=\"quote-mobile-action-bar\"");
    expect(compactMobileShell).toContain("data-bottom-offset-contract=\"sales-shell-bottom-offset\"");
    expect(compactMobileShell).toContain("<mobilestickyactionbar");
    expect(compactMobileShell).toContain("classname=\"bottom-[var(--sales-shell-bottom-offset)]\"");
    expect(compactMobileShell).toContain("includesafeareapadding={false}");
  });

  it("separates persistent Save Draft from the inline primary actions", () => {
    expect(compactMobileShell).toContain("secondary={");
    expect(compactMobileShell).toContain("onclick={onsavedraft}");
    expect(compactMobileShell).toContain("disabled={primaryactionpending}");
    expect(compactMobileShell).toContain("save draft");
    expect(compactMobileShell).toContain("data-testid=\"quote-mobile-primary-actions\"");
    expect(compactMobileShell).toContain("data-layout=\"inline\"");
    expect(compactMobileShell).toContain("aria-label=\"open assistant\"");
    expect(compactMobileShell).toContain("onclick={onprimaryaction}");
  });

  it("locks the back-collision behavior in focused mobile shell tests", () => {
    expect(compactMobileShellTest).toContain("keeps save draft as persistent secondary action and removes back collision");
    expect(compactMobileShellTest).toContain("const onsavedraft = mock(() => undefined)");
    expect(compactMobileShellTest).toContain("props.onsavedraft = onsavedraft");
    expect(compactMobileShellTest).toContain("screen.getbyrole(\"button\", { name: \"save draft\" })");
    expect(compactMobileShellTest).toContain("screen.querybyrole(\"button\", { name: \"back\" })).tobenull()");
    expect(compactMobileShellTest).toContain("expect(onsavedraft).tohavebeencalledtimes(1)");
    expect(compactMobileShellTest).toContain("keeps the customer-step action bar inline without a prospect cta");
    expect(compactMobileShellTest).toContain("expect(actions.getattribute(\"data-layout\")).tobe(\"inline\")");
    expect(compactMobileShellTest).toContain("disables save draft while primary action is pending");
    expect(compactMobileShellTest).toContain("expect(savedraftbutton.disabled).tobe(true)");
    expect(compactMobileShellTest).toContain("expect(onsavedraft).tohavebeencalledtimes(0)");
  });

  it("retains a reusable sticky action primitive with separate secondary and primary regions", () => {
    expect(compactStickyAction).toContain("secondary?: reactnode");
    expect(compactStickyAction).toContain("primary: reactnode");
    expect(compactStickyAction).toContain("fixed bottom action bar sitting immediately above the bottomtabbar");
    expect(compactStickyAction).toContain("{secondary && <div classname=\"shrink-0\">{secondary}</div>}");
    expect(compactStickyAction).toContain("<div classname=\"flex-1 min-w-0\">{primary}</div>");
    expect(compactStickyActionTest).toContain("renders secondary action when provided");
    expect(compactStickyActionTest).toContain("getbyrole(\"button\", { name: /save draft/i })");
  });
});
