import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/832_service_owner_controls_and_grapple_release_evidence.sql",
  ),
  "utf8",
);
const compact = sql.replace(/\s+/g, " ").toLowerCase();
const holds = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/service-hold-integrity.ts"),
  "utf8",
);
const notify = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/service-lifecycle-notify.ts"),
  "utf8",
);
const haul = readFileSync(
  join(process.cwd(), "supabase/functions/service-haul-router/index.ts"),
  "utf8",
);

describe("832 service owner controls", () => {
  it("uses exactly the five SV7 hold reasons and preserves legacy provenance", () => {
    for (
      const state of [
        "waiting_on_parts",
        "waiting_on_customer_approval",
        "waiting_on_warranty_authorization",
        "waiting_on_sublet",
        "waiting_on_payment_deposit",
      ]
    ) {
      expect(compact).toContain(`'${state}'`);
      expect(holds).toContain(`"${state}"`);
    }
    expect(compact).toContain("[pre-sv7 hold:");
    expect(holds).not.toContain(
      '"waiting_on_parts_sublet",\n  "waiting_on_approval"',
    );
    expect(notify).toContain('context.blockerType === "waiting_on_parts"');
  });

  it("requires a verified dedicated driver profile and append-only evidence", () => {
    expect(compact).toContain("create table public.service_driver_profiles");
    expect(compact).toContain(
      "driver assignment requires a verified dispatchable service driver profile",
    );
    expect(compact).toContain("service_driver_accountability_events");
    expect(compact).toContain("route taken is intentionally prohibited");
    expect(compact).toContain("evidence ? 'route_geometry'");
    expect(compact).toContain(
      "create or replace function public.service_validate_driver_profile_provenance",
    );
    expect(compact).toContain(
      "pw.workspace_id = new.workspace_id",
    );
    expect(compact).toContain(
      "b.workspace_id = new.workspace_id",
    );
    expect(compact).toContain(
      "new.roster_verified_by is distinct from (select auth.uid())",
    );
    expect(compact).toContain(
      "service driver verification must be attributed to the authenticated verifier",
    );
    expect(compact).toContain(
      "new.profile_id is distinct from old.profile_id",
    );
    expect(compact).toContain(
      "new.is_dispatchable and not old.is_dispatchable",
    );
    expect(compact).toContain(
      "before insert or update of workspace_id, driver_id, service_driver_profile_id",
    );
    expect(compact).toContain(
      "service_driver_profile_id is derived evidence",
    );
    expect(compact).toContain(
      "new.service_driver_profile_id := v_driver.id",
    );
    expect(compact).toContain(
      "recorded_by uuid not null references public.profiles(id) on delete restrict",
    );
    expect(compact).toContain(
      "driver evidence recorder must be an active member of the ticket workspace",
    );
    expect(compact).toContain(
      "driver evidence must be attributed to the authenticated recorder",
    );
    expect(haul).toContain('from("service_driver_profiles")');
    expect(haul).toContain("service_driver_profile_id: serviceDriverProfileId");
  });

  it("keeps manual mileage zero-blocking but makes review durable", () => {
    expect(compact).toContain("service_manual_mileage_reviews");
    expect(compact).toContain("review_manual_service_mileage");
    expect(compact).toContain("v_service_manual_mileage_review_queue");
    expect(compact).toContain("'pending_review'");
    expect(compact).toContain("append-only");
    expect(compact).toContain(
      "alter table public.service_manual_mileage_reviews force row level security",
    );
    expect(compact).toContain(
      "revoke insert, update, delete, truncate on public.service_manual_mileage_reviews",
    );
    expect(compact).toContain("p_reviewer_id uuid");
    expect(compact).toContain(
      "p_reviewer_id is distinct from v_reviewer_id",
    );
    expect(compact).toContain(
      "v_review.review_note is distinct from v_review_note",
    );
    expect(compact).toContain(
      "v_review.reviewed_by is distinct from v_reviewer_id",
    );
    expect(compact).not.toContain(
      "trim(p_review_note), (select auth.uid()), v_snapshot",
    );
  });

  it("adds the full SV20 Service Manager release evidence gate", () => {
    expect(compact).toContain("grapple_build_service_manager_releases");
    expect(compact).toContain("completed_build_sheet_reference");
    expect(compact).toContain("test_run_documentation");
    expect(compact).toContain("serial_component_records");
    expect(compact).toContain("finished_unit_photos");
    expect(compact).toContain("zz_grapple_service_manager_release_gate");
    expect(compact).toContain("service_manager_evidence_missing");
    expect(compact).toContain(
      "or old.status is distinct from new.status",
    );
    expect(compact).toContain(
      "grapple release requires a nonblank idempotency key",
    );
    expect(compact).toContain(
      "alter table public.grapple_build_service_manager_releases force row level security",
    );
    expect(compact).toContain(
      "(select auth.role()) is distinct from 'service_role' and v_build.workspace_id is distinct from public.get_my_workspace()",
    );
    expect(compact).not.toContain(
      "(select auth.role()) <> 'service_role'",
    );
    expect(compact).toContain(
      "revoke insert, update, delete, truncate on public.grapple_build_service_manager_releases",
    );
    expect(compact).not.toContain("p.workspace_id = p_workspace_id");
  });

  it("does not claim the missing roster, retail rates, or scorecard metrics", () => {
    expect(compact).toContain("the unanswered roster is not seeded");
    expect(compact).not.toContain("insert into public.service_driver_profiles");
    expect(compact).not.toContain(
      "insert into public.service_haul_rate_sheets",
    );
    expect(compact).not.toContain("grapple_scorecard_metric");
  });

  it("records roadmap evidence with mission alignment", () => {
    for (const task of ["h4.1", "h7.1", "h15.1", "i6.1"]) {
      expect(compact).toContain(`'${task}'`);
    }
    expect(compact).toContain("qep_roadmap_sync_events");
    expect(compact).toContain("mission_alignment");
    expect(compact).toContain("backend_ready_roster_required");
    expect(compact).toContain("backend_ready_review_ui_follow_on");
    expect(compact).toContain("backend_ready_capture_ui_follow_on");
    expect(compact).not.toContain("set ship_state = 'shipped'");
  });
});
