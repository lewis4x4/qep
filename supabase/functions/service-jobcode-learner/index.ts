/**
 * Nightly job-code learning — aggregates job_code_observations into job_codes
 * (hours, parts templates, add-ons) with audit events.
 * Auth: service_role
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";

function partKeysFromJson(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x === "string") {
      const p = x.trim();
      if (p) out.push(p.toLowerCase());
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const pn = String(o.part_number ?? o.partNumber ?? o.sku ?? "").trim();
      if (pn) out.push(pn.toLowerCase());
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    if (req.method === "GET") {
      return safeJsonOk({
        ok: true,
        function: "service-jobcode-learner",
        ts: new Date().toISOString(),
      }, null);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!);
    const results = {
      job_codes_hours_updated: 0,
      job_code_suggestions_upserted: 0,
      events_logged: 0,
    };

    const { data: groups } = await supabase
      .from("job_code_observations")
      .select("job_code_id, actual_hours, estimated_hours")
      .not("actual_hours", "is", null);

    const byCode = new Map<string, number[]>();
    for (const row of groups ?? []) {
      if (!row.job_code_id || row.actual_hours == null) continue;
      const arr = byCode.get(row.job_code_id) ?? [];
      arr.push(Number(row.actual_hours));
      byCode.set(row.job_code_id, arr);
    }

    for (const [jobCodeId, hours] of byCode) {
      if (hours.length < 5) continue;
      const avg = hours.reduce((a, b) => a + b, 0) / hours.length;
      await supabase
        .from("job_codes")
        .update({
          shop_average_hours: Math.round(avg * 100) / 100,
          confidence_score: Math.min(0.95, 0.5 + hours.length * 0.02),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobCodeId);
      results.job_codes_hours_updated++;
    }

    const { data: obs } = await supabase
      .from("job_code_observations")
      .select(
        "job_code_id, job_id, parts_consumed, parts_quoted, discovered_add_ons",
      );

    const agg = new Map<
      string,
      { consumed: Set<string>; quoted: Set<string>; addOns: Set<string>; sampleJobId: string | null }
    >();
    for (const row of obs ?? []) {
      if (!row.job_code_id) continue;
      const cur = agg.get(row.job_code_id) ?? {
        consumed: new Set<string>(),
        quoted: new Set<string>(),
        addOns: new Set<string>(),
        sampleJobId: null as string | null,
      };
      if (!cur.sampleJobId && row.job_id) cur.sampleJobId = row.job_id as string;
      for (const k of partKeysFromJson(row.parts_consumed)) cur.consumed.add(k);
      for (const k of partKeysFromJson(row.parts_quoted)) cur.quoted.add(k);
      for (const k of partKeysFromJson(row.discovered_add_ons)) cur.addOns.add(k);
      agg.set(row.job_code_id, cur);
    }

    const minObs = 3;
    const tplCap = 35;
    const addOnCap = 20;

    for (const [jobCodeId, data] of agg) {
      const n = (obs ?? []).filter((o) => o.job_code_id === jobCodeId).length;
      if (n < minObs) continue;

      const { data: jc, error: jcErr } = await supabase
        .from("job_codes")
        .select("workspace_id, parts_template, common_add_ons")
        .eq("id", jobCodeId)
        .single();
      if (jcErr || !jc) continue;

      const tpl = Array.isArray(jc.parts_template) ? [...jc.parts_template] : [];
      const common = Array.isArray(jc.common_add_ons) ? [...jc.common_add_ons] : [];

      const existingPn = new Set<string>();
      for (const item of tpl) {
        if (typeof item === "string") existingPn.add(item.toLowerCase());
        else if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const pn = String(o.part_number ?? o.partNumber ?? "").trim();
          if (pn) existingPn.add(pn.toLowerCase());
        }
      }

      let added = 0;
      for (const k of data.consumed) {
        if (tpl.length >= tplCap) break;
        if (existingPn.has(k)) continue;
        tpl.push({
          part_number: k.toUpperCase(),
          quantity: 1,
          source: "learned",
          confidence: "medium",
        });
        existingPn.add(k);
        added++;
      }

      let addOnAdded = 0;
      const addExisting = new Set(
        common.map((x) => typeof x === "string" ? x.toLowerCase() : String(x)),
      );
      for (const k of data.addOns) {
        if (common.length >= addOnCap) break;
        if (addExisting.has(k)) continue;
        common.push(k.toUpperCase());
        addExisting.add(k);
        addOnAdded++;
      }

      if (added === 0 && addOnAdded === 0) continue;

      const { data: pending } = await supabase
        .from("job_code_template_suggestions")
        .select("id")
        .eq("job_code_id", jobCodeId)
        .eq("review_status", "pending")
        .maybeSingle();

      if (pending?.id) {
        const { error: upErr } = await supabase
          .from("job_code_template_suggestions")
          .update({
            suggested_parts_template: tpl,
            suggested_common_add_ons: common,
            observation_count: n,
            updated_at: new Date().toISOString(),
          })
          .eq("id", pending.id);
        if (upErr) console.warn("job_code_template_suggestions update:", upErr.message);
        else results.job_code_suggestions_upserted++;
      } else {
        const { error: insErr } = await supabase
          .from("job_code_template_suggestions")
          .insert({
            workspace_id: jc.workspace_id as string,
            job_code_id: jobCodeId,
            suggested_parts_template: tpl,
            suggested_common_add_ons: common,
            observation_count: n,
            review_status: "pending",
          });
        if (insErr) console.warn("job_code_template_suggestions insert:", insErr.message);
        else results.job_code_suggestions_upserted++;
      }

      const jid = data.sampleJobId;
      if (jid) {
        await supabase.from("service_job_events").insert({
          workspace_id: jc.workspace_id as string,
          job_id: jid,
          event_type: "job_code_learned",
          metadata: {
            job_code_id: jobCodeId,
            parts_template_additions: added,
            common_add_ons_additions: addOnAdded,
            observation_count: n,
          },
        });
        results.events_logged++;
      }
    }

    return safeJsonOk({ ok: true, results }, null);
  } catch (err) {
    console.error("service-jobcode-learner:", err);
    return safeJsonError("Internal server error", 500, null);
  }
});
