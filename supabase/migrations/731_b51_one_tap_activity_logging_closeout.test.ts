import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "731_b51_one_tap_activity_logging_closeout.sql");
const salesApi = readText("apps", "web", "src", "features", "sales", "lib", "sales-api.ts");
const salesApiTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "lib",
  "__tests__",
  "sales-api.log-sales-activity.test.ts",
);
const dealCard = readText("apps", "web", "src", "features", "sales", "components", "SalesDealCard.tsx");
const customerCard = readText("apps", "web", "src", "features", "sales", "components", "SalesCustomerCard.tsx");
const actionItemCard = readText("apps", "web", "src", "features", "sales", "components", "ActionItemCard.tsx");
const quickLogSheet = readText("apps", "web", "src", "features", "sales", "components", "QuickLogSheet.tsx");
const customerCardTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "components",
  "SalesCustomerCard.one-tap.test.tsx",
);

const compactCloseout = compact(closeoutSql);
const compactSalesApi = compact(salesApi);
const compactSalesApiTest = compact(salesApiTest);
const compactDealCard = compact(dealCard);
const compactCustomerCard = compact(customerCard);
const compactActionItemCard = compact(actionItemCard);
const compactQuickLogSheet = compact(quickLogSheet);
const compactCustomerCardTest = compact(customerCardTest);

describe("731_b51_one_tap_activity_logging_closeout.sql contract", () => {
  it("marks only B5.1 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("one tap");
    expect(compactCloseout).toContain("auditable crm memory");
    expect(compactCloseout).not.toContain("where task_id = 'b5.2'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.6'");
  });

  it("keeps live interaction and database apply boundaries explicit", () => {
    expect(compactCloseout).toContain("no live phone call");
    expect(compactCloseout).toContain("no manual sales-rep uat");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
    expect(compactCloseout).toContain("does not alter telephony, email, routing, or crm_activities runtime behavior");
  });

  it("uses one shared authenticated CRM activity insert path", () => {
    expect(compactSalesApi).toContain("export async function logsalesactivity");
    expect(compactSalesApi).toContain("supabase.auth.getuser()");
    expect(compactSalesApi).toContain("if (!user) throw new error(\"not authenticated\")");
    expect(compactSalesApi).toContain("const wsid = await getworkspaceid()");
    expect(compactSalesApi).toContain("buildsalesactivityinsertpayload");
    expect(compactSalesApi).toContain("subject: { dealid: params.dealid, companyid: params.companyid }");
    expect(compactSalesApi).toContain("supabase.from(\"crm_activities\").insert(payload)");
  });

  it("locks deal precedence, customer subjects, auth, and subject guards in focused tests", () => {
    expect(compactSalesApiTest).toContain("deal tap inserts deal_id subject and clears company_id");
    expect(compactSalesApiTest).toContain("deal_id: \"deal-1\"");
    expect(compactSalesApiTest).toContain("company_id: null");
    expect(compactSalesApiTest).toContain("customer tap inserts company_id subject with no deal_id");
    expect(compactSalesApiTest).toContain("company_id: \"company-9\"");
    expect(compactSalesApiTest).toContain("deal_id: null");
    expect(compactSalesApiTest).toContain("throws before insert when the rep is not authenticated");
    expect(compactSalesApiTest).toContain("throws before insert when no deal or customer subject is supplied");
    expect(compactSalesApiTest).toContain("visit quick action inserts the db meeting activity type");
    expect(compactSalesApiTest).toContain("activity_type: \"meeting\"");
  });

  it("wires one-tap sales cards through logSalesActivity without subject ambiguity", () => {
    expect(compactDealCard).toContain("await logsalesactivity({");
    expect(compactDealCard).toContain("activitytype: \"call\"");
    expect(compactDealCard).toContain("dealid: deal.deal_id");
    expect(compactDealCard).toContain("companyid: deal.company_id");
    expect(compactDealCard).toContain("window.location.href = `tel:${deal.primary_contact_phone}`");
    expect(compactCustomerCard).toContain("activitytype: \"call\"");
    expect(compactCustomerCard).toContain("activitytype: \"email\"");
    expect(compactCustomerCard).toContain("companyid: customer.customer_id");
    expect(compactCustomerCard).toContain("window.location.href = `tel:${customer.primary_contact_phone}`");
    expect(compactCustomerCard).toContain("window.location.href = `mailto:${customer.primary_contact_email}`");
    expect(compactCustomerCardTest).toContain("call will continue, but activity logging failed");
    expect(compactCustomerCardTest).toContain("email will continue, but activity logging failed");
  });

  it("logs priority actions and blocks subjectless quick sheet writes", () => {
    expect(compactActionItemCard).toContain("activitytype: cta.icon === \"phone\" ? \"call\" : \"email\"");
    expect(compactActionItemCard).toContain("dealid: deal.deal_id");
    expect(compactActionItemCard).toContain("companyid: deal.company_id");
    expect(compactActionItemCard).toContain("the action can continue, but activity logging failed");
    expect(compactQuickLogSheet).toContain("const hassubject = boolean(dealid || companyid)");
    expect(compactQuickLogSheet).toContain("if (!hassubject)");
    expect(compactQuickLogSheet).toContain("activity subject required");
    expect(compactQuickLogSheet).toContain("await logsalesactivity({");
    expect(compactQuickLogSheet).toContain("activitytype: type");
    expect(compactQuickLogSheet).toContain("companyid,");
    expect(compactQuickLogSheet).toContain("dealid,");
    expect(compactQuickLogSheet).toContain("disabled={saving || !hassubject}");
  });
});
