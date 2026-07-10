import { assertEquals } from "jsr:@std/assert@1";
import { IRON_ACTION_REGISTRY, parseIronFollowUpAt } from "./iron-actions.ts";

Deno.test("Iron follow-up date parser handles operator shorthand", () => {
  const now = new Date("2026-05-13T16:00:00.000Z"); // Wednesday

  assertEquals(
    parseIronFollowUpAt("tomorrow", now),
    "2026-05-14T14:00:00.000Z",
  );
  assertEquals(
    parseIronFollowUpAt("next Tuesday", now),
    "2026-05-19T14:00:00.000Z",
  );
  assertEquals(
    parseIronFollowUpAt("in 3 days at 2:30pm", now),
    "2026-05-16T14:30:00.000Z",
  );
});

Deno.test("Iron follow-up action is registered", () => {
  assertEquals(Boolean(IRON_ACTION_REGISTRY.iron_schedule_follow_up), true);
  assertEquals(
    IRON_ACTION_REGISTRY.iron_schedule_follow_up.affects_modules.includes(
      "qrm",
    ),
    true,
  );
});

function rentalContext(input: {
  workspace?: string;
  userId?: string;
  slotActorId?: string;
}) {
  const workspace = input.workspace ?? "alpha";
  return {
    event: {
      event_id: "event-1",
      flow_event_type: "iron.rental.open",
      source_module: "iron",
      workspace_id: workspace,
      entity_type: null,
      entity_id: null,
      occurred_at: "2026-07-10T12:00:00.000Z",
      correlation_id: "corr-1",
      parent_event_id: null,
      properties: {
        user_id: input.userId,
        slots: {
          qrm_company_id: "10000000-0000-4000-8000-000000000001",
          start_date: "2026-07-10",
          end_date: "2026-07-17",
          actor_id: input.slotActorId,
        },
      },
    },
  };
}

Deno.test("Iron rental rejects an actor outside the event workspace before insert", async () => {
  const touchedTables: string[] = [];
  const admin = {
    from(table: string) {
      touchedTables.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === "qrm_companies"
              ? { data: { id: "company" }, error: null }
              : { data: null, error: null },
          ),
      };
      return builder;
    },
  };
  const result = await IRON_ACTION_REGISTRY.iron_open_rental_contract.execute(
    {},
    rentalContext({
      userId: "20000000-0000-4000-8000-000000000099",
    }),
    {
      admin,
      workspace_id: "alpha",
      run_id: "run-1",
      step_index: 0,
      dry_run: false,
    },
  );

  assertEquals(result.status, "failed");
  assertEquals(
    result.status === "failed" ? result.error : "",
    "iron_open_rental_contract: actor is not a member of the workspace",
  );
  assertEquals(touchedTables.includes("rental_contracts"), false);
});

Deno.test("Iron rental ignores slot actor spoofing and stamps the verified event actor", async () => {
  const verifiedActor = "20000000-0000-4000-8000-000000000001";
  let insertedOriginator: unknown = null;
  const admin = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "profile_workspaces"
              ? { profile_id: verifiedActor }
              : { id: "company" },
            error: null,
          }),
        insert: (payload: Record<string, unknown>) => {
          insertedOriginator = payload.originated_by;
          return builder;
        },
        single: () =>
          Promise.resolve({
            data: {
              id: "30000000-0000-4000-8000-000000000001",
              contract_number: "R-1",
            },
            error: null,
          }),
      };
      return builder;
    },
  };
  const result = await IRON_ACTION_REGISTRY.iron_open_rental_contract.execute(
    {},
    rentalContext({
      userId: verifiedActor,
      slotActorId: "20000000-0000-4000-8000-000000000099",
    }),
    {
      admin,
      workspace_id: "alpha",
      run_id: "run-1",
      step_index: 0,
      dry_run: false,
    },
  );

  assertEquals(result.status, "succeeded");
  assertEquals(insertedOriginator, verifiedActor);
});
