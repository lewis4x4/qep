/**
 * Handoff Trust Panel — Phase 3 Slice 3.1.
 *
 * Renders cross-role handoff quality scores as a heat-map style surface.
 * Each cell shows the average composite score for a (from_role → to_role)
 * seam over the last 30 days. Only visible to managers/owners/admins.
 *
 * Reads from `handoff_role_seam_scores` via the edge function or direct
 * Supabase query (RLS gates access).
 */
import { useQuery } from "@tanstack/react-query";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

type IronRole = "iron_manager" | "iron_advisor" | "iron_woman" | "iron_man";

interface SeamScore {
  id: string;
  from_iron_role: IronRole;
  to_iron_role: IronRole;
  handoff_count: number;
  scored_count: number;
  avg_composite: number | null;
  avg_info_completeness: number | null;
  avg_recipient_readiness: number | null;
  avg_outcome_alignment: number | null;
  improved_pct: number | null;
  degraded_pct: number | null;
}

const ROLE_LABELS: Record<IronRole, string> = {
  iron_manager: "MGR",
  iron_advisor: "ADV",
  iron_woman: "WMN",
  iron_man: "MAN",
};

const ROLE_COLORS: Record<IronRole, string> = {
  iron_manager: "text-blue-400",
  iron_advisor: "text-emerald-400",
  iron_woman: "text-purple-400",
  iron_man: "text-amber-400",
};

function scoreColor(score: number | null): string {
  if (score === null) return "bg-white/5 text-slate-600";
  if (score >= 0.8) return "bg-emerald-500/20 text-emerald-400";
  if (score >= 0.6) return "bg-yellow-500/20 text-yellow-400";
  if (score >= 0.4) return "bg-orange-500/20 text-orange-400";
  return "bg-red-500/20 text-red-400";
}

function scoreLabel(score: number | null): string {
  if (score === null) return "—";
  return (score * 100).toFixed(0);
}

export function HandoffTrustPanel() {
  const { profile } = useAuth();

  const { data: scores = [], isLoading } = useQuery({
    queryKey: ["exec", "handoff-trust"],
    queryFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/handoff_role_seam_scores?select=*&order=avg_composite.asc.nullslast&limit=20`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token ?? ""}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
          },
        },
      );
      if (!res.ok) return [];
      return (await res.json()) as SeamScore[];
    },
    staleTime: 5 * 60_000,
    enabled:
      profile?.role === "manager" ||
      profile?.role === "owner" ||
      profile?.role === "admin",
  });

  if (
    profile?.role !== "manager" &&
    profile?.role !== "owner" &&
    profile?.role !== "admin"
  ) {
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
        <div className="flex items-center gap-2 mb-2">
          <ArrowRightLeft className="h-4 w-4 text-qep-orange" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
            Handoff Trust Ledger
          </span>
        </div>
        <p className="text-xs text-slate-500">
          No handoff data yet. Scores populate as deals and tasks move between roles.
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
        <span className="text-[9px] text-slate-600">
          {scores.reduce((s, r) => s + r.handoff_count, 0)} handoffs scored
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {scores.map((s) => (
          <GlassPanel key={s.id} className="p-3 space-y-2">
            {/* Seam header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                <span className={ROLE_COLORS[s.from_iron_role]}>
                  {ROLE_LABELS[s.from_iron_role]}
                </span>
                <span className="text-white/30">→</span>
                <span className={ROLE_COLORS[s.to_iron_role]}>
                  {ROLE_LABELS[s.to_iron_role]}
                </span>
              </div>
              <span
                className={`text-xs font-bold tabular-nums rounded px-1.5 py-0.5 ${scoreColor(s.avg_composite)}`}
              >
                {scoreLabel(s.avg_composite)}
              </span>
            </div>

            {/* Sub-scores */}
            <div className="grid grid-cols-3 gap-1 text-[9px]">
              <div className="text-center">
                <div className="text-slate-500">Info</div>
                <div className={`font-semibold ${scoreColor(s.avg_info_completeness).split(" ")[1]}`}>
                  {scoreLabel(s.avg_info_completeness)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-slate-500">Ready</div>
                <div className={`font-semibold ${scoreColor(s.avg_recipient_readiness).split(" ")[1]}`}>
                  {scoreLabel(s.avg_recipient_readiness)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-slate-500">Result</div>
                <div className={`font-semibold ${scoreColor(s.avg_outcome_alignment).split(" ")[1]}`}>
                  {scoreLabel(s.avg_outcome_alignment)}
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
