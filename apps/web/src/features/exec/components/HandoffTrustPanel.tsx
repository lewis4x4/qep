/**
 * Handoff Trust Panel — Phase 3 Slice 3.1.
 *
 * Renders cross-role handoff quality scores as a heat-map style surface.
 * Each cell shows the average composite score for a (from_role → to_role)
 * seam over the last 30 days. Only visible to managers and owners.
 *
 * Reads from `handoff_role_seam_scores` via direct Supabase query
 * (RLS gates access).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  HANDOFF_ROLE_LABELS,
  formatScore,
  latestSeamScores,
  scoreTone,
  type HandoffSeamScoreRow,
} from "../lib/handoff-trust";

export function HandoffTrustPanel() {
  const { profile } = useAuth();

  const { data: scores = [], isLoading } = useQuery({
    queryKey: ["exec", "handoff-trust"],
    queryFn: async (): Promise<HandoffSeamScoreRow[]> => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            gte: (column: string, value: string) => {
              order: (column: string, options: { ascending: boolean }) => Promise<{ data: HandoffSeamScoreRow[] | null; error: { message?: string } | null }>;
            };
          };
        };
      })
        .from("handoff_role_seam_scores")
        .select("id, from_iron_role, to_iron_role, handoff_count, scored_count, avg_composite, avg_info_completeness, avg_recipient_readiness, avg_outcome_alignment, improved_pct, degraded_pct, period_start, period_end")
        .gte("period_end", since)
        .order("period_end", { ascending: false });
      if (error) throw new Error(error.message ?? "Failed to load handoff trust scores.");
      return latestSeamScores(data ?? []);
    },
    staleTime: 5 * 60_000,
    enabled: profile?.role === "manager" || profile?.role === "owner",
  });

  if (profile?.role !== "manager" && profile?.role !== "owner") {
    return null;
  }

  if (isLoading) {
    return (
      <GlassPanel className="p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-40 rounded bg-white/5" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-white/[0.03]" />
            ))}
          </div>
        </div>
      </GlassPanel>
    );
  }

  if (scores.length === 0) {
    return (
      <GlassPanel className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-qep-orange" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Handoff Trust Ledger
            </span>
          </div>
          <Button asChild size="sm" variant="ghost" className="h-7 text-[10px]">
            <Link to="/executive/handoffs">Open ledger</Link>
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          No handoff data yet. Scores populate as real work crosses roles and the nightly scorer evaluates each seam.
        </p>
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-qep-orange" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
            Handoff Trust Ledger
          </span>
          <Badge variant="outline" className="text-[9px] border-white/10 text-white/40 px-1.5">
            30-day rolling
          </Badge>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button asChild size="sm" variant="ghost" className="h-7 text-[10px]">
            <Link to="/executive/handoffs">Open ledger</Link>
          </Button>
          <span className="text-[9px] text-slate-600">
            {scores.reduce((s, r) => s + r.handoff_count, 0)} handoffs scored
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {scores.map((s) => (
          <GlassPanel key={s.id} className="p-3 space-y-2">
            {/* Seam header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                <span className="text-emerald-400">
                  {HANDOFF_ROLE_LABELS[s.from_iron_role]}
                </span>
                <span className="text-white/30">→</span>
                <span className="text-amber-400">
                  {HANDOFF_ROLE_LABELS[s.to_iron_role]}
                </span>
              </div>
              <span
                className={`text-xs font-bold tabular-nums rounded px-1.5 py-0.5 ${scoreTone(s.avg_composite)}`}
              >
                {formatScore(s.avg_composite)}
              </span>
            </div>

            {/* Sub-scores */}
            <div className="grid grid-cols-3 gap-1 text-[9px]">
              <div className="text-center">
                <div className="text-slate-500">Info</div>
                <div className={`font-semibold ${scoreTone(s.avg_info_completeness).split(" ")[1]}`}>
                  {formatScore(s.avg_info_completeness)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-slate-500">Ready</div>
                <div className={`font-semibold ${scoreTone(s.avg_recipient_readiness).split(" ")[1]}`}>
                  {formatScore(s.avg_recipient_readiness)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-slate-500">Result</div>
                <div className={`font-semibold ${scoreTone(s.avg_outcome_alignment).split(" ")[1]}`}>
                  {formatScore(s.avg_outcome_alignment)}
                </div>
              </div>
            </div>

            {/* Count + outcome */}
            <div className="flex items-center justify-between text-[8px] text-slate-600">
              <span>{s.scored_count} scored</span>
              {s.improved_pct !== null && (
                <span>
                  {((s.improved_pct ?? 0) * 100).toFixed(0)}% improved,{" "}
                  {((s.degraded_pct ?? 0) * 100).toFixed(0)}% degraded
                </span>
              )}
            </div>
          </GlassPanel>
        ))}
      </div>
    </div>
  );
}
