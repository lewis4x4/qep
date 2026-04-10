import { assertEquals } from "jsr:@std/assert@1";
import {
  buildMaintenanceDueNotification,
  buildMatchingEquipmentNotifications,
  modelsOverlap,
} from "./portal-notification-refresh.ts";

Deno.test("buildMaintenanceDueNotification dedupes by fleet and due date", () => {
  const notification = buildMaintenanceDueNotification({
    id: "fleet-1",
    workspace_id: "default",
    portal_customer_id: "pc-1",
    make: "Kubota",
    model: "SVL75",
    next_service_due: "2026-04-20",
  });

  assertEquals(notification?.dedupe_key, "maintenance_due:fleet-1:2026-04-20");
});

Deno.test("modelsOverlap requires at least one substantive token match", () => {
  assertEquals(modelsOverlap("SVL 75-2", "SVL75"), false);
  assertEquals(modelsOverlap("TL8 Track Loader", "2024 TL8"), true);
});

Deno.test("buildMatchingEquipmentNotifications emits once per portal customer and equipment", () => {
  const notifications = buildMatchingEquipmentNotifications({
    fleet: [
      {
        id: "fleet-1",
        workspace_id: "default",
        portal_customer_id: "pc-1",
        make: "Bobcat",
        model: "TL8 Track Loader",
        next_service_due: null,
      },
      {
        id: "fleet-2",
        workspace_id: "default",
        portal_customer_id: "pc-1",
        make: "Bobcat",
        model: "TL8 Compact Track Loader",
        next_service_due: null,
      },
    ],
    equipment: [
      {
        id: "equipment-1",
        workspace_id: "default",
        make: "Bobcat",
        model: "2024 TL8",
        year: 2024,
        serial_number: "SN-1",
      },
    ],
  });

  assertEquals(notifications.length, 1);
  assertEquals(notifications[0].dedupe_key, "matching_equipment:pc-1:equipment-1");
});
