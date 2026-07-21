import { assertEquals } from "jsr:@std/assert@1";
import {
  notifyAfterStageChange,
  notifyPromisedDateChanged,
} from "./service-lifecycle-notify.ts";
import { queueServiceCustomerNotification } from "./service-customer-notification-queue.ts";

type InsertCall = { table: string; row: Record<string, unknown> };

function makeFakeSupabase(options: {
  contactEmail?: string | null;
  contactPhone?: string | null;
  portalCustomerId?: string | null;
  duplicateScn?: boolean;
} = {}) {
  const inserts: InsertCall[] = [];
  const serviceJob = {
    id: "job-1",
    workspace_id: "default",
    contact_id: "contact-1",
    customer_id: "company-1",
    portal_request_id: null,
    advisor_id: "advisor-1",
    current_stage: "quote_sent",
    current_stage_entered_at: "2026-06-01T12:00:00.000Z",
  };

  function rowFor(table: string, filters: Record<string, unknown>) {
    switch (table) {
      case "service_jobs":
        return serviceJob;
      case "crm_contacts":
        return {
          id: filters.id ?? "contact-1",
          email: options.contactEmail ?? "customer@example.com",
          phone: options.contactPhone ?? null,
        };
      case "portal_customers":
        if (options.portalCustomerId === null) return null;
        return { id: options.portalCustomerId ?? "portal-1" };
      case "service_requests":
      case "crm_companies":
      case "service_branch_config":
        return null;
      default:
        return null;
    }
  }

  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          if (
            table === "service_customer_notifications" && options.duplicateScn
          ) {
            return Promise.resolve({
              error: { code: "23505", message: "duplicate" },
            });
          }
          return Promise.resolve({ error: null });
        },
        select() {
          return chain;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: rowFor(table, filters), error: null });
        },
        single() {
          return Promise.resolve({ data: rowFor(table, filters), error: null });
        },
      };
      return chain;
    },
  };

  return { client: client as never, inserts, serviceJob };
}

Deno.test("queueServiceCustomerNotification records email row with dedupe key and customer-facing copy", async () => {
  const fake = makeFakeSupabase({ contactEmail: "customer@example.com" });

  const result = await queueServiceCustomerNotification(fake.client, {
    workspaceId: "default",
    jobId: "job-1",
    advisorId: "advisor-1",
    notificationType: "awaiting_approval",
    stage: "quote_sent",
    dedupeKey: "service:job-1:awaiting_approval:quote_sent",
  });

  assertEquals(result, { status: "inserted", channel: "email" });
  const row = fake.inserts.find((call) =>
    call.table === "service_customer_notifications"
  )?.row;
  assertEquals(row?.notification_type, "awaiting_approval");
  assertEquals(row?.channel, "email");
  assertEquals(row?.recipient, "customer@example.com");
  assertEquals(row?.dedupe_key, "service:job-1:awaiting_approval:quote_sent");
  assertEquals((row?.metadata as Record<string, unknown>).delivery, "queued");
  assertEquals(
    (row?.metadata as Record<string, unknown>).title,
    "Service estimate awaiting approval",
  );
});

Deno.test("notifyAfterStageChange queues parts-hold notification only for waiting_on_parts", async () => {
  const fake = makeFakeSupabase({ contactEmail: "parts@example.com" });

  await notifyAfterStageChange(
    fake.client,
    fake.serviceJob,
    "blocked_waiting",
    {
      blockerType: "waiting_on_parts",
      blockerDescription: "Cylinder seal kit backordered",
    },
  );

  const row = fake.inserts.find((call) =>
    call.table === "service_customer_notifications"
  )?.row;
  assertEquals(row?.notification_type, "on_hold_parts");
  assertEquals(
    (row?.metadata as Record<string, unknown>).blocker_type,
    "waiting_on_parts",
  );
});

Deno.test("notifyPromisedDateChanged records one promised-date-change event with new date metadata", async () => {
  const fake = makeFakeSupabase({ contactEmail: "date@example.com" });
  const next = "2026-06-03T18:00:00.000Z";

  await notifyPromisedDateChanged(
    fake.client,
    fake.serviceJob,
    "2026-06-01T18:00:00.000Z",
    next,
  );

  const row = fake.inserts.find((call) =>
    call.table === "service_customer_notifications"
  )?.row;
  assertEquals(row?.notification_type, "promised_date_changed");
  assertEquals(
    row?.dedupe_key,
    `service:job-1:promised_date_changed:2026-06-01T18:00:00.000Z:${next}`,
  );
  assertEquals(
    (row?.metadata as Record<string, unknown>).new_promised_at,
    next,
  );
});

Deno.test("queueServiceCustomerNotification treats queue dedupe collision as success", async () => {
  const fake = makeFakeSupabase({ duplicateScn: true });

  const result = await queueServiceCustomerNotification(fake.client, {
    workspaceId: "default",
    jobId: "job-1",
    advisorId: "advisor-1",
    notificationType: "job_started",
    stage: "in_progress",
    dedupeKey: "service:job-1:job_started:in_progress",
  });

  assertEquals(result.status, "deduped");
  assertEquals(result.channel, "email");
  assertEquals(
    fake.inserts.some((call) => call.table === "portal_customer_notifications"),
    false,
  );
});
