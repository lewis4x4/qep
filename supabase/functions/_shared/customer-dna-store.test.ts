import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  CustomerDnaStoreError,
  CustomerDnaWorkspaceError,
  fetchExistingCustomerProfile,
  resolveContactByLookup,
} from "./customer-dna-store.ts";

type Row = Record<string, unknown>;

class MockQuery
  implements PromiseLike<{ data: Row[]; error: { message: string } | null }> {
  #filters: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly rows: Row[],
    private readonly error: { message: string } | null = null,
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.#filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.#filters.push((row) => row[column] !== value);
    return this;
  }

  ilike(column: string, value: string): this {
    const expected = value.toLowerCase();
    this.#filters.push((row) =>
      typeof row[column] === "string" &&
      String(row[column]).toLowerCase() === expected
    );
    return this;
  }

  is(column: string, value: unknown): this {
    this.#filters.push((row) => row[column] === value);
    return this;
  }

  limit(_count: number): this {
    return this;
  }

  then<
    TResult1 = { data: Row[]; error: { message: string } | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: { data: Row[]; error: { message: string } | null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.rows.filter((row) =>
        this.#filters.every((filter) => filter(row))
      ),
      error: this.error,
    }).then(onfulfilled, onrejected);
  }

  async maybeSingle(): Promise<{
    data: Row | null;
    error: { message: string } | null;
  }> {
    return {
      data:
        this.rows.find((row) => this.#filters.every((filter) => filter(row))) ??
          null,
      error: this.error,
    };
  }
}

function client(
  fixtures: Record<string, Row[]>,
  errors: Record<string, { message: string }> = {},
): never {
  return {
    from(table: string) {
      return new MockQuery(fixtures[table] ?? [], errors[table] ?? null);
    },
  } as never;
}

const targetContact = {
  id: "contact-target",
  workspace_id: "workspace-target",
  first_name: "Target",
  last_name: "Customer",
  email: "same@example.test",
  hubspot_contact_id: "hub-1",
  dge_customer_profile_id: "profile-target",
  primary_company_id: "company-target",
  deleted_at: null,
};

Deno.test("contact lookup scopes duplicate identifiers to the authorized workspace", async () => {
  const admin = client({
    crm_contacts: [
      {
        ...targetContact,
        id: "contact-other",
        workspace_id: "workspace-other",
      },
      targetContact,
    ],
  });

  const contact = await resolveContactByLookup(
    admin,
    { email: "same@example.test" },
    "workspace-target",
  );
  assertEquals(contact?.id, "contact-target");
  assertEquals(contact?.workspace_id, "workspace-target");
});

Deno.test("contact lookup rejects ambiguous active candidates inside one workspace", async () => {
  const admin = client({
    crm_contacts: [
      targetContact,
      { ...targetContact, id: "contact-target-duplicate" },
    ],
  });

  await assertRejects(
    () =>
      resolveContactByLookup(
        admin,
        { email: "same@example.test" },
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
});

Deno.test("contact lookup rejects identifiers that point at different workspace-local contacts", async () => {
  const admin = client({
    crm_contacts: [
      targetContact,
      {
        ...targetContact,
        id: "contact-email-only",
        hubspot_contact_id: "hub-2",
      },
    ],
  });

  await assertRejects(
    () =>
      resolveContactByLookup(
        admin,
        { hubspot_contact_id: "hub-1", email: "same@example.test" },
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
});

Deno.test("contact lookup rejects a supplied identifier that does not match the other candidate", async () => {
  const admin = client({ crm_contacts: [targetContact] });
  await assertRejects(
    () =>
      resolveContactByLookup(
        admin,
        {
          hubspot_contact_id: "hub-1",
          email: "different@example.test",
        },
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
});

Deno.test("contact lookup fails closed on database errors", async () => {
  await assertRejects(
    () =>
      resolveContactByLookup(
        client({ crm_contacts: [] }, {
          crm_contacts: { message: "connection lost" },
        }),
        { email: "same@example.test" },
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
});

Deno.test("profile lookup rejects a company anchor in another workspace", async () => {
  const admin = client({
    customer_profiles_extended: [
      { id: "profile-other", crm_company_id: "company-other" },
    ],
    crm_companies: [
      {
        id: "company-other",
        workspace_id: "workspace-other",
        deleted_at: null,
      },
    ],
    crm_contacts: [],
  });

  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        { customer_profiles_extended_id: "profile-other" },
        null,
        "workspace-target",
      ),
    CustomerDnaWorkspaceError,
  );
});

Deno.test("profile lookup accepts an active company anchor in the target workspace", async () => {
  const admin = client({
    customer_profiles_extended: [
      { id: "profile-target", crm_company_id: "company-target" },
    ],
    crm_companies: [
      {
        id: "company-target",
        workspace_id: "workspace-target",
        deleted_at: null,
      },
    ],
  });

  const profile = await fetchExistingCustomerProfile(
    admin,
    { customer_profiles_extended_id: "profile-target" },
    null,
    "workspace-target",
  );
  assertEquals(profile?.id, "profile-target");
});

Deno.test("a target-workspace contact cannot override a conflicting company anchor", async () => {
  const admin = client({
    customer_profiles_extended: [
      { id: "profile-target", crm_company_id: "company-other" },
    ],
    crm_companies: [
      {
        id: "company-other",
        workspace_id: "workspace-other",
        deleted_at: null,
      },
    ],
    crm_contacts: [targetContact],
  });

  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        { customer_profiles_extended_id: "profile-target" },
        targetContact,
        "workspace-target",
      ),
    CustomerDnaWorkspaceError,
  );
});

Deno.test("a companyless contact cannot adopt a company-anchored explicit profile", async () => {
  const companylessContact = {
    ...targetContact,
    primary_company_id: null,
  };
  const admin = client({
    customer_profiles_extended: [
      { id: "profile-target", crm_company_id: "company-target" },
    ],
    crm_companies: [
      {
        id: "company-target",
        workspace_id: "workspace-target",
        deleted_at: null,
      },
    ],
  });

  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        { customer_profiles_extended_id: "profile-target" },
        companylessContact,
        "workspace-target",
      ),
    CustomerDnaWorkspaceError,
  );
});

Deno.test("legacy unanchored profiles require a linked contact in the target workspace", async () => {
  const admin = client({
    customer_profiles_extended: [
      { id: "profile-target", crm_company_id: null },
    ],
    crm_contacts: [
      {
        ...targetContact,
        primary_company_id: null,
      },
    ],
  });

  const profile = await fetchExistingCustomerProfile(
    admin,
    { customer_profiles_extended_id: "profile-target" },
    targetContact,
    "workspace-target",
  );
  assertEquals(profile?.id, "profile-target");
});

Deno.test("legacy unanchored profiles with links in multiple workspaces fail closed", async () => {
  const admin = client({
    customer_profiles_extended: [
      { id: "profile-target", crm_company_id: null },
    ],
    crm_contacts: [
      { ...targetContact, primary_company_id: null },
      {
        ...targetContact,
        id: "contact-other",
        workspace_id: "workspace-other",
        primary_company_id: null,
      },
    ],
  });

  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        { customer_profiles_extended_id: "profile-target" },
        targetContact,
        "workspace-target",
      ),
    CustomerDnaWorkspaceError,
  );
});

Deno.test("legacy unanchored profiles detect a foreign link beyond the old fifty-row cap", async () => {
  const admin = client({
    customer_profiles_extended: [
      { id: "profile-target", crm_company_id: null },
    ],
    crm_contacts: [
      ...Array.from({ length: 50 }, (_, index) => ({
        ...targetContact,
        id: `contact-target-${index}`,
        primary_company_id: null,
      })),
      {
        ...targetContact,
        id: "contact-foreign-51",
        workspace_id: "workspace-other",
        primary_company_id: null,
      },
    ],
  });

  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        { customer_profiles_extended_id: "profile-target" },
        targetContact,
        "workspace-target",
      ),
    CustomerDnaWorkspaceError,
  );
});

Deno.test("profile lookup resolves a workspace-local candidate among global identifier collisions", async () => {
  const admin = client({
    customer_profiles_extended: [
      {
        id: "profile-other",
        hubspot_contact_id: "hub-shared",
        crm_company_id: "company-other",
      },
      {
        id: "profile-target",
        hubspot_contact_id: "hub-shared",
        crm_company_id: "company-target",
      },
    ],
    crm_companies: [
      {
        id: "company-other",
        workspace_id: "workspace-other",
        deleted_at: null,
      },
      {
        id: "company-target",
        workspace_id: "workspace-target",
        deleted_at: null,
      },
    ],
    crm_contacts: [],
  });

  const profile = await fetchExistingCustomerProfile(
    admin,
    { hubspot_contact_id: "hub-shared" },
    null,
    "workspace-target",
  );
  assertEquals(profile?.id, "profile-target");
});

Deno.test("profile lookup rejects workspace-local identifiers that resolve to different profiles", async () => {
  const admin = client({
    customer_profiles_extended: [
      {
        id: "profile-hubspot",
        hubspot_contact_id: "hub-1",
        crm_company_id: "company-target",
      },
      {
        id: "profile-intelli",
        intellidealer_customer_id: "intelli-1",
        crm_company_id: "company-target",
      },
    ],
    crm_companies: [
      {
        id: "company-target",
        workspace_id: "workspace-target",
        deleted_at: null,
      },
    ],
    crm_contacts: [],
  });

  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        {
          hubspot_contact_id: "hub-1",
          intellidealer_customer_id: "intelli-1",
        },
        null,
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
});

Deno.test("explicit profile lookup rejects conflicting persisted external identities", async () => {
  const admin = client({
    customer_profiles_extended: [{
      id: "profile-target",
      hubspot_contact_id: "hub-existing",
      intellidealer_customer_id: "intelli-existing",
      crm_company_id: "company-target",
    }],
    crm_companies: [{
      id: "company-target",
      workspace_id: "workspace-target",
      deleted_at: null,
    }],
  });
  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        {
          customer_profiles_extended_id: "profile-target",
          hubspot_contact_id: "hub-conflict",
        },
        null,
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        admin,
        {
          customer_profiles_extended_id: "profile-target",
          intellidealer_customer_id: "intelli-conflict",
        },
        null,
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
});

Deno.test("profile lookup fails closed when an identifier query errors", async () => {
  await assertRejects(
    () =>
      fetchExistingCustomerProfile(
        client({ customer_profiles_extended: [] }, {
          customer_profiles_extended: { message: "read timed out" },
        }),
        { hubspot_contact_id: "hub-1" },
        null,
        "workspace-target",
      ),
    CustomerDnaStoreError,
  );
});
