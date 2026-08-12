import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeout = compact(read("supabase", "migrations", "835_h91_service_plan_staff_ui_closeout.sql"));
const plansPage = compact(read("apps", "web", "src", "features", "service", "pages", "ServicePlansPage.tsx"));
const agreementPage = compact(read("apps", "web", "src", "features", "service", "pages", "ServiceAgreementDetailPage.tsx"));
const planUtils = compact(read("apps", "web", "src", "features", "service", "lib", "service-plan-utils.ts"));
const planPageTest = compact(read("apps", "web", "src", "features", "service", "pages", "__tests__", "ServicePlansPage.integration.test.tsx"));

describe("835 H9.1 service-plan staff UI closeout", () => {
  it("marks only H9.1 shipped with mission and safety evidence", () => {
    expect(closeout).toContain("set ship_state = 'shipped'");
    expect(closeout).toContain("where task_id = 'h9.1'");
    expect(closeout).toContain("qep_roadmap_sync_events");
    expect(closeout).toContain("mission_alignment");
    expect(closeout).toContain("safety_bounds");
    expect(closeout).toContain("manual_boundaries");
    expect(closeout).toContain("does not claim that any provisional blackrock seed program has been reviewed or activated");
    expect(closeout).toContain("drop policy if exists \"svc_agreements_insert\"");
    expect(closeout).toContain("drop policy if exists \"svc_agreements_update\"");
    expect(closeout).toContain("public.get_my_role()) in ('admin', 'manager', 'owner')");
  });

  it("pins separate recorded review and guarded activation actions", () => {
    expect(plansPage).toContain("reviewserviceplanprogram({");
    expect(plansPage).toContain("setserviceplanprogramactivation({");
    expect(plansPage).toContain("review recorded");
    expect(plansPage).toContain("recorded {selectedprogram.reviewed_at");
    expect(planUtils).toContain("program.review_status !== \"reviewed\"");
    expect(planUtils).toContain("!program.reviewed_by");
    expect(planUtils).toContain("!program.reviewed_at");
    expect(planUtils).toContain("!program.review_notes?.trim()");
  });

  it("keeps enrollment fail closed until catalog evidence resolves", () => {
    expect(planUtils).toContain("if (input.programisactive !== true)");
    expect(planUtils).toContain("if (input.programreviewed !== true)");
    expect(planUtils).toContain("if (input.programprovisional !== false)");
    expect(agreementPage).toContain("enrollserviceplanequipment({");
    expect(agreementPage).toContain("disabled={enrollmutation.ispending || !enrollmentreadiness?.ready}");
    expect(agreementPage).toContain("disabled={!canmutate || updateagreement.ispending || boolean(enrollmentquery.data)}");
  });

  it("routes prompt handling through the generated job and controlled cancellation RPC", () => {
    expect(plansPage).toContain("listopenserviceplanscheduleprompts");
    expect(plansPage).toContain("encodeuricomponent(prompt.service_job_id)");
    expect(plansPage).toContain("cancelserviceplanpmdueevent({");
    expect(plansPage).toContain("cancellationkind: \"cancelled\"");
    expect(planPageTest).toContain("requires a reason and uses the controlled pm cancellation action");
    expect(planPageTest).toContain("expect(cancelbutton.disabled).tobe(true)");
  });
});
