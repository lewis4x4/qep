import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Radar, AlertTriangle, DollarSign, TrendingUp, Clock, Wrench, Loader2,
} from "lucide-react";
import { AskIronAdvisorButton } from "@/components/primitives";
import { fetchFleetRadar, type FleetRadarLensItem, type FleetRadarResponse } from "../lib/account-360-api";
import { accountCommandUrl } from "../lib/account-links";
import { supabase } from "@/lib/supabase";

type LensKey = "aging" | "expensive" | "trade_up" | "underutilized" | "attachment_upsell";

const LENS_META: Record<LensKey, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  aging: {
    label: "Aging",
    icon: <Clock className="h-3.5 w-3.5" />,
    color: "text-amber-400 border-amber-500/30",
    description: "Engine hours past replacement window",
  },
  expensive: {
    label: "Expensive to maintain",
    icon: <DollarSign className="h-3.5 w-3.5" />,
    color: "text-red-400 border-red-500/30",
    description: "Lifetime parts spend crossing the cost-curve heuristic",
  },
  trade_up: {
    label: "Trade-up window",
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    color: "text-emerald-400 border-emerald-500/30",
    description: "Trade-up score 70+ — high-priority commercial opportunity",
  },
  underutilized: {
    label: "Under-utilized",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: "text-blue-400 border-blue-500/30",
    description: "No activity in 30+ days — possible idle asset",
  },
  attachment_upsell: {
    label: "Attachment upsell",
    icon: <Wrench className="h-3.5 w-3.5" />,
    color: "text-violet-400 border-violet-500/30",
    description: "No attachments registered — upsell opportunity",
  },
};

const DRAFT_EMAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-email`;

export function FleetRadarPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const [activeLens, setActiveLens] = useState<LensKey | "all">("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["fleet-radar", companyId],
    queryFn: () => fetchFleetRadar(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const draftMutation = useMutation({
    mutationFn: async (item: FleetRadarLensItem) => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${DRAFT_EMAIL_URL}/draft`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenario: "trade_up",
          company_id: companyId,
          equipment_id: item.id,
          context: {
            equipment_name: item.name,
            make: item.make,
            model: item.model,
            year: item.year,
            engine_hours: item.engine_hours,
            lens: item.lens,
            reason: item.reason,
          },
          tone: "consultative",
          persist: true,
        }),
      });
      if (!res.ok) throw new Error("Draft failed");
      return res.json();
    },
  });

  const allItems = useMemo<FleetRadarLensItem[]>(() => {
    if (!data) return [];
    if (activeLens === "all") {
      return [
        ...data.aging,
        ...data.expensive,
        ...data.trade_up,
        ...data.underutilized,
        ...data.attachment_upsell,
      ];
    }
    return data[activeLens] ?? [];
  }, [data, activeLens]);

  const lensCounts: Record<LensKey, number> = {
    aging: data?.aging.length ?? 0,
    expensive: data?.expensive.length ?? 0,
    trade_up: data?.trade_up.length ?? 0,
    underutilized: data?.underutilized.length ?? 0,
    attachment_upsell: data?.attachment_upsell.length ?? 0,
  };
  const totalCount = Object.values(lensCounts).reduce((s, n) => s + n, 0);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Card className="h-64 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="h-7 text-[11px] mb-2">
            <Link to={companyId ? accountCommandUrl(companyId) : "/qrm/companies"}>
              <ArrowLeft className="mr-1 h-3 w-3" aria-hidden />
              Back to account
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Fleet Opportunity Radar</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Five lenses across this customer's fleet. Each row offers a one-click commercial action.
          </p>
        </div>
        <AskIronAdvisorButton contextType="fleet_radar" contextId={companyId} variant="inline" />
      </div>

      {/* Lens chips */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveLens("all")}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
            activeLens === "all"
              ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
              : "border-border text-muted-foreground hover:border-foreground/20"
          }`}
        >
          All ({totalCount})
        </button>
        {(Object.keys(LENS_META) as LensKey[]).map((key) => {
          const meta = LENS_META[key];
          const isActive = key === activeLens;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveLens(key)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border text-muted-foreground hover:border-foreground/20"
              }`}
            >
              {meta.icon}
              {meta.label} ({lensCounts[key]})
            </button>
          );
        })}
      </div>

      {isError && (
        <Card className="border-red-500/20 p-4">
          <p className="text-xs text-red-400">Failed to load fleet radar.</p>
        </Card>
      )}

      {!isError && allItems.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <Radar className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
          <p className="text-sm text-foreground">Clean radar.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No fleet opportunities flagged across the active lens. Try widening to "All" or run a fresh scan.
          </p>
        </Card>
      )}

      {!isError && allItems.length > 0 && (
        <div className="space-y-2">
          {allItems.map((item) => {
            const meta = LENS_META[item.lens as LensKey] ?? LENS_META.aging;
            const titleParts = [item.year, item.make, item.model].filter(Boolean);
            const drafting = draftMutation.isPending && draftMutation.variables?.id === item.id;
            return (
              <Card key={`${item.lens}-${item.id}`} className={`p-3 ${meta.color}`}>
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/equipment/${item.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase ${meta.color.split(" ")[0]}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      <p className="text-sm font-semibold text-foreground">
                        {titleParts.length > 0 ? titleParts.join(" ") : item.name}
                      </p>
                      {item.engine_hours != null && (
                        <span className="text-[10px] text-muted-foreground">
                          {Math.round(item.engine_hours).toLocaleString()}h
                        </span>
                      )}
                      {item.trade_up_score != null && (
                        <span className="text-[10px] font-semibold text-emerald-400">
                          score {item.trade_up_score}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{item.reason}</p>
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-[10px]"
                    onClick={() => draftMutation.mutate(item)}
                    disabled={drafting}
                  >
                    {drafting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                    Draft outreach
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {draftMutation.isSuccess && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-xs text-emerald-400">
            ✓ Draft created — review in Email Drafts inbox
          </p>
        </Card>
      )}
      {draftMutation.isError && (
        <Card className="border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs text-red-400">
            {(draftMutation.error as Error)?.message ?? "Draft failed"}
          </p>
        </Card>
      )}
    </div>
  );
}
