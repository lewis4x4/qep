/**
 * Shared: insert/resync service_parts_requirements from job_codes.parts_template.
 * Used by service-job-router and service-intake (optional seed).
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function buildPartsRowsFromTemplate(
  tpl: unknown,
  workspaceId: string,
  jobId: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  if (!tpl || !Array.isArray(tpl)) return rows;
  for (const item of tpl) {
    if (typeof item === "string") {
      const pn = item.trim();
      if (!pn) continue;
      rows.push({
        workspace_id: workspaceId,
        job_id: jobId,
        part_number: pn,
        quantity: 1,
        source: "job_code_template",
        confidence: "medium",
        intake_line_status: "suggested",
      });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const pn = String(o.part_number ?? o.partNumber ?? o.sku ?? "").trim();
      if (!pn) continue;
      const qty = Math.max(1, Math.floor(Number(o.quantity ?? o.qty ?? 1)) || 1);
      rows.push({
        workspace_id: workspaceId,
        job_id: jobId,
        part_number: pn,
        description: o.description ? String(o.description) : null,
        quantity: qty,
        unit_cost: o.unit_cost != null ? Number(o.unit_cost) : null,
        source: "job_code_template",
        confidence: "medium",
        intake_line_status: "suggested",
      });
    }
  }
  return rows;
}

export async function populatePartsFromJobCode(
  supabase: SupabaseClient,
  jobId: string,
  jobCodeId: string,
  workspaceId: string,
): Promise<{ inserted: number }> {
  const { data: jc } = await supabase
    .from("job_codes")
    .select("parts_template")
    .eq("id", jobCodeId)
    .single();
  const tpl = jc?.parts_template;
  const rows = buildPartsRowsFromTemplate(tpl, workspaceId, jobId);
  if (rows.length === 0) return { inserted: 0 };

  const { data: existing } = await supabase
    .from("service_parts_requirements")
    .select("id")
    .eq("job_id", jobId)
    .neq("status", "cancelled")
    .limit(1);
  if (existing && existing.length > 0) return { inserted: 0 };

  const { error } = await supabase.from("service_parts_requirements").insert(rows);
  if (error) console.error("populatePartsFromJobCode:", error);
  return { inserted: error ? 0 : rows.length };
}

export async function resyncPartsFromJobCode(
  supabase: SupabaseClient,
  jobId: string,
  jobCodeId: string,
  workspaceId: string,
  mode: "replace_cancelled_only" | "full",
): Promise<{ inserted: number; cancelled: number }> {
  const { data: jc } = await supabase
    .from("job_codes")
    .select("parts_template")
    .eq("id", jobCodeId)
    .single();
  const rows = buildPartsRowsFromTemplate(jc?.parts_template, workspaceId, jobId);
  if (rows.length === 0) return { inserted: 0, cancelled: 0 };

  let cancelled = 0;
  if (mode === "full") {
    const { data: open } = await supabase
      .from("service_parts_requirements")
      .select("id, status")
      .eq("job_id", jobId);
    for (const r of open ?? []) {
      if (!["consumed", "returned", "cancelled"].includes(r.status)) {
        await supabase
          .from("service_parts_requirements")
          .update({ status: "cancelled" })
          .eq("id", r.id);
        cancelled++;
      }
    }
    const { error } = await supabase.from("service_parts_requirements").insert(rows);
    if (error) console.error("resyncPartsFromJobCode full:", error);
    return { inserted: error ? 0 : rows.length, cancelled };
  }

  const { data: existing } = await supabase
    .from("service_parts_requirements")
    .select("part_number")
    .eq("job_id", jobId)
    .neq("status", "cancelled");
  const have = new Set(
    (existing ?? []).map((e) => String(e.part_number).toLowerCase()),
  );
  const toAdd = rows.filter(
    (r) => !have.has(String(r.part_number).toLowerCase()),
  );
  if (toAdd.length === 0) return { inserted: 0, cancelled: 0 };
  const { error } = await supabase.from("service_parts_requirements").insert(toAdd);
  if (error) console.error("resyncPartsFromJobCode partial:", error);
  return { inserted: error ? 0 : toAdd.length, cancelled: 0 };
}
