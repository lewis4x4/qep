import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MapWithSidebar, MapLibreCanvas, type MapMarker, type MapOverlay } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/format";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildSeasonalOpportunityBoard } from "../lib/seasonal-opportunity-map";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
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
          const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-2 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Seasonal Opportunity Map"
        subtitle="Time-of-year demand shifts and budget windows translated into routeable opportunity."
      />
      <QrmSubNav />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Mapped Accounts" value={String(boardQuery.data?.summary.mappedAccounts ?? 0)} detail="Accounts with routeable seasonal signals." />
        <SummaryCard label="Seasonal Patterns" value={String(boardQuery.data?.summary.seasonalAccounts ?? 0)} detail="Accounts with non-steady seasonality." />
        <SummaryCard label="Budget Windows" value={String(boardQuery.data?.summary.budgetCycleAccounts ?? 0)} detail="Accounts nearing a budget-cycle month." />
        <SummaryCard label="Weighted Revenue" value={formatCurrency(boardQuery.data?.summary.weightedRevenue ?? 0)} detail={`${boardQuery.data?.summary.visitTargets ?? 0} predictive visit targets`} />
      </div>

      <MapWithSidebar
        sidebarHeader={
          <div className="text-[10px] text-muted-foreground">
            {boardQuery.isLoading ? "Loading…" : `${visibleRows.length} seasonal signals`}
          </div>
        }
        sidebar={
          <div className="divide-y divide-border">
            {visibleRows.map((row) => (
              <div key={row.id} className="p-2">
                <p className="text-xs font-medium text-foreground">{row.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {formatCurrency(row.weightedRevenue)} weighted revenue · {row.visitTargets} visit target{row.visitTargets === 1 ? "" : "s"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{row.reasons.join(" · ")}</p>
                <div className="mt-1">
                  <Button asChild size="sm" variant="ghost" className="h-7 px-0 text-[10px]">
                    <Link to={buildAccountCommandHref(row.companyId)}>
                      Open <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
            {!boardQuery.isLoading && visibleRows.length === 0 && (
              <Card className="m-2 p-3">
                <p className="text-xs text-muted-foreground">No routeable seasonal signals are active right now.</p>
              </Card>
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

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open Learning Layer to turn wins, losses, workflows, and repeated operating patterns into dealership memory.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/qrm/learning-layer">
              Learning layer <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
