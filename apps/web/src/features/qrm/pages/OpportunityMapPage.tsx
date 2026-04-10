import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { MapWithSidebar, MapLibreCanvas, type MapMarker, type MapOverlay } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Map as MapIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildOpportunityMapBoard } from "../lib/opportunity-map";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

const DEFAULT_OVERLAYS: MapOverlay[] = [
  { key: "open_revenue", label: "Open revenue", enabled: true },
  { key: "visit_targets", label: "Visit targets", enabled: true },
  { key: "rentals", label: "Active rentals", enabled: true },
  { key: "trades", label: "Trade signals", enabled: true },
];

export function OpportunityMapPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [overlays, setOverlays] = useState<MapOverlay[]>(DEFAULT_OVERLAYS);
  const today = new Date().toISOString().split("T")[0];

  const boardQuery = useQuery({
    queryKey: ["qrm", "opportunity-map", profile?.id, today],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const [equipmentResult, dealsResult, visitsResult, tradesResult] = await Promise.all([
        supabase
          .from("crm_equipment")
          .select("id, company_id, ownership, availability, name, metadata, crm_companies(name)")
          .is("deleted_at", null)
          .in("ownership", ["customer_owned", "rental_fleet"])
          .limit(1000),
        supabase
          .from("crm_deals")
          .select("id, company_id, amount")
          .is("deleted_at", null)
          .is("closed_at", null)
          .limit(1000),
        supabase
          .from("predictive_visit_lists")
          .select("recommendations")
          .eq("list_date", today)
          .limit(50),
        supabase
          .from("customer_fleet")
          .select("equipment_id")
          .eq("trade_in_interest", true)
          .eq("is_active", true)
          .limit(1000),
      ]);

      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (visitsResult.error) throw new Error(visitsResult.error.message);
      if (tradesResult.error) throw new Error(tradesResult.error.message);

      const visitRecommendations = (visitsResult.data ?? []).flatMap((row) => {
        const recs = Array.isArray(row.recommendations) ? row.recommendations : [];
        return recs
          .filter((rec): rec is Record<string, unknown> => rec != null && typeof rec === "object")
          .map((rec) => ({
            companyId: typeof rec.company_id === "string" ? rec.company_id : null,
            companyName: typeof rec.company_name === "string" ? rec.company_name : null,
            priorityScore: typeof rec.priority_score === "number" ? rec.priority_score : null,
          }));
      });

      return buildOpportunityMapBoard({
        equipment: (equipmentResult.data ?? []).map((row) => {
          const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
          const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
          return {
            id: row.id,
            companyId: row.company_id,
            companyName: companyJoin?.name ?? null,
            ownership: row.ownership,
            availability: row.availability,
            name: row.name,
            lat: metadata.lat != null ? Number(metadata.lat) : null,
            lng: metadata.lng != null ? Number(metadata.lng) : null,
          };
        }),
        deals: (dealsResult.data ?? []).map((row) => ({
          id: row.id,
          companyId: row.company_id,
          amount: row.amount,
        })),
        visitRecommendations,
        tradeSignals: (tradesResult.data ?? []).map((row) => ({ equipmentId: row.equipment_id })),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const visibleRows = useMemo(() => {
    const enabled = new Set(overlays.filter((overlay) => overlay.enabled).map((overlay) => overlay.key));
    return (boardQuery.data?.rows ?? []).filter((row) => {
      if (row.kind === "rental") return enabled.has("rentals");
      return (
        (enabled.has("open_revenue") && row.openRevenue > 0) ||
        (enabled.has("visit_targets") && row.visitTargetCount > 0) ||
        (enabled.has("trades") && row.tradeSignalCount > 0) ||
        (!enabled.has("open_revenue") && !enabled.has("visit_targets") && !enabled.has("trades"))
      );
    });
  }, [boardQuery.data?.rows, overlays]);

  const markers = useMemo<MapMarker[]>(() => visibleRows.map((row) => ({
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    label: row.label,
    tone: row.kind === "rental" ? "orange" : row.tradeSignalCount > 0 ? "violet" : row.visitTargetCount > 0 ? "green" : "blue",
    onClick: () => {
      if (row.kind === "rental") {
        navigate("/qrm/rentals");
      } else {
        navigate(buildAccountCommandHref(row.companyId ?? ""));
      }
    },
  })), [navigate, visibleRows]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-2 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Opportunity Map"
        subtitle="Geographic overlay of open revenue, visit targets, rentals, and trade signals."
      />
      <QrmSubNav />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Mapped Accounts" value={String(boardQuery.data?.summary.mappedAccounts ?? 0)} detail="Customer-owned equipment with usable coordinates." />
        <SummaryCard label="Open Revenue" value={formatCurrency(boardQuery.data?.summary.openRevenue ?? 0)} detail="Pipeline value currently represented on the map." />
        <SummaryCard label="Visit Targets" value={String(boardQuery.data?.summary.visitTargets ?? 0)} detail="Today’s predictive visit targets with map anchors." />
        <SummaryCard label="Trade Signals" value={String(boardQuery.data?.summary.tradeSignals ?? 0)} detail={`${boardQuery.data?.summary.activeRentals ?? 0} active rental markers also available`} />
      </div>

      <MapWithSidebar
        sidebarHeader={
          <div className="text-[10px] text-muted-foreground">
            {boardQuery.isLoading ? "Loading…" : `${visibleRows.length} mapped signals`}
          </div>
        }
        sidebar={
          <div className="divide-y divide-border">
            {visibleRows.map((row) => (
              <div key={row.id} className="p-2">
                <p className="text-xs font-medium text-foreground">{row.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {row.kind === "rental"
                    ? "Active rental marker"
                    : `${formatCurrency(row.openRevenue)} open revenue · ${row.visitTargetCount} visit target${row.visitTargetCount === 1 ? "" : "s"} · ${row.tradeSignalCount} trade signal${row.tradeSignalCount === 1 ? "" : "s"}`}
                </p>
                <div className="mt-1">
                  <Button asChild size="sm" variant="ghost" className="h-7 px-0 text-[10px]">
                    <Link to={row.kind === "rental" ? "/qrm/rentals" : buildAccountCommandHref(row.companyId ?? "")}>
                      Open <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
            {!boardQuery.isLoading && visibleRows.length === 0 && (
              <Card className="m-2 p-3">
                <p className="text-xs text-muted-foreground">No mapped opportunity signals yet.</p>
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
                <MapIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-foreground">
                  {boardQuery.isLoading ? "Loading opportunity map…" : "No mapped opportunity signals yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Markers appear when customer or rental equipment carries usable coordinates in metadata.
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

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
