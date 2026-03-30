import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { resolveCanonicalHubSpotResolution } from "./hubspot-client.ts";

interface MockQueryError {
  code?: string;
  message: string;
}

interface MockQueryResponse {
  data: unknown[] | null;
  error: MockQueryError | null;
}

class MockQueryBuilder {
  constructor(private readonly response: MockQueryResponse) {}

  select(_columns: string): this {
    return this;
  }

  eq(_column: string, _value: unknown): this {
    return this;
  }

  limit(_count: number): Promise<MockQueryResponse> {
    return Promise.resolve(this.response);
  }
}

class MockSupabase {
  readonly fromCalls: string[] = [];

  constructor(
    private readonly responses: Record<string, MockQueryResponse>,
  ) {}

  from(table: string): MockQueryBuilder {
    this.fromCalls.push(table);
    const response = this.responses[table];
    if (!response) {
      throw new Error(`No mock response configured for table: ${table}`);
    }
    return new MockQueryBuilder(response);
  }
}

function createSupabaseMock(
  responses: Record<string, MockQueryResponse>,
): SupabaseClient {
  return new MockSupabase(responses) as unknown as SupabaseClient;
}

Deno.test("resolveCanonicalHubSpotResolution fails closed when bindings are ambiguous", async () => {
  const mock = new MockSupabase({
    workspace_hubspot_portal: {
      data: [
        {
          workspace_id: "workspace-a",
          hub_id: "12345",
          connection_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
        {
          workspace_id: "workspace-b",
          hub_id: "12345",
          connection_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        },
      ],
      error: null,
    },
    hubspot_connections: {
      data: [],
      error: null,
    },
  });

  const resolution = await resolveCanonicalHubSpotResolution(
    mock as unknown as SupabaseClient,
    "12345",
  );

  assertEquals(resolution.code, "ambiguous_active_binding");
  assertEquals(resolution.context, null);
  assertEquals(mock.fromCalls, ["workspace_hubspot_portal"]);
});

Deno.test("resolveCanonicalHubSpotResolution returns no_active_binding when there is no active portal row", async () => {
  const supabase = createSupabaseMock({
    workspace_hubspot_portal: {
      data: [],
      error: null,
    },
    hubspot_connections: {
      data: [],
      error: null,
    },
  });

  const resolution = await resolveCanonicalHubSpotResolution(supabase, "12345");

  assertEquals(resolution.code, "no_active_binding");
  assertEquals(resolution.context, null);
});

Deno.test("resolveCanonicalHubSpotResolution returns connection_hub_mismatch when connection hub_id differs", async () => {
  const supabase = createSupabaseMock({
    workspace_hubspot_portal: {
      data: [
        {
          workspace_id: "workspace-a",
          hub_id: "12345",
          connection_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
      ],
      error: null,
    },
    hubspot_connections: {
      data: [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          hub_id: "99999",
          access_token: "enc-access",
          refresh_token: "enc-refresh",
          token_expires_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    },
  });

  const resolution = await resolveCanonicalHubSpotResolution(supabase, "12345");

  assertEquals(resolution.code, "connection_hub_mismatch");
  assertEquals(resolution.context, null);
});

Deno.test("resolveCanonicalHubSpotResolution returns context when binding is unambiguous", async () => {
  const supabase = createSupabaseMock({
    workspace_hubspot_portal: {
      data: [
        {
          workspace_id: "workspace-a",
          hub_id: "12345",
          connection_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
      ],
      error: null,
    },
    hubspot_connections: {
      data: [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          hub_id: "12345",
          access_token: "enc-access",
          refresh_token: "enc-refresh",
          token_expires_at: "2099-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    },
  });

  const resolution = await resolveCanonicalHubSpotResolution(supabase, "12345");

  assertEquals(resolution.code, "ok");
  assertEquals(resolution.context?.workspaceId, "workspace-a");
  assertEquals(resolution.context?.hubId, "12345");
  assertEquals(
    resolution.context?.connection.id,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  );
});
