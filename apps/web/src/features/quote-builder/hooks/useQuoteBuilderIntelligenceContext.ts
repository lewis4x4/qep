/**
 * Post–PR 21 orchestrator slimming: win-probability / shadow intelligence queries.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { getMarginBaseline } from "../lib/coach-api";
import { getClosedDealsAudit, getFactorVerdicts } from "../lib/quote-api";
import {
  computeRetrospectiveShadows,
  computeShadowAgreementSummary,
} from "../lib/retrospective-shadow";

export function useQuoteBuilderIntelligenceContext(profileId: string | undefined, marginPct: number) {
  const userRoleQuery = useQuery({
    queryKey: ["quote-builder", "role"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return null;
      const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (error) throw error;
      return typeof data?.role === "string" ? data.role : null;
    },
    staleTime: 60_000,
  });

  const marginBaselineQuery = useQuery({
    queryKey: ["quote-builder", "margin-baseline", profileId ?? ""],
    queryFn: () => (profileId ? getMarginBaseline(profileId) : Promise.resolve(null)),
    enabled: !!profileId,
    staleTime: 5 * 60_000,
  });
  const marginBaselineMedianPct = marginBaselineQuery.data?.medianPct ?? null;

  const factorVerdictsQuery = useQuery({
    queryKey: ["quote-builder", "factor-verdicts"],
    queryFn: getFactorVerdicts,
    enabled: !!profileId,
    staleTime: 5 * 60_000,
  });
  const factorVerdicts = factorVerdictsQuery.data ?? null;

  const canLoadShadowHistory =
    !!profileId
    && (userRoleQuery.data === "manager" || userRoleQuery.data === "owner");
  const closedDealsAuditQuery = useQuery({
    queryKey: ["quote-builder", "closed-deals-audit"],
    queryFn: getClosedDealsAudit,
    enabled: canLoadShadowHistory,
    staleTime: 5 * 60_000,
  });

  const shadowHistory = useMemo(() => {
    const result = closedDealsAuditQuery.data;
    if (!result || !result.ok) return null;
    return result.audits.map((a) => ({
      packageId: a.packageId,
      factors: a.factors,
      outcome: a.outcome,
    }));
  }, [closedDealsAuditQuery.data]);

  const shadowCalibration = useMemo(() => {
    const result = closedDealsAuditQuery.data;
    if (!result || !result.ok) return null;
    if (result.audits.length === 0) return null;
    const retros = computeRetrospectiveShadows(result.audits);
    return computeShadowAgreementSummary(retros);
  }, [closedDealsAuditQuery.data]);

  const winProbContext = useMemo(
    () => ({ marginPct, marginBaselineMedianPct }),
    [marginPct, marginBaselineMedianPct],
  );

  return {
    userRoleQuery,
    factorVerdicts,
    shadowHistory,
    shadowCalibration,
    winProbContext,
  };
}
