import { describe, expect, it } from "bun:test";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "747_e21_ui_brand_guide_compliance_closeout.sql");
const audit = readText("docs", "reviews", "QEP_E2_1_UI_BRAND_GUIDE_COMPLIANCE_AUDIT_2026-05-21.md");
const verifier = readText("scripts", "verify", "brand-guide-compliance-audit.mjs");
const css = readText("apps", "web", "src", "index.css");
const tailwindConfig = readText("apps", "web", "tailwind.config.js");
const packageJson = JSON.parse(readText("package.json"));

const compactCloseout = compact(closeoutSql);
const compactAudit = compact(audit);
const compactVerifier = compact(verifier);
const compactCss = compact(css);
const compactTailwindConfig = compact(tailwindConfig);

describe("747_e21_ui_brand_guide_compliance_closeout.sql contract", () => {
  it("marks only E2.1 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'e2.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("ui brand-guide compliance audit");
    expect(compactCloseout).not.toContain("where task_id = 'e2.2'");
    expect(compactCloseout).not.toContain("where task_id = 'e5.1'");
  });

  it("pins the audit report as an audit baseline rather than visual remediation", () => {
    expect(compactAudit).toContain("roadmap item: e2.1 / qep-124");
    expect(compactAudit).toContain("status: complete audit baseline");
    expect(compactAudit).toContain("surface inventory");
    expect(compactAudit).toContain("customer-facing surfaces");
    expect(compactAudit).toContain("operational surfaces");
    expect(compactAudit).toContain("admin/internal surfaces");
    expect(compactAudit).toContain("shared shell/component surfaces");
    expect(compactAudit).toContain("raw color exceptions");
    expect(compactAudit).toContain("follow-up remediation queue");
    expect(compactAudit).toContain("remediation of the raw color exceptions is intentionally deferred");
    expect(compactCloseout).toContain("does not claim all raw colors are remediated");
    expect(compactCloseout).toContain("ryan or owner visual signoff remains a separate workshop/signoff row");
  });

  it("keeps canonical brand artifacts and verifier wiring intact", () => {
    expect(lstatSync(join(process.cwd(), "docs", "qep_brand_guide.pdf")).isSymbolicLink()).toBe(true);
    expect(compactAudit).toContain("docs/qep_brand_guide.pdf");
    expect(compactAudit).toContain("docs/brand guide qep.pdf");
    expect(compactVerifier).toContain("const canonicalbrandguide");
    expect(compactVerifier).toContain("docs/qep_brand_guide.pdf");
    expect(compactVerifier).toContain("docs/brand guide qep.pdf");
    expect(packageJson.scripts["brand:guide:audit"]).toBe("bun ./scripts/verify/brand-guide-compliance-audit.mjs");
  });

  it("pins the source-controlled QEP token baseline and Tailwind bridge", () => {
    for (const token of [
      "--qep-orange",
      "--qep-orange-accessible",
      "--qep-dark",
      "--qep-charcoal",
      "--qep-slate",
      "--qep-gray",
      "--qep-light-gray",
      "--qep-bg",
      "--qep-live",
      "--qep-hot",
      "--qep-warm",
      "--qep-cold",
    ]) {
      expect(compactCss).toContain(token);
    }

    for (const utility of [
      '"qep-orange"',
      '"qep-orange-accessible"',
      '"qep-dark"',
      '"qep-charcoal"',
      '"qep-slate"',
      '"qep-gray"',
      '"qep-light-gray"',
      '"qep-bg"',
      '"qep-live"',
      '"qep-hot"',
      '"qep-warm"',
      '"qep-cold"',
    ]) {
      expect(compactTailwindConfig).toContain(utility);
    }
  });

  it("proves the verifier inventories production UI surfaces and exceptions", () => {
    expect(compactVerifier).toContain("apps/web/src");
    expect(compactVerifier).toContain("ui files scanned");
    expect(compactVerifier).toContain("surface files inventoried");
    expect(compactVerifier).toContain("raw hex color occurrences");
    expect(compactVerifier).toContain("ignoredpathparts");
    expect(compactVerifier).toContain("/__tests__/");
    expect(compactVerifier).toContain(".test.");
    expect(compactVerifier).toContain(".spec.");
    expect(compactVerifier).toContain("customerfacing");
    expect(compactVerifier).toContain("operational");
    expect(compactVerifier).toContain("admininternal");
    expect(compactVerifier).toContain("shared");
  });

  it("keeps db push and broad visual follow-up boundaries explicit", () => {
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).toContain("changes roadmap status only");
    expect(compactCloseout).toContain("raw-color remediation remains intentionally queued");
    expect(compactCloseout).toContain("future raw-color tokenization requires separate visual qa");
  });
});
