/**
 * Suggest technicians for a service job from technician_profiles heuristics.
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
      .select("id, user_id, brands_supported, branch_id, shop_eligible, field_eligible, active_workload")
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
        score += certs.some((c) => jn.includes(String(c).toLowerCase())) ? 25 : 0;
      }
      if (job.branch_id && p.branch_id && p.branch_id !== job.branch_id) score -= 25;
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

    const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name ?? u.email]));

    return safeJsonOk({
      suggestions: ranked.slice(0, 8).map((r) => ({
        technician_profile_id: r.id,
        user_id: r.user_id,
        name: nameById.get(r.user_id) ?? r.user_id,
        score: r.score,
      })),
    }, origin);
  } catch (err) {
    console.error("service-scheduler:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
