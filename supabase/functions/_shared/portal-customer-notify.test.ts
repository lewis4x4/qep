import { assertEquals } from "jsr:@std/assert@1";
import {
  insertPortalCustomerNotification,
  resolvePortalCustomerIdForJob,
  sortPortalNotifications,
} from "./portal-customer-notify.ts";

Deno.test("insertPortalCustomerNotification treats dedupe collisions as no-op success", async () => {
  const supabase = {
    from() {
      return {
        insert: async () => ({ error: { code: "23505" } }),
      };
    },
  };

  const result = await insertPortalCustomerNotification(supabase as never, {
    workspace_id: "default",
    portal_customer_id: "pc-1",
    category: "service",
    event_type: "job_started",
    channel: "email",
    title: "Started",
    body: "Started",
    dedupe_key: "job:1:started",
  });

  assertEquals(result, "deduped");
});

Deno.test("sortPortalNotifications returns newest-first order", () => {
  const rows = sortPortalNotifications([
    { occurred_at: "2026-04-10T01:00:00Z", id: "a" },
    { occurred_at: "2026-04-10T03:00:00Z", id: "b" },
    { occurred_at: "2026-04-10T02:00:00Z", id: "c" },
  ]);

  assertEquals(rows.map((row) => row.id), ["b", "c", "a"]);
});

Deno.test("resolvePortalCustomerIdForJob prefers portal request linkage", async () => {
  const supabase = {
    from(table: string) {
      if (table === "service_jobs") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { portal_request_id: "req-1", contact_id: "contact-1", customer_id: "company-1" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      if (table === "service_requests") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { portal_customer_id: "portal-1" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };

  const portalCustomerId = await resolvePortalCustomerIdForJob(supabase as never, "job-1");
  assertEquals(portalCustomerId, "portal-1");
});
