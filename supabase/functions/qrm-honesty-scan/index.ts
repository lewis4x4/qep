/**
 * QRM Honesty Scan — nightly calibration (Phase 0 P0.6 / Day 10).
 *
 * Runs 8 honesty probes (6 live, 2 stubs) against QRM data to detect
 * discrepancies between reported state and observed state. Persists
 * observations to `qrm_honesty_observations` and computes a daily
 * `honesty_index` rollup in `qrm_honesty_daily`.
 *
 * Auth: service_role (cron at 03:00 UTC via migration 214) or manual
 * invocation with x-internal-service-secret.
 *
 * Pipeline:
 *   1. Load enabled probes from `qrm_honesty_probes`
 *   2. Group probes by query type → run each DB query once
 *   3. Fan query results to matching probe scorers
 *   4. Batch-insert all observations
 *   5. Compute daily rollup → upsert into `qrm_honesty_daily`
 *   6. Return { ok, probes_run, observations_created, honesty_index }
 *
 * Error handling: per-probe try/catch so one failing probe doesn't
 * break the others. Failed probes are logged to sentry + counted.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import {
  PROBE_REGISTRY,
  scoreCloseImminentNoActivity,
  scoreClosedLostNoReason,
  scoreDepositStateMismatch,
  scoreHighProbNoActivity,
  scoreMarginPassedNoPct,
  scoreRetroactiveActivity,
  type HonestyObservation,
} from "../_shared/qrm-honesty/probes.ts";

const FN_NAME = "qrm-honesty-scan";

interface ProbeRow {
  id: string;
  probe_name: string;
  is_enabled: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  try {
    if (!isServiceRoleCaller(req)) {
      return safeJsonError("Unauthorized — service role required", 401, null);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey!,
    );

    const today = new Date().toISOString().split("T")[0];
    const nowMs = Date.now();
    const workspaceId = "default"; // Phase 0 — single workspace

    // ── 1. Load enabled probes ──────────────────────────────────────────
    const { data: probeRows, error: probeError } = await adminClient
      .from("qrm_honesty_probes")
      .select("id, probe_name, is_enabled")
      .eq("workspace_id", workspaceId)
      .eq("is_enabled", true);

    if (probeError) {
      console.error(`[${FN_NAME}] probe registry load failed:`, probeError);
      return safeJsonError("Failed to load probe registry", 500, null);
    }

    const enabledProbes = (probeRows ?? []) as ProbeRow[];
    if (enabledProbes.length === 0) {
      return safeJsonOk({ ok: true, message: "No enabled probes", probes_run: 0, observations_created: 0 }, null);
    }

    // ── 2. Group probes by query type and run queries ───────────────────
    const probesByGroup = new Map<string, ProbeRow[]>();
    for (const probe of enabledProbes) {
      const entry = PROBE_REGISTRY[probe.probe_name];
      if (!entry) continue;
      const group = entry.queryGroup;
      if (!probesByGroup.has(group)) probesByGroup.set(group, []);
      probesByGroup.get(group)!.push(probe);
    }

    // Run each query group's DB query once. The results are fanned to all
    // probes in that group by the scorer dispatch below.
    // deno-lint-ignore no-explicit-any
    const queryResults = new Map<string, any[]>();

    // Query group: deals_with_stages (probes 1, 2)
    if (probesByGroup.has("deals_with_stages")) {
      const { data } = await adminClient
        .from("crm_deals")
        .select(`
          id, name, last_activity_at, expected_close_on, assigned_rep_id, workspace_id,
          crm_deal_stages!inner(probability)
        `)
        .is("deleted_at", null)
        .is("closed_at", null)
        .eq("workspace_id", workspaceId);

      const rows = (data ?? []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        name: d.name as string,
        last_activity_at: d.last_activity_at as string | null,
        expected_close_on: d.expected_close_on as string | null,
        assigned_rep_id: d.assigned_rep_id as string | null,
        stage_probability: (d.crm_deal_stages as Record<string, unknown>)?.probability as number | null,
        workspace_id: d.workspace_id as string,
      }));
      queryResults.set("deals_with_stages", rows);
    }

    // Query group: closed_lost_deals (probe 3)
    if (probesByGroup.has("closed_lost_deals")) {
      const { data } = await adminClient
        .from("crm_deals")
        .select(`
          id, name, loss_reason, assigned_rep_id, workspace_id,
          crm_deal_stages!inner(is_closed_lost)
        `)
        .is("deleted_at", null)
        .eq("crm_deal_stages.is_closed_lost", true)
        .eq("workspace_id", workspaceId);

      queryResults.set("closed_lost_deals", (data ?? []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        name: d.name as string,
        loss_reason: d.loss_reason as string | null,
        assigned_rep_id: d.assigned_rep_id as string | null,
        workspace_id: d.workspace_id as string,
      })));
    }

    // Query group: deposit_mismatch (probe 4)
    if (probesByGroup.has("deposit_mismatch")) {
      const { data } = await adminClient
        .from("crm_deals")
        .select("id, name, deposit_status, assigned_rep_id, workspace_id")
        .eq("deposit_status", "verified")
        .is("deleted_at", null)
        .eq("workspace_id", workspaceId);

      const deals = (data ?? []) as Array<{ id: string; name: string; deposit_status: string; assigned_rep_id: string | null; workspace_id: string }>;

      // For each verified deal, check if a matching deposits row exists
      const dealIds = deals.map((d) => d.id);
      let verifiedDepositDealIds = new Set<string>();
      if (dealIds.length > 0) {
        const { data: deposits } = await adminClient
          .from("deposits")
          .select("deal_id")
          .in("deal_id", dealIds)
          .eq("status", "verified");
        verifiedDepositDealIds = new Set((deposits ?? []).map((d: Record<string, unknown>) => d.deal_id as string));
      }

      queryResults.set("deposit_mismatch", deals.map((d) => ({
        ...d,
        has_verified_deposit: verifiedDepositDealIds.has(d.id),
      })));
    }

    // Query group: margin_mismatch (probe 5)
    if (probesByGroup.has("margin_mismatch")) {
      const { data } = await adminClient
        .from("crm_deals")
        .select("id, name, margin_check_status, margin_pct, assigned_rep_id, workspace_id")
        .in("margin_check_status", ["passed", "approved_by_manager"])
        .is("margin_pct", null)
        .is("deleted_at", null)
        .eq("workspace_id", workspaceId);

      queryResults.set("margin_mismatch", data ?? []);
    }

    // Query group: retroactive_activities (probe 6)
    if (probesByGroup.has("retroactive_activities")) {
      // Only look at activities created since yesterday — not the full
      // history. This keeps the query bounded and the scan incremental.
      const yesterday = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await adminClient
        .from("crm_activities")
        .select("id, occurred_at, created_at, created_by, deal_id, workspace_id")
        .gte("created_at", yesterday)
        .eq("workspace_id", workspaceId);

      queryResults.set("retroactive_activities", data ?? []);
    }

    // ── 3. Run scorers and collect observations ─────────────────────────
    const allObservations: Array<HonestyObservation & { probe_id: string }> = [];
    let probesRun = 0;
    let probesFailed = 0;

    for (const probe of enabledProbes) {
      const entry = PROBE_REGISTRY[probe.probe_name];
      if (!entry) continue;

      try {
        let observations: HonestyObservation[] = [];
        const rows = queryResults.get(entry.queryGroup) ?? [];

        switch (probe.probe_name) {
          case "high_prob_no_activity_14d":
            observations = scoreHighProbNoActivity(rows, nowMs);
            break;
          case "close_imminent_no_activity":
            observations = scoreCloseImminentNoActivity(rows, nowMs);
            break;
          case "closed_lost_no_reason":
            observations = scoreClosedLostNoReason(rows);
            break;
          case "deposit_state_mismatch":
            observations = scoreDepositStateMismatch(rows);
            break;
          case "margin_passed_no_pct":
            observations = scoreMarginPassedNoPct(rows);
            break;
          case "retroactive_activity":
            observations = scoreRetroactiveActivity(rows);
            break;
          default:
            // Unknown probe name — skip gracefully
            continue;
        }

        probesRun++;
        for (const obs of observations) {
          allObservations.push({ ...obs, probe_id: probe.id });
        }
      } catch (probeErr) {
        probesFailed++;
        console.error(`[${FN_NAME}] probe ${probe.probe_name} failed:`, probeErr);
        captureEdgeException(probeErr, {
          fn: FN_NAME,
          req,
          extra: { probe_name: probe.probe_name, probe_id: probe.id },
        });
      }
    }

    // ── 4. Batch-insert observations ────────────────────────────────────
    let observationsCreated = 0;
    if (allObservations.length > 0) {
      const insertRows = allObservations.map((obs) => ({
        workspace_id: workspaceId,
        probe_id: obs.probe_id,
        observed_at: new Date().toISOString(),
        observation_type: obs.observation_type,
        entity_type: obs.entity_type,
        entity_id: obs.entity_id,
        expected_state: obs.expected_state,
        actual_state: obs.actual_state,
        discrepancy_score: obs.discrepancy_score,
        attributed_user_id: obs.attributed_user_id,
        metadata: obs.metadata,
      }));

      const { error: insertError } = await adminClient
        .from("qrm_honesty_observations")
        .insert(insertRows);

      if (insertError) {
        console.error(`[${FN_NAME}] observations insert failed:`, insertError);
        captureEdgeException(new Error(`observations insert: ${insertError.message}`), {
          fn: FN_NAME,
          req,
          extra: { row_count: insertRows.length },
        });
      } else {
        observationsCreated = insertRows.length;
      }
    }

    // ── 5. Compute daily rollup ─────────────────────────────────────────
    const totalDiscrepancy = allObservations.reduce((sum, o) => sum + o.discrepancy_score, 0);
    const totalObs = allObservations.length;
    const honestyIndex = totalObs > 0
      ? Math.max(0, Math.min(1, 1 - (totalDiscrepancy / totalObs)))
      : 1.0; // No observations = perfect honesty (nothing to flag)

    // Build per-probe breakdown
    const breakdown: Record<string, { count: number; discrepancy_sum: number }> = {};
    for (const obs of allObservations) {
      if (!breakdown[obs.observation_type]) {
        breakdown[obs.observation_type] = { count: 0, discrepancy_sum: 0 };
      }
      breakdown[obs.observation_type].count++;
      breakdown[obs.observation_type].discrepancy_sum += obs.discrepancy_score;
    }

    // Upsert daily rollup (ON CONFLICT workspace_id + rollup_date)
    const { error: rollupError } = await adminClient
      .from("qrm_honesty_daily")
      .upsert(
        {
          workspace_id: workspaceId,
          rollup_date: today,
          total_observations: totalObs,
          total_discrepancy: totalDiscrepancy,
          honesty_index: Number(honestyIndex.toFixed(4)),
          probe_breakdown: breakdown,
        },
        { onConflict: "workspace_id,rollup_date" },
      );

    if (rollupError) {
      console.error(`[${FN_NAME}] daily rollup upsert failed:`, rollupError);
      captureEdgeException(new Error(`daily rollup: ${rollupError.message}`), {
        fn: FN_NAME,
        req,
        extra: { rollup_date: today },
      });
    }

    console.log(
      `[${FN_NAME}] probes_run=${probesRun} failed=${probesFailed} ` +
        `observations=${observationsCreated} honesty_index=${honestyIndex.toFixed(4)}`,
    );

    return safeJsonOk({
      ok: true,
      probes_run: probesRun,
      probes_failed: probesFailed,
      observations_created: observationsCreated,
      honesty_index: Number(honestyIndex.toFixed(4)),
      probe_breakdown: breakdown,
    }, null);
  } catch (err) {
    captureEdgeException(err, { fn: FN_NAME, req });
    console.error(`[${FN_NAME}] error:`, err);
    return safeJsonError("Internal server error", 500, null);
  }
});
