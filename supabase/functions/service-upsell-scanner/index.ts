/**
 * PM / recall / repeat-failure suggestions for a machine.
 * Auth: user JWT
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;
    const supabase = auth.supabase;

    const body = await req.json() as { machine_id?: string; job_id?: string };
    if (!body.machine_id && !body.job_id) {
      return safeJsonError("machine_id or job_id required", 400, origin);
    }

    let machineId = body.machine_id;
    if (!machineId && body.job_id) {
      const { data: j } = await supabase
        .from("service_jobs")
        .select("machine_id")
        .eq("id", body.job_id)
        .maybeSingle();
      machineId = j?.machine_id ?? undefined;
    }
    if (!machineId) return safeJsonError("Could not resolve machine", 400, origin);

    const recommendations: Array<{ type: string; message: string; severity: string }> = [];

    const { data: fleet } = await supabase
      .from("customer_fleet")
      .select("id, next_service_due, warranty_expiry, make, model")
      .eq("equipment_id", machineId)
      .maybeSingle();

    if (fleet?.next_service_due) {
      const due = new Date(fleet.next_service_due as string);
      if (due < new Date()) {
        recommendations.push({
          type: "pm_overdue",
          message: `PM / scheduled service may be overdue (due ${fleet.next_service_due})`,
          severity: "high",
        });
      }
    }

    const { data: maint } = await supabase
      .from("maintenance_schedules")
      .select("id, scheduled_date, status, maintenance_type, description")
      .eq("equipment_id", machineId)
      .in("status", ["scheduled", "due", "overdue"])
      .order("scheduled_date", { ascending: true })
      .limit(5);

    for (const m of maint ?? []) {
      const sd = m.scheduled_date ? new Date(m.scheduled_date as string) : null;
      const overdue = sd && sd < new Date() || m.status === "overdue";
      recommendations.push({
        type: "maintenance_schedule",
        message: `${m.maintenance_type}: ${(m.description as string).slice(0, 120)}${
          overdue ? " (overdue)" : ""
        }`,
        severity: overdue ? "high" : "medium",
      });
    }

    const { data: bulletins } = await supabase
      .from("machine_knowledge_notes")
      .select("id, content")
      .eq("equipment_id", machineId)
      .eq("note_type", "bulletin")
      .limit(5);

    for (const b of bulletins ?? []) {
      recommendations.push({
        type: "bulletin",
        message: (b.content as string).slice(0, 200),
        severity: "medium",
      });
    }

    const { count: priorJobs } = await supabase
      .from("service_jobs")
      .select("id", { count: "exact", head: true })
      .eq("machine_id", machineId)
      .is("deleted_at", null);

    if ((priorJobs ?? 0) >= 3) {
      recommendations.push({
        type: "repeat_visits",
        message: "Multiple service events on this machine — consider root-cause inspection",
        severity: "low",
      });
    }

    return safeJsonOk({ machine_id: machineId, recommendations }, origin);
  } catch (err) {
    console.error("service-upsell-scanner:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
