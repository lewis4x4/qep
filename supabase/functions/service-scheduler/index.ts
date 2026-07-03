/**
 * Suggest technicians for a service job from technician_profiles heuristics.
 * Auth: user JWT
 */
import {
  requireServiceUser,
  SERVICE_OPERATIONS_ROLES,
} from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";

type SchedulerRpcReason = {
  key?: string;
  label?: string;
  detail?: string | null;
};

type SchedulerRpcCandidate = {
  technician_profile_id?: string | null;
  technician_user_id?: string | null;
  technician_name?: string | null;
  branch_id?: string | null;
  branch_match?: boolean | null;
  shop_field_eligible?: boolean | null;
  brand_match?: boolean | null;
  legacy_cert_match?: boolean | null;
  oem_cert_match?: boolean | null;
  in_house_completed_count?: number | string | null;
  active_workload?: number | string | null;
  availability_date?: string | null;
  available_hours?: number | string | null;
  scheduled_hours?: number | string | null;
  capacity_remaining_hours?: number | string | null;
  suitability_score?: number | string | null;
  reasons?: SchedulerRpcReason[] | null;
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRpcReasons(value: unknown): SchedulerRpcReason[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key : "";
    const label = typeof row.label === "string" ? row.label : "";
    if (!key || !label) return [];
    return [{
      key,
      label,
      detail: typeof row.detail === "string" ? row.detail : null,
    }];
  });
}

function normalizeRpcCandidate(row: SchedulerRpcCandidate) {
  const userId = row.technician_user_id ?? null;
  return {
    technician_profile_id: row.technician_profile_id ?? null,
    user_id: userId,
    name: row.technician_name ?? userId ?? "Unknown technician",
    score: asNumber(row.suitability_score) ?? 0,
    branch_id: row.branch_id ?? null,
    branch_match: row.branch_match === true,
    shop_field_eligible: row.shop_field_eligible === true,
    brand_match: row.brand_match === true,
    legacy_cert_match: row.legacy_cert_match === true,
    oem_cert_match: row.oem_cert_match === true,
    in_house_completed_count: asNumber(row.in_house_completed_count) ?? 0,
    active_workload: asNumber(row.active_workload) ?? 0,
    availability_date: row.availability_date ?? null,
    available_hours: asNumber(row.available_hours) ?? 0,
    scheduled_hours: asNumber(row.scheduled_hours) ?? 0,
    capacity_remaining_hours: asNumber(row.capacity_remaining_hours) ?? 0,
    reasons: normalizeRpcReasons(row.reasons),
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(
      req.headers.get("Authorization"),
      origin,
      SERVICE_OPERATIONS_ROLES,
    );
    if (!auth.ok) return auth.response;
    const supabase = auth.supabase;

    const body = await req.json() as { job_id?: string };
    if (!body.job_id) return safeJsonError("job_id required", 400, origin);

    const { data: job, error: jErr } = await supabase
      .from("service_jobs")
      .select(`
        id, branch_id, shop_or_field, machine_id, selected_job_code_id
      `)
      .eq("id", body.job_id)
      .single();
    if (jErr || !job) return safeJsonError("Job not found", 404, origin);

    const { data: rpcCandidates, error: rpcErr } = await supabase.rpc(
      "service_schedule_assignment_candidates",
      { p_service_job_id: body.job_id },
    );
    if (!rpcErr && Array.isArray(rpcCandidates)) {
      return safeJsonOk({
        source: "service_schedule_assignment_candidates",
        suggestions: rpcCandidates
          .slice(0, 8)
          .map((row) => normalizeRpcCandidate(row as SchedulerRpcCandidate)),
      }, origin);
    }
    if (rpcErr) {
      console.warn("[service-scheduler] H6.1 ranking RPC unavailable, falling back to legacy heuristic", {
        code: rpcErr.code,
        message: rpcErr.message,
      });
    }

    let machineMake: string | null = null;
    let jobCodeName: string | null = null;
    if (job.machine_id) {
      const { data: m } = await supabase
        .from("crm_equipment")
        .select("make")
        .eq("id", job.machine_id)
        .maybeSingle();
      machineMake = m?.make ?? null;
    }
    if (job.selected_job_code_id) {
      const { data: jc } = await supabase
        .from("job_codes")
        .select("job_name")
        .eq("id", job.selected_job_code_id)
        .maybeSingle();
      jobCodeName = jc?.job_name ?? null;
    }

    const { data: profiles } = await supabase
      .from("technician_profiles")
      .select(
        "id, user_id, brands_supported, certifications, branch_id, shop_eligible, field_eligible, active_workload",
      )
      .order("active_workload", { ascending: true });

    const ranked = (profiles ?? []).map((p) => {
      let score = 100;
      const brands = (p.brands_supported as string[]) ?? [];
      const certs = (p.certifications as string[]) ?? [];
      if (machineMake && brands.length > 0) {
        score += brands.some((b) =>
            machineMake!.toLowerCase().includes(String(b).toLowerCase())
          )
          ? 40
          : -10;
      }
      if (jobCodeName && certs.length > 0) {
        const jn = jobCodeName.toLowerCase();
        score += certs.some((c) => jn.includes(String(c).toLowerCase()))
          ? 25
          : 0;
      }
      if (job.branch_id && p.branch_id && p.branch_id !== job.branch_id) {
        score -= 25;
      }
      if (job.shop_or_field === "field" && !p.field_eligible) score -= 50;
      if (job.shop_or_field === "shop" && !p.shop_eligible) score -= 50;
      score -= (p.active_workload ?? 0) * 3;
      return { ...p, score };
    });

    ranked.sort((a, b) => b.score - a.score);

    const { data: users } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in(
        "id",
        ranked.slice(0, 10).map((r) => r.user_id),
      );

    const nameById = new Map(
      (users ?? []).map((u) => [u.id, u.full_name ?? u.email]),
    );

    return safeJsonOk({
      suggestions: ranked.slice(0, 8).map((r) => ({
        technician_profile_id: r.id,
        user_id: r.user_id,
        name: nameById.get(r.user_id) ?? r.user_id,
        score: r.score,
      })),
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "service-scheduler", req });
    console.error("service-scheduler:", err);
    return safeJsonError(
      "Internal server error",
      500,
      req.headers.get("Origin"),
    );
  }
});
