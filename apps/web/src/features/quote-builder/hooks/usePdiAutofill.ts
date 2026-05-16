// QRM Quote Builder — PDI rolling-average autofill hook.
//
// Introduced as PR 6 of the IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
// Refactor only — behavior is already correct against `pdi_average_by_model`
// in production. Extraction de-risks future Cluster B edits by giving
// PricingStep (PR 14) a single named seam instead of two intertwined
// blocks (`useQuery` + autofill `useEffect`) at lines 2319-2367 of
// `QuoteBuilderV2Page.tsx`.
//
// Behavior contract (preserved 1:1):
//   1. Make + model must both be non-empty (case-insensitive, trimmed)
//      before the query fires.
//   2. The query selects `avg_pdi_cost` and `sample_count` from
//      `pdi_average_by_model` for the workspace + make + model.
//   3. A non-finite or non-positive `avg_pdi_cost` resolves to `null`
//      (no autofill).
//   4. If the rep has already entered a PDI value > 0, autofill is
//      suppressed — rep input always wins.
//   5. The autofilled amount is `Math.round(avgPdiCost)`; if the rounded
//      amount is <= 0 it is not applied.
//   6. The hook never mutates pricing-line state directly. It calls the
//      caller-supplied `onAutofill` exactly once per "should autofill
//      now" transition; the caller decides how to write metadata
//      (`pdi_source`, `pdi_sample_count`, etc.) into the pricing line.

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

const PDI_AVG_QUERY_STALE_MS = 60_000;

export interface PdiAverageByModel {
  avgPdiCost: number;
  sampleCount: number;
}

export interface UsePdiAutofillInput {
  workspaceId: string | null;
  make: string | null | undefined;
  model: string | null | undefined;
  /** Current rep-set PDI line amount; autofill is suppressed when > 0. */
  currentPdiAmount: number;
  /** Called when an autofill should apply. Caller writes the pricing line. */
  onAutofill: (params: { amount: number; sampleCount: number }) => void;
}

export interface UsePdiAutofillResult {
  data: PdiAverageByModel | null;
  isLoading: boolean;
  isError: boolean;
  /** True when the make+model pair is non-empty and the query is enabled. */
  eligible: boolean;
}

export function usePdiAutofill({
  workspaceId,
  make,
  model,
  currentPdiAmount,
  onAutofill,
}: UsePdiAutofillInput): UsePdiAutofillResult {
  const normalizedMake = (make ?? "").trim().toLowerCase();
  const normalizedModel = (model ?? "").trim().toLowerCase();
  const eligible = normalizedMake.length > 0 && normalizedModel.length > 0;

  const query = useQuery({
    queryKey: ["pdi-average-by-model", workspaceId, normalizedMake, normalizedModel],
    enabled: Boolean(workspaceId && eligible),
    staleTime: PDI_AVG_QUERY_STALE_MS,
    queryFn: async (): Promise<PdiAverageByModel | null> => {
      const { data, error } = await supabase
        .from("pdi_average_by_model")
        .select("avg_pdi_cost, sample_count")
        .eq("workspace_id", workspaceId)
        .eq("make", normalizedMake)
        .eq("model", normalizedModel)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const avg = Number((data as { avg_pdi_cost?: number | string }).avg_pdi_cost ?? 0);
      if (!Number.isFinite(avg) || avg <= 0) return null;
      return {
        avgPdiCost: avg,
        sampleCount: Number((data as { sample_count?: number | string }).sample_count ?? 0) || 0,
      };
    },
  });

  // Stash onAutofill in a ref so the autofill effect's deps stay focused
  // on the values that actually gate firing (data, eligibility, and the
  // current rep-set amount). Without the ref, every parent re-render
  // would rebuild the inline callback identity and re-fire the effect,
  // which is fine for correctness today (the gates short-circuit) but
  // adds noise that PR 14 (PricingStep extraction) doesn't want to
  // inherit.
  const onAutofillRef = useRef(onAutofill);
  useEffect(() => {
    onAutofillRef.current = onAutofill;
  }, [onAutofill]);

  useEffect(() => {
    const data = query.data;
    if (!data || !eligible) return;
    if (currentPdiAmount > 0) return;
    const amount = Math.round(data.avgPdiCost);
    if (amount <= 0) return;
    onAutofillRef.current({ amount, sampleCount: data.sampleCount });
  }, [query.data, eligible, currentPdiAmount]);

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    eligible,
  };
}
