import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "727_b54_bottom_nav_stability_closeout.sql");
const salesShell = readText("apps", "web", "src", "features", "sales", "SalesShell.tsx");
const salesShellTest = readText("apps", "web", "src", "features", "sales", "SalesShell.test.tsx");
const bottomTabBar = readText("apps", "web", "src", "features", "sales", "components", "BottomTabBar.tsx");
const bottomTabBarTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "components",
  "BottomTabBar.test.tsx",
);
const mobileTokens = readText("apps", "web", "src", "features", "sales", "lib", "mobile-design-tokens.ts");
const mobileTokensTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "lib",
  "mobile-design-tokens.test.ts",
);
const css = readText("apps", "web", "src", "index.css");
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
const quoteMobileShell = readText(
  "apps",
  "web",
  "src",
  "features",
  "quote-builder",
  "components",
  "QuoteBuilderV2PageMobileShell.tsx",
);
const quoteMobileShellTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "quote-builder",
  "components",
  "__tests__",
  "QuoteBuilderV2PageMobileShell.mobile.test.tsx",
);
const handoff = readText("docs", "operations", "QEP_ROADMAP_BLOCKER_HANDOFF_2026-05-21.md");

const compactCloseout = compact(closeoutSql);
const compactSalesShell = compact(salesShell);
const compactSalesShellTest = compact(salesShellTest);
const compactBottomTabBar = compact(bottomTabBar);
const compactBottomTabBarTest = compact(bottomTabBarTest);
const compactMobileTokens = compact(mobileTokens);
const compactMobileTokensTest = compact(mobileTokensTest);
const compactCss = compact(css);
const compactStickyAction = compact(stickyAction);
const compactStickyActionTest = compact(stickyActionTest);
const compactQuoteMobileShell = compact(quoteMobileShell);
const compactQuoteMobileShellTest = compact(quoteMobileShellTest);
const compactHandoff = compact(handoff);

describe("727_b54_bottom_nav_stability_closeout.sql contract", () => {
  it("marks only B5.4 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.4'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("mobile sales reps keep stable access");
    expect(compactCloseout).not.toContain("where task_id = 'b5.3'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.5'");
  });

  it("keeps manual and external boundaries explicit", () => {
    expect(compactCloseout).toContain("no live mobile-device uat");
    expect(compactCloseout).toContain("credential-gated playwright authenticated rep navigation was not rerun");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).toContain("does not alter runtime navigation");
  });

  it("locks SalesShell to one owned scroll root above the bottom nav", () => {
    expect(compactSalesShell).toContain("h-[100dvh]");
    expect(compactSalesShell).toContain("overflow-hidden");
    expect(compactSalesShell).toContain("data-testid=\"sales-shell-scroll-root\"");
    expect(compactSalesShell).toContain("data-scroll-owner=\"sales-shell\"");
    expect(compactSalesShell).toContain("paddingbottom: \"var(--sales-shell-bottom-scroll-padding)\"");
    expect(compactSalesShellTest).toContain("locks the viewport and makes the shell main the owned scroll root");
    expect(compactSalesShellTest).toContain("expect(shell.classname).tocontain(\"h-[100dvh]\")");
    expect(compactSalesShellTest).toContain("expect(scrollroot.getattribute(\"data-scroll-owner\")).tobe(\"sales-shell\")");
  });

  it("keeps the bottom tab height and safe-area contract centralized", () => {
    expect(compactMobileTokens).toContain("bottomtabbarheight: 64");
    expect(compactCss).toContain("--sales-shell-bottom-tab-height: 64px");
    expect(compactCss).toContain("--sales-shell-safe-area-bottom: env(safe-area-inset-bottom, 0px)");
    expect(compactCss).toContain("--sales-shell-bottom-offset: calc(");
    expect(compactCss).toContain("--sales-shell-bottom-scroll-padding: calc(");
    expect(compactMobileTokensTest).toContain("matches the salesshell css bottom-tab height custom property");
  });

  it("keeps BottomTabBar fixed, link-based, and safe-area aware", () => {
    expect(compactBottomTabBar).toContain("export const sales_bottom_tab_bar_height = mobile.bottomtabbarheight");
    expect(compactBottomTabBar).toContain("aria-label=\"sales navigation\"");
    expect(compactBottomTabBar).toContain("data-bottom-tab-height={string(sales_bottom_tab_bar_height)}");
    expect(compactBottomTabBar).toContain("data-safe-area-contract=\"height-includes-padding-bottom-once\"");
    expect(compactBottomTabBar).toContain("height: \"var(--sales-shell-bottom-offset)\"");
    expect(compactBottomTabBar).toContain("paddingbottom: \"var(--sales-shell-safe-area-bottom)\"");
    expect(compactBottomTabBar).toContain("h-[var(--sales-shell-bottom-tab-height)]");
    expect(compactBottomTabBar).toContain("min-h-[44px]");
    expect(compactBottomTabBarTest).toContain("querybyrole(\"tablist\")");
    expect(compactBottomTabBarTest).toContain("expect(nav.style.height).tobe(\"var(--sales-shell-bottom-offset)\")");
    expect(compactBottomTabBarTest).toContain("expect(nav.style.paddingbottom).tobe(\"var(--sales-shell-safe-area-bottom)\")");
  });

  it("keeps mobile action bars from colliding with the bottom nav", () => {
    expect(compactStickyAction).toContain("fixed bottom action bar sitting immediately above the bottomtabbar");
    expect(compactStickyAction).toContain("\"bottom-16\"");
    expect(compactStickyActionTest).toContain("renders primary action and clears the bottomtabbar");
    expect(compactStickyActionTest).toContain("expect(bar.classname).tocontain(\"bottom-16\")");
    expect(compactQuoteMobileShell).toContain("data-bottom-offset-contract=\"sales-shell-bottom-offset\"");
    expect(compactQuoteMobileShell).toContain("classname=\"bottom-[var(--sales-shell-bottom-offset)]\"");
    expect(compactQuoteMobileShell).toContain("includesafeareapadding={false}");
    expect(compactQuoteMobileShellTest).toContain("data-bottom-offset-contract");
    expect(compactQuoteMobileShellTest).toContain("expect(stickybar.classname).tocontain(\"bottom-[var(--sales-shell-bottom-offset)]\")");
  });

  it("retains the prior shipped gate evidence from the handoff", () => {
    expect(compactHandoff).toContain("b5.4 / qep-60");
    expect(compactHandoff).toContain("status: shipped and synced");
    expect(compactHandoff).toContain("commit: `1f23f94b`");
    expect(compactHandoff).toContain("20260520t232610z-b5.4-hf-3-bottom-nav-stability.json");
    expect(compactHandoff).toContain("gate verdict: `pass`");
    expect(compactHandoff).toContain("`bottomtabbar` fixed 64px height + safe-area contract");
  });
});
