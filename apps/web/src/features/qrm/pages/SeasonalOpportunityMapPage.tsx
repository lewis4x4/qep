import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ArrowUpRight } from "lucide-react";
import { MapWithSidebar, MapLibreCanvas, type MapMarker, type MapOverlay } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/format";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildSeasonalOpportunityBoard } from "../lib/seasonal-opportunity-map";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface } from "../components/command-deck";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";

const DEFAULT_OVERLAYS: MapOverlay[] = [
  { key: "seasonal", label: "Seasonal pattern", enabled: true },
  { key: "budget_cycle", label: "Budget cycle", enabled: true },
  { key: "visits", label: "Visit targets", enabled: true },
];

function confidenceTone(confidence: "high" | "medium" | "low"): "green" | "orange" | "blue" {
  switch (confidence) {
    case "high":
      return "green";
    case "medium":
      return "orange";
    default:
      return "blue";
  }
}

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toMetadataRecord(value: unknown): Record<string, unknown> {
  return isMetadataRecord(value) ? value : {};
}

export function SeasonalOpportunityMapPage() {
  const navigate = useNavigate();
  const [overlays, setOverlays] = useState<MapOverlay[]>(DEFAULT_OVERLAYS);
  const today = new Date().toISOString().split("T")[0];

  const boardQuery = useQuery({
    queryKey: ["qrm", "seasonal-opportunity-map", today],
    queryFn: async () => {
      const [equipmentResult, contactsResult, profilesResult, visitsResult, deals] = await Promise.all([
        supabase
          .from("crm_equipment")
          .select("company_id, metadata, crm_companies(name)")
          .eq("ownership", "customer_owned")
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("crm_contacts")
          .select("primary_company_id, dge_customer_profile_id")
          .not("dge_customer_profile_id", "is", null)
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("customer_profiles_extended")
          .select("id, company_name, seasonal_pattern, budget_cycle_month")
          .limit(1000),
        supabase
          .from("predictive_visit_lists")
          .select("recommendations")
          .eq("list_date", today)
          .limit(50),
        listCrmWeightedOpenDeals(),
      ]);

      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (contactsResult.error) throw new Error(contactsResult.error.message);
      if (profilesResult.error) throw new Error(profilesResult.error.message);
      if (visitsResult.error) throw new Error(visitsResult.error.message);

      const companyByProfile = new Map(
        (contactsResult.data ?? []).map((row) => [row.dge_customer_profile_id, row.primary_company_id]),
      );

      const visitRecommendations = (visitsResult.data ?? []).flatMap((row) => {
        const recs = Array.isArray(row.recommendations) ? row.recommendations : [];
        return recs
          .filter((rec): rec is Record<string, unknown> => rec != null && typeof rec === "object")
          .map((rec) => ({
            companyId: typeof rec.company_id === "string" ? rec.company_id : null,
          }));
      });

      return buildSeasonalOpportunityBoard({
        equipment: (equipmentResult.data ?? []).map((row) => {
          const metadata = toMetadataRecord(row.metadata);
          const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
          return {
            companyId: row.company_id,
            companyName: companyJoin?.name ?? null,
            lat: metadata.lat != null ? Number(metadata.lat) : null,
            lng: metadata.lng != null ? Number(metadata.lng) : null,
          };
        }),
        profiles: (profilesResult.data ?? [])
          .flatMap((row) => {
            const companyId = companyByProfile.get(row.id);
            if (!companyId) return [];
            return [{
              companyId,
              companyName: row.company_name,
              seasonalPattern: row.seasonal_pattern,
              budgetCycleMonth: row.budget_cycle_month,
            }];
          }),
        visitRecommendations,
        deals: deals.map((deal) => ({
          companyId: deal.companyId,
          weightedAmount: deal.weightedAmount,
        })),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const visibleRows = useMemo(() => {
    const enabled = new Set(overlays.filter((overlay) => overlay.enabled).map((overlay) => overlay.key));
    return (boardQuery.data?.rows ?? []).filter((row) => {
      const seasonal = row.seasonalPattern != null && row.seasonalPattern !== "steady";
      const budgetCycle = row.budgetCycleMonth != null;
      const visits = row.visitTargets > 0;
      return (
        (enabled.has("seasonal") && seasonal) ||
        (enabled.has("budget_cycle") && budgetCycle) ||
        (enabled.has("visits") && visits)
      );
    });
  }, [boardQuery.data?.rows, overlays]);

  const markers = useMemo<MapMarker[]>(() => visibleRows.map((row) => ({
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    label: row.label,
    tone: confidenceTone(row.confidence),
    onClick: () => navigate(buildAccountCommandHref(row.companyId)),
  })), [navigate, visibleRows]);

  const summary = boardQuery.data?.summary;
  const mapped = summary?.mappedAccounts ?? 0;
  const seasonal = summary?.seasonalAccounts ?? 0;
  const budget = summary?.budgetCycleAccounts ?? 0;
  const weighted = summary?.weightedRevenue ?? 0;
  const visits = summary?.visitTargets ?? 0;

  // Cascading Iron briefing — route to the sharpest seasonal lever.
  const seasonalIronHeadline = boardQuery.isLoading
    ? "Fusing seasonal patterns, budget cycles, and visit timing into a routeable canvas…"
    : boardQuery.isError
      ? "Seasonal map offline — one of the feeders failed. Check the console."
      : budget > 0
        ? `${budget} account${budget === 1 ? "" : "s"} near a budget-cycle month — timing is your sharpest lever. ${fmtMoney(weighted)} weighted · ${visits} visit target${visits === 1 ? "" : "s"}.`
        : seasonal > 0
          ? `${seasonal} account${seasonal === 1 ? "" : "s"} in an active seasonal pattern — route before demand peaks. ${fmtMoney(weighted)} weighted revenue on the canvas.`
          : visits > 0
            ? `${visits} visit target${visits === 1 ? "" : "s"} on the map today — drive them before the week compounds.`
            : mapped > 0
              ? `${mapped} mapped account${mapped === 1 ? "" : "s"}, ${fmtMoney(weighted)} weighted. No peak timing pressure — press white-space.`
              : "No mapped seasonal signals yet — accounts need coordinates and a pattern before the map lights up.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-2 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Seasonal Opportunity"
        subtitle="Time-of-year demand shifts and budget windows translated into routeable opportunity."
        crumb={{ surface: "TODAY", lens: "SEASONAL", count: mapped }}
        metrics={[
          { label: "Mapped", value: mapped.toLocaleString() },
          { label: "Seasonal", value: seasonal, tone: seasonal > 0 ? "active" : undefined },
          { label: "Budget win", value: budget, tone: budget > 0 ? "hot" : undefined },
          { label: "Weighted", value: fmtMoney(weighted), tone: weighted > 0 ? "live" : undefined },
          { label: "Visits", value: visits, tone: visits > 0 ? "ok" : undefined },
        ]}
        ironBriefing={{
          headline: seasonalIronHeadline,
          actions: [{ label: "Opportunity map →", href: "/qrm/opportunity-map" }],
        }}
      />
      <QrmSubNav />

      <MapWithSidebar
        sidebarHeader={
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {boardQuery.isLoading ? "Loading…" : `${visibleRows.length} seasonal signals`}
          </div>
        }
        sidebar={
          <div className="divide-y divide-qep-deck-rule/40">
            {visibleRows.map((row) => (
              <div key={row.id} className="p-2.5">
                <p className="truncate text-[13px] font-medium text-foreground">{row.label}</p>
                <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {formatCurrency(row.weightedRevenue)} weighted · {row.visitTargets} visit{row.visitTargets === 1 ? "" : "s"}
                </p>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">{row.reasons.join(" · ")}</p>
                <div className="mt-1">
                  <Button asChild size="sm" variant="ghost" className="h-6 px-0 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                    <Link to={buildAccountCommandHref(row.companyId)}>
                      Open <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
            {!boardQuery.isLoading && visibleRows.length === 0 && (
              <DeckSurface className="m-2 p-3">
                <p className="text-xs text-muted-foreground">No routeable seasonal signals are active right now.</p>
              </DeckSurface>
            )}
          </div>
        }
        mapContent={
          markers.length > 0 ? (
            <MapLibreCanvas markers={markers} cluster />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-foreground">
                  {boardQuery.isLoading ? "Loading seasonal opportunity map…" : "No mapped seasonal signals yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Signals appear when accounts have mapped equipment plus seasonality, budget-cycle, or predictive-visit timing.
                </p>
              </div>
            </div>
          )
        }
        overlays={overlays}
        onOverlayToggle={(key, enabled) => setOverlays((current) => current.map((overlay) => overlay.key === key ? { ...overlay, enabled } : overlay))}
      />
    </div>
  );
}
