/**
 * SOP Suggest Edge Function
 *
 * Moonshot 7 gap closure: AI Process Advisor.
 *
 * Document: "When a rep is in a deal and hits a decision point the SOP
 * covers, the system nudges: 'Your SOP says to check competitor pricing
 * at this stage. Want me to pull market data?'"
 *
 * This edge function provides contextual SOP suggestions based on the
 * current entity type + stage. Called from deal detail, service pages,
 * intake pages — anywhere reps do work.
 *
 * POST /for-context
 *   Body: { entity_type: 'deal'|'service_job'|'equipment_intake',
 *           entity_id?: string, stage?: string, department?: string }
 *
 * Returns: top 3 relevant SOP templates + contextual nudges
 *
 * Auth: any authenticated user
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

import { captureEdgeException } from "../_shared/sentry.ts";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("Method not allowed", 405, origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

    const body = await req.json();
    const entityType: string = body.entity_type || "general";
    const stage: string | undefined = body.stage;
    const department: string | undefined = body.department;

    // Map entity type → department hint
    const departmentMap: Record<string, string> = {
      deal: "sales",
      service_job: "service",
      equipment_intake: "service",
      parts_order: "parts",
    };
    const effectiveDept = department || departmentMap[entityType] || "all";

    // Find active SOP templates matching the department
    let query = supabase
      .from("sop_templates")
      .select("id, title, description, department, tags, version")
      .eq("status", "active")
      .is("deleted_at", null);

    if (effectiveDept !== "all") {
      query = query.or(`department.eq.${effectiveDept},department.eq.all`);
    }

    const { data: templates } = await query.limit(20);

    if (!templates || templates.length === 0) {
      return safeJsonOk({
        suggestions: [],
        message: "No active SOPs matching this context.",
      }, origin);
    }

    // Rank by tag relevance to stage/entity context
    const ranked = templates.map((t: Record<string, unknown>) => {
      const tags = Array.isArray(t.tags) ? (t.tags as string[]) : [];
      let score = 0;

      // Department match boosts score
      if (t.department === effectiveDept) score += 3;
      if (t.department === "all") score += 1;

      // Tag matches to stage or entity type
      const needles = [stage, entityType].filter(Boolean) as string[];
      for (const tag of tags) {
        for (const needle of needles) {
          if (tag.toLowerCase().includes(needle.toLowerCase())) score += 2;
        }
      }

      return { ...t, relevance_score: score };
    });

    ranked.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      (Number(b.relevance_score) || 0) - (Number(a.relevance_score) || 0)
    );

    // Top 3 suggestions
    const top = ranked.slice(0, 3).map((t: Record<string, unknown>) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      department: t.department,
      tags: t.tags,
      version: t.version,
      relevance_score: t.relevance_score,
      nudge: generateNudge(String(t.title), entityType, stage),
    }));

    return safeJsonOk({
      context: { entity_type: entityType, stage, department: effectiveDept },
      suggestions: top,
      total_active_sops: templates.length,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "sop-suggest", req });
    console.error("sop-suggest error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});

/** Generate a short contextual nudge for the UI. */
function generateNudge(sopTitle: string, entityType: string, stage?: string): string {
  const context = stage ? `at this ${entityType} stage (${stage})` : `on this ${entityType}`;
  return `The "${sopTitle}" SOP applies ${context}. Want to start it?`;
}
