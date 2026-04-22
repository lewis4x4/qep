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
          const metadata = (row.metadata && typeof row.metadata === "object"
            ? row.metadata
            : {}) as Record<string, unknown>;
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

  const board = boardQuery.data;
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

  if (!profile) {
    return <Navigate to="/qrm/companies" replace />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Opportunity Map</h1>
          </div>
          <Button onClick={() => navigate("/qrm/companies")}>Exit</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Geographic overlay of open revenue, visit targets, rentals, and trade signals.
        </p>
      </div>

      <div className="grid gap-3">
        <div className="flex-1">
          <MapWithSidebar
            sidebarHeader={
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  {board?.summary.mappedAccounts ?? 0} mapped signals
                </p>
              </div>
            }
            mapContent={
              markers.length > 0 ? (
                <MapLibreCanvas markers={markers} cluster />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <MapIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {board?.summary.openRevenue ? "Loading opportunity map…" : "No mapped opportunity signals yet"}
                  </p>
                </div>
              )
            }
            overlays={overlays}
            onOverlayToggle={(key, enabled) => setOverlays((current) => current.map((overlay) => overlay.key === key ? { ...overlay, enabled } : overlay))}
          />
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Mapped Accounts</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(boardQuery.data?.summary.mappedAccounts ?? 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Customer-owned equipment with usable coordinates.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Open Revenue</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{formatCurrency(boardQuery.data?.summary.openRevenue ?? 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Pipeline value currently represented on the map.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Visit Targets</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(boardQuery.data?.summary.visitTargets ?? 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Today&apos;s predictive visit targets with map anchors.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active Rentals</p>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(boardQuery.data?.summary.activeRentals ?? 0)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Active rental markers also available as an overlay.</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical route</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Opportunity Map is a signal-gathering surface. The command center remains the source of truth for operational work.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to="/qrm/companies">
                  Refresh map <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <DeckSurface className="p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </DeckSurface>
  );
}
