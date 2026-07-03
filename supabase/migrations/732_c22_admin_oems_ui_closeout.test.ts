import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = read("supabase", "migrations", "732_c22_admin_oems_ui_closeout.sql");
const appTsx = read("apps", "web", "src", "App.tsx");
const adminPage = read("apps", "web", "src", "components", "AdminPage.tsx");
const oemsPage = read("apps", "web", "src", "features", "admin", "pages", "OemsPage.tsx");
const oemsApi = read("apps", "web", "src", "features", "admin", "lib", "oems-api.ts");
const oemsApiTest = read("apps", "web", "src", "features", "admin", "lib", "__tests__", "oems-api.test.ts");
const oemsPageTest = read("apps", "web", "src", "features", "admin", "pages", "__tests__", "OemsPage.integration.test.tsx");

const compactCloseout = compact(closeoutSql);
const compactApp = compact(appTsx);
const compactAdminPage = compact(adminPage);
const compactOemsPage = compact(oemsPage);
const compactOemsApi = compact(oemsApi);
const compactOemsApiTest = compact(oemsApiTest);
const compactOemsPageTest = compact(oemsPageTest);

describe("732_c22_admin_oems_ui_closeout.sql contract", () => {
  it("marks only C2.2 shipped and records mission/manual boundaries", () => {
    expect(compactCloseout).toContain("where task_id = 'c2.2'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("qep_roadmap_sync_events");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("manual_boundaries");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).not.toContain("where task_id = 'c2.1'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.3'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.5'");
    expect(compactCloseout).not.toContain("where task_id = 'c2.6'");
    expect(compactCloseout).not.toContain("where task_id = 'd2.3'");
  });

  it("keeps parser, sample-import, and external OEM rows out of scope", () => {
    expect(compactCloseout).toContain("pdf parser");
    expect(compactCloseout).toContain("asv/yanmar sample import");
    expect(compactCloseout).toContain("bobcat");
    expect(compactCloseout).toContain("vermeer");
    expect(compactCloseout).toContain("does not ingest or claim any live oem files");
    expect(compactCloseout).toContain("ycena parser and asv/yanmar sample import evidence are governed by c2.3 and c2.4");
  });

  it("registers the /admin/oems route behind manager/admin access", () => {
    expect(compactApp).toContain("const oemspage = lazy(() => import(\"./features/admin/pages/oemspage\")");
    expect(compactApp).toContain("path=\"/admin/oems\"");
    expect(compactApp).toContain("[\"admin\", \"manager\", \"owner\"].includes(profile.role) ? ( <oemspage /> ) : ( <navigate to=\"/dashboard\" replace /> )");
  });

  it("exposes the admin launch point with dealer-cost resolver copy", () => {
    expect(compactAdminPage).toContain("label: \"oem cost resolver\"");
    expect(compactAdminPage).toContain("test list price to dealer cost by oem tier before importer publish.");
    expect(compactAdminPage).toContain("href: \"/admin/oems\"");
  });

  it("provides the OEM test-calculation workflow in the page", () => {
    expect(compactOemsPage).toContain("<requireadmin>");
    expect(compactOemsPage).toContain("listoems()");
    expect(compactOemsPage).toContain("test calculation");
    expect(compactOemsPage).toContain("aria-label=\"oem\"");
    expect(compactOemsPage).toContain("aria-label=\"list price\"");
    expect(compactOemsPage).toContain("aria-label=\"effective date\"");
    expect(compactOemsPage).toContain("resolveoemdealercost({");
    expect(compactOemsPage).toContain("oemkey: selectedoem?.parentoemkey ?? selectedoemkey");
    expect(compactOemsPage).toContain("brandkey: selectedoemkey");
    expect(compactOemsPage).toContain("resolve dealer cost");
    expect(compactOemsPage).toContain("resolved tier");
    expect(compactOemsPage).toContain("dealer cost");
    expect(compactOemsPage).toContain("discount");
    expect(compactOemsPage).toContain("parent oem");
    expect(compactOemsPage).toContain("source");
  });

  it("uses active non-deleted OEM rows and the resolver RPC adapter", () => {
    expect(compactOemsApi).toContain("db().from(\"oems\")");
    expect(compactOemsApi).toContain("id,oem_key,parent_oem_key,display_name,category,source_format,price_sheet_cadence,active");
    expect(compactOemsApi).toContain("selected.eq(\"active\", true)");
    expect(compactOemsApi).toContain("active.is(\"deleted_at\", null)");
    expect(compactOemsApi).toContain("notdeleted.order(\"display_name\", { ascending: true })");
    expect(compactOemsApi).toContain("db().rpc(\"resolve_oem_cost\"");
    expect(compactOemsApi).toContain("p_oem_key: input.oemkey");
    expect(compactOemsApi).toContain("p_brand_key: input.brandkey ?? input.oemkey");
    expect(compactOemsApi).toContain("p_list_price_cents: input.listpricecents");
    expect(compactOemsApi).toContain("p_effective_on: input.effectiveon || null");
  });

  it("pins normalizer, money, and page integration coverage", () => {
    expect(compactOemsApiTest).toContain("normalizes valid oem rows and drops invalid rows");
    expect(compactOemsApiTest).toContain("normalizes resolver rows");
    expect(compactOemsApiTest).toContain("parses and formats money");
    expect(compactOemsApiTest).toContain("parsedollarinput(\"$100,000.55\")");
    expect(compactOemsApiTest).toContain("formatcentsasdollars(7000000)");
    expect(compactOemsPageTest).toContain("renders oems and resolves dealer cost via rpc");
    expect(compactOemsPageTest).toContain("expect(args.p_oem_key).tobe(\"ycena\")");
    expect(compactOemsPageTest).toContain("expect(args.p_brand_key).tobe(\"asv\")");
    expect(compactOemsPageTest).toContain("expect(args.p_list_price_cents).tobe(10000000)");
    expect(compactOemsPageTest).toContain("screen.getbytext(\"$70,000.00\")");
    expect(compactOemsPageTest).toContain("screen.getbytext(\"30.00%\")");
    expect(compactOemsPageTest).toContain("screen.getbytext(\"asv-price-book.pdf\")");
  });
});
