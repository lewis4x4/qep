/**
 * Service Intake — AI-assisted service request creation.
 *
 * Receives customer_id + machine_id (or lookup hints), fetches machine
 * history, queries job_codes, and returns diagnosis suggestions.
 *
 * Auth: user JWT
 */
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

interface IntakeRequest {
  customer_id?: string;
  machine_id?: string;
  customer_search?: string;
  machine_search?: string;
  symptom?: string;
  request_type?: string;
}

interface JobCodeSuggestion {
  id: string;
  job_name: string;
  make: string;
  model_family: string | null;
  manufacturer_estimated_hours: number | null;
  shop_average_hours: number | null;
  parts_template: unknown[];
  confidence_score: number | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;

    const body: IntakeRequest = await req.json();

    // Resolve machine context
    let machine: Record<string, unknown> | null = null;
    if (body.machine_id) {
      const { data } = await supabase
        .from("crm_equipment")
        .select("id, make, model, serial_number, year, category, condition")
        .eq("id", body.machine_id)
        .single();
      machine = data;
    } else if (body.machine_search) {
      const { data } = await supabase
        .from("crm_equipment")
        .select("id, make, model, serial_number, year, category, condition")
        .or(
          `serial_number.ilike.%${body.machine_search}%,model.ilike.%${body.machine_search}%,make.ilike.%${body.machine_search}%`,
        )
        .limit(5);
      if (data && data.length === 1) machine = data[0];
    }

    // Fetch prior service history for this machine
    let serviceHistory: unknown[] = [];
    if (machine?.id) {
      const { data } = await supabase
        .from("service_jobs")
        .select("id, request_type, current_stage, customer_problem_summary, created_at, closed_at")
        .eq("machine_id", machine.id as string)
        .order("created_at", { ascending: false })
        .limit(10);
      serviceHistory = data ?? [];
    }

    // Query matching job codes
    let suggestedJobCodes: JobCodeSuggestion[] = [];
    if (machine?.make) {
      const { data } = await supabase
        .from("job_codes")
        .select("id, job_name, make, model_family, manufacturer_estimated_hours, shop_average_hours, parts_template, confidence_score")
        .eq("make", machine.make as string)
        .order("confidence_score", { ascending: false })
        .limit(10);
      suggestedJobCodes = (data ?? []) as JobCodeSuggestion[];
    }

    // Derive likely parts from top job code template
    const likelyParts: unknown[] = suggestedJobCodes.length > 0
      ? (suggestedJobCodes[0].parts_template ?? [])
      : [];

    // Estimate hours from best match
    const estimatedHours = suggestedJobCodes.length > 0
      ? suggestedJobCodes[0].shop_average_hours ??
        suggestedJobCodes[0].manufacturer_estimated_hours ??
        null
      : null;

    // Determine haul requirement heuristic
    const haulRequired = false; // Default; UI allows override

    // Confidence based on match quality
    const confidence = suggestedJobCodes.length > 0
      ? suggestedJobCodes[0].confidence_score ?? 0.3
      : 0.1;

    return safeJsonOk({
      machine,
      service_history: serviceHistory,
      suggested_job_codes: suggestedJobCodes,
      likely_parts: likelyParts,
      estimated_hours: estimatedHours,
      haul_required: haulRequired,
      confidence,
      suggested_next_step: suggestedJobCodes.length > 0
        ? "Select job code and create service request"
        : "Manual diagnosis required — no matching job codes found",
    }, origin);
  } catch (err) {
    console.error("service-intake error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    return safeJsonError("Internal server error", 500, req.headers.get("Origin"));
  }
});
