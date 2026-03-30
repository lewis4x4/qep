import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { loadOrCreateImportState } from "./run-state.ts";
import type { ImportRunRow } from "./types.ts";

interface MockPostgrestError {
  message: string;
}

type MaybeSingleResponse = {
  data: ImportRunRow | null;
  error: MockPostgrestError | null;
};

type SingleResponse = {
  data: ImportRunRow | null;
  error: MockPostgrestError | null;
};

class MockImportRunsQueryBuilder {
  insertedPayload: Record<string, unknown> | null = null;

  constructor(
    private readonly maybeSingleResponse: MaybeSingleResponse,
    private readonly singleResponse: SingleResponse,
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(_column: string, _value: unknown): this {
    return this;
  }

  maybeSingle(): Promise<MaybeSingleResponse> {
    return Promise.resolve(this.maybeSingleResponse);
  }

  insert(payload: Record<string, unknown>): this {
    this.insertedPayload = payload;
    return this;
  }

  single(): Promise<SingleResponse> {
    return Promise.resolve(this.singleResponse);
  }
}

class MockSupabase {
  constructor(
    readonly importRunsBuilder: MockImportRunsQueryBuilder,
  ) {}

  from(table: string): MockImportRunsQueryBuilder {
    if (table !== "crm_hubspot_import_runs") {
      throw new Error(`Unexpected table: ${table}`);
    }
    return this.importRunsBuilder;
  }
}

function makeImportRunRow(overrides: Partial<ImportRunRow> = {}): ImportRunRow {
  return {
    id: "run-1",
    workspace_id: "workspace-a",
    initiated_by: "user-1",
    metadata: {},
    contacts_processed: 0,
    companies_processed: 0,
    deals_processed: 0,
    activities_processed: 0,
    error_count: 0,
    ...overrides,
  };
}

Deno.test("loadOrCreateImportState rejects resume when run belongs to another workspace", async () => {
  const mock = new MockSupabase(
    new MockImportRunsQueryBuilder(
      {
        data: makeImportRunRow({ workspace_id: "workspace-b" }),
        error: null,
      },
      { data: null, error: null },
    ),
  );

  await assertRejects(
    () =>
      loadOrCreateImportState(
        mock as unknown as SupabaseClient<any, "public", any>,
        "run-1",
        "user-1",
        "workspace-a",
      ),
    Error,
    "RUN_WORKSPACE_FORBIDDEN",
  );
});

Deno.test("loadOrCreateImportState rejects resume when run was started by another actor", async () => {
  const mock = new MockSupabase(
    new MockImportRunsQueryBuilder(
      {
        data: makeImportRunRow({ initiated_by: "user-2" }),
        error: null,
      },
      { data: null, error: null },
    ),
  );

  await assertRejects(
    () =>
      loadOrCreateImportState(
        mock as unknown as SupabaseClient<any, "public", any>,
        "run-1",
        "user-1",
        "workspace-a",
      ),
    Error,
    "RUN_ACTOR_FORBIDDEN",
  );
});

Deno.test("loadOrCreateImportState creates a run using caller workspace", async () => {
  const createdRun = makeImportRunRow({
    id: "run-created",
    workspace_id: "workspace-z",
    initiated_by: "user-1",
  });
  const builder = new MockImportRunsQueryBuilder(
    { data: null, error: null },
    { data: createdRun, error: null },
  );
  const mock = new MockSupabase(builder);

  const state = await loadOrCreateImportState(
    mock as unknown as SupabaseClient<any, "public", any>,
    undefined,
    "user-1",
    "workspace-z",
  );

  assertEquals(builder.insertedPayload?.workspace_id, "workspace-z");
  assertEquals(builder.insertedPayload?.initiated_by, "user-1");
  assertEquals(state.runId, "run-created");
  assertEquals(state.workspaceId, "workspace-z");
});
