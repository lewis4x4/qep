import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { insertPortalCustomerNotification } from "../_shared/portal-customer-notify.ts";
import {
  buildMaintenanceDueNotification,
  buildMatchingEquipmentNotifications,
} from "../_shared/portal-notification-refresh.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

    // Cron path: accept x-internal-service-secret before requiring Bearer.
    const cronCaller = isServiceRoleCaller(req);
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!cronCaller && !authHeader) return safeJsonError("Unauthorized", 401, origin);

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isServiceRole = cronCaller || authHeader === `Bearer ${serviceRoleKey}`;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    if (!isServiceRole) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader! } } },
      );
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return safeJsonError("Unauthorized", 401, origin);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile || !["manager", "owner"].includes(profile.role)) {
        return safeJsonError("Portal notification refresh requires manager or owner role", 403, origin);
      }
    }

    const today = new Date();
    const dueWindow = new Date(today);
    dueWindow.setDate(dueWindow.getDate() + 14);
    const todayIso = today.toISOString().slice(0, 10);
    const dueIso = dueWindow.toISOString().slice(0, 10);
    const newEquipmentSince = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const { data: fleetRows, error: fleetErr } = await supabaseAdmin
      .from("customer_fleet")
      .select("id, workspace_id, portal_customer_id, make, model, next_service_due")
      .eq("is_active", true);

    if (fleetErr) {
      return safeJsonError("Failed to load customer fleet", 500, origin);
    }

    const fleet = ((fleetRows ?? []) as Array<Record<string, unknown>>)
      .filter((row) => typeof row.portal_customer_id === "string")
      .map((row) => ({
        id: String(row.id),
        workspace_id: String(row.workspace_id ?? "default"),
        portal_customer_id: String(row.portal_customer_id),
        make: String(row.make ?? ""),
        model: String(row.model ?? ""),
        next_service_due: typeof row.next_service_due === "string" ? row.next_service_due : null,
      }));

    let maintenanceCount = 0;
    for (const fleetRow of fleet) {
      if (!fleetRow.next_service_due) continue;
      if (fleetRow.next_service_due < todayIso || fleetRow.next_service_due > dueIso) continue;
      const notification = buildMaintenanceDueNotification(fleetRow);
      if (!notification) continue;
      const result = await insertPortalCustomerNotification(supabaseAdmin, notification);
      if (result === "inserted") maintenanceCount++;
    }

    const { data: equipmentRows, error: equipmentErr } = await supabaseAdmin
      .from("crm_equipment")
      .select("id, workspace_id, make, model, year, vin_pin, availability, ownership, updated_at, created_at, deleted_at")
      .eq("availability", "available")
      .neq("ownership", "customer_owned")
      .is("deleted_at", null)
      .or(`updated_at.gte.${newEquipmentSince},created_at.gte.${newEquipmentSince}`);

    if (equipmentErr) {
      return safeJsonError("Failed to load new inventory", 500, origin);
    }

    const matchingNotifications = buildMatchingEquipmentNotifications({
      fleet,
      equipment: ((equipmentRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        workspace_id: String(row.workspace_id ?? "default"),
        make: typeof row.make === "string" ? row.make : null,
        model: typeof row.model === "string" ? row.model : null,
        year: typeof row.year === "number" ? row.year : null,
        serial_number: typeof row.vin_pin === "string" ? row.vin_pin : null,
      })),
    });

    let matchingCount = 0;
    for (const notification of matchingNotifications) {
      const result = await insertPortalCustomerNotification(supabaseAdmin, notification);
      if (result === "inserted") matchingCount++;
    }

    return safeJsonOk({
      ok: true,
      maintenance_due_inserted: maintenanceCount,
      matching_equipment_inserted: matchingCount,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "portal-notification-refresh", req });
    console.error("portal-notification-refresh error:", err);
    return safeJsonError("Internal server error", 500, origin);
  }
});
