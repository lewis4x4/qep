import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { crmSearch, type RouterCtx } from "./crm-router-service.ts";

// Lightweight Supabase query-builder stub. Each call to .from() returns a
// thenable chain whose terminal operation resolves to a pre-canned result.
// We capture which tables were queried so we can assert behavior without
// running a real Postgres instance — this is the same pattern we use for
// the dge edge-function tests.
interface TableResult {
  data: Array<Record<string, unknown>> | null;
  error: Error | null;
}

function makeStubClient(tableResults: Record<string, TableResult>): {
  client: SupabaseClient;
  calls: string[];
} {
  const calls: string[] = [];

  const makeQuery = (table: string) => {
    const result = tableResults[table] ?? { data: [], error: null };
    calls.push(table);

    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      ilike: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(result),
      then: (resolve: (value: TableResult) => unknown) => resolve(result),
    };
    return builder;
  };

  const client = {
    from: (table: string) => makeQuery(table),
  } as unknown as SupabaseClient;

  return { client, calls };
}

function makeRouterCtx(callerDb: SupabaseClient): RouterCtx {
  return {
    admin: {} as SupabaseClient,
    callerDb,
    caller: {
      authHeader: "Bearer token",
      userId: "user-1",
      role: "rep",
      isServiceRole: false,
      workspaceId: "default",
    },
    workspaceId: "default",
    requestId: "req-search",
    route: "/qrm/search",
    method: "GET",
    ipInet: null,
    userAgent: null,
  };
}

Deno.test("crmSearch returns empty for blank query", async () => {
  const { client } = makeStubClient({});
  const results = await crmSearch(makeRouterCtx(client), "   ", "contact,company");
  assertEquals(results, []);
});

Deno.test("crmSearch defaults to all entity types when types arg is blank", async () => {
  const { client, calls } = makeStubClient({
    crm_companies: { data: [], error: null },
    crm_contacts: { data: [], error: null },
    crm_deals_rep_safe: { data: [], error: null },
    crm_equipment: { data: [], error: null },
    rental_contracts: { data: [], error: null },
  });

  await crmSearch(makeRouterCtx(client), "acme", "");

  // All five tables should have been queried exactly once.
  assertEquals(calls.sort(), [
    "crm_companies",
    "crm_contacts",
    "crm_deals_rep_safe",
    "crm_equipment",
    "rental_contracts",
  ]);
});

Deno.test("crmSearch narrows to a single type when requested", async () => {
  const { client, calls } = makeStubClient({
    crm_companies: { data: [], error: null },
  });

  await crmSearch(makeRouterCtx(client), "acme", "company");

  assertEquals(calls, ["crm_companies"]);
});

Deno.test("crmSearch filters out unknown types quietly", async () => {
  // "robot" isn't a real entity type — crmSearch should ignore it and still
  // search the valid type in the same comma-separated argument.
  const { client, calls } = makeStubClient({
    crm_companies: { data: [], error: null },
  });

  await crmSearch(makeRouterCtx(client), "acme", "robot,company");

  assertEquals(calls, ["crm_companies"]);
});

Deno.test("crmSearch shapes company rows with a location subtitle", async () => {
  const { client } = makeStubClient({
    crm_companies: {
      data: [
        {
          id: "c-1",
          name: "Acme Drilling",
          city: "Denver",
          state: "CO",
          country: "USA",
          updated_at: "2026-04-18T00:00:00Z",
        },
      ],
      error: null,
    },
  });

  const results = await crmSearch(makeRouterCtx(client), "acme", "company");
  assertEquals(results.length, 1);
  assertEquals(results[0].type, "company");
  assertEquals(results[0].title, "Acme Drilling");
  assertEquals(results[0].subtitle, "Denver, CO, USA");
});

Deno.test("crmSearch shapes deal rows with amount + close date subtitle", async () => {
  const { client } = makeStubClient({
    crm_deals_rep_safe: {
      data: [
        {
          id: "d-1",
          name: "Acme CAT 305 Purchase",
          amount: 125000,
          expected_close_on: "2026-05-01",
          updated_at: "2026-04-20T00:00:00Z",
        },
      ],
      error: null,
    },
  });

  const results = await crmSearch(makeRouterCtx(client), "acme", "deal");
  assertEquals(results.length, 1);
  assertEquals(results[0].type, "deal");
  assertEquals(results[0].title, "Acme CAT 305 Purchase");
  // Formatted amount + close on date, joined by " · "
  assertEquals(results[0].subtitle, "$125,000 · close 2026-05-01");
});

Deno.test("crmSearch shapes equipment rows with year/make/model title", async () => {
  const { client } = makeStubClient({
    crm_equipment: {
      data: [
        {
          id: "e-1",
          name: "Yard #3",
          make: "Caterpillar",
          model: "305",
          year: 2023,
          asset_tag: "CAT-305-A",
          serial_number: "SN-1",
          vin_pin: "VIN-ABC",
          availability: "available",
          updated_at: "2026-04-15T00:00:00Z",
        },
      ],
      error: null,
    },
  });

  const results = await crmSearch(makeRouterCtx(client), "cat", "equipment");
  assertEquals(results.length, 1);
  assertEquals(results[0].type, "equipment");
  assertEquals(results[0].title, "2023 Caterpillar 305");
  assertEquals(results[0].subtitle, "Tag CAT-305-A · VIN VIN-ABC · available");
});

Deno.test("crmSearch rental rows survive an RLS permission error", async () => {
  // Rentals may be hidden from certain roles; a permission error should NOT
  // poison the whole search. We assert: other types still return, the rentals
  // slice silently returns nothing.
  const { client } = makeStubClient({
    crm_companies: {
      data: [
        {
          id: "c-9",
          name: "West Coast Equipment",
          city: null,
          state: null,
          country: null,
          updated_at: "2026-04-10T00:00:00Z",
        },
      ],
      error: null,
    },
    rental_contracts: { data: null, error: new Error("RLS: forbidden") },
  });

  const results = await crmSearch(
    makeRouterCtx(client),
    "west",
    "company,rental",
  );
  // One company result, zero rental results.
  assertEquals(results.length, 1);
  assertEquals(results[0].type, "company");
});

Deno.test("crmSearch ranks prefix matches ahead of infix matches", async () => {
  // If the query prefix-matches one row and infix-matches another, the prefix
  // match should come first in the output.
  const { client } = makeStubClient({
    crm_companies: {
      data: [
        {
          id: "c-infix",
          name: "Rock Acme Materials",    // infix "acme"
          city: null,
          state: null,
          country: null,
          updated_at: "2026-04-20T00:00:00Z",
        },
        {
          id: "c-prefix",
          name: "Acme Drilling",           // prefix "acme"
          city: null,
          state: null,
          country: null,
          updated_at: "2026-04-10T00:00:00Z",
        },
      ],
      error: null,
    },
  });

  const results = await crmSearch(makeRouterCtx(client), "acme", "company");
  assertEquals(results.length, 2);
  // Prefix match must come first even though its updated_at is older.
  assertEquals(results[0].id, "c-prefix");
  assertEquals(results[1].id, "c-infix");
});

Deno.test("crmSearch caps total output at 40 results", async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: `c-${i}`,
    name: `Acme ${i}`,
    city: null,
    state: null,
    country: null,
    updated_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const { client } = makeStubClient({
    crm_companies: { data: rows, error: null },
  });

  const results = await crmSearch(makeRouterCtx(client), "acme", "company");
  assertEquals(results.length, 40);
});
