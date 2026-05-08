import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MapWithSidebar, MapLibreCanvas, type MapMarker, type MapOverlay } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Map as MapIcon, RotateCcw } from "lucide-react";
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

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toMetadataRecord(value: unknown): Record<string, unknown> {
  return isMetadataRecord(value) ? value : {};
}

function toCoordinate(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

      const mappedEquipment = (equipmentResult.data ?? []).map((row) => {
        const metadata = toMetadataRecord(row.metadata);
        const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
        const lat = toCoordinate(metadata.lat);
        const lng = toCoordinate(metadata.lng);
        return {
          id: row.id,
          companyId: row.company_id,
          companyName: companyJoin?.name ?? null,
          ownership: row.ownership,
          availability: row.availability,
          name: row.name,
          lat,
          lng,
        };
      });

      const equipmentRowsScanned = mappedEquipment.length;
      const equipmentWithCoordinates = mappedEquipment.filter((row) => row.lat != null && row.lng != null).length;
      const equipmentMissingCoordinates = equipmentRowsScanned - equipmentWithCoordinates;

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

      const board = buildOpportunityMapBoard({
        equipment: mappedEquipment,
        deals: (dealsResult.data ?? []).map((row) => ({
          id: row.id,
          companyId: row.company_id,
          amount: row.amount,
        })),
        visitRecommendations,
        tradeSignals: (tradesResult.data ?? []).map((row) => ({ equipmentId: row.equipment_id })),
      });

      return {
        board,
        diagnostics: {
          equipmentRowsScanned,
          equipmentWithCoordinates,
          equipmentMissingCoordinates,
          openDealRowsScanned: dealsResult.data?.length ?? 0,
          visitListRowsScanned: visitsResult.data?.length ?? 0,
          tradeSignalRowsScanned: tradesResult.data?.length ?? 0,
        },
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data?.board;
  const diagnostics = boardQuery.data?.diagnostics;

  const visibleRows = useMemo(() => {
    const enabled = new Set(overlays.filter((overlay) => overlay.enabled).map((overlay) => overlay.key));
    return (board?.rows ?? []).filter((row) => {
      if (row.kind === "rental") return enabled.has("rentals");
      return (
        (enabled.has("open_revenue") && row.openRevenue > 0) ||
        (enabled.has("visit_targets") && row.visitTargetCount > 0) ||
        (enabled.has("trades") && row.tradeSignalCount > 0) ||
        (!enabled.has("open_revenue") && !enabled.has("visit_targets") && !enabled.has("trades"))
      );
    });
  }, [board?.rows, overlays]);

  const markers: MapMarker[] = useMemo(
    () => visibleRows.map((row) => {
      const companyId = row.companyId;
      return {
        id: row.id,
        lat: row.lat,
        lng: row.lng,
        label: row.label,
        tone: row.kind === "rental" ? "violet" : row.tradeSignalCount > 0 ? "orange" : row.visitTargetCount > 0 ? "green" : "blue",
        onClick: companyId ? () => navigate(buildAccountCommandHref(companyId)) : undefined,
      };
    }),
    [navigate, visibleRows],
  );

  const summary = board?.summary;
  const mappedAccounts = summary?.mappedAccounts ?? 0;
  const openRevenue = summary?.openRevenue ?? 0;
  const visitTargets = summary?.visitTargets ?? 0;
  const activeRentals = summary?.activeRentals ?? 0;
  const tradeSignals = summary?.tradeSignals ?? 0;
  const criticalAccounts = summary?.criticalAccounts ?? 0;
  const routeCandidates = summary?.routeCandidates ?? 0;

  const hasQueryError = boardQuery.isError;
  const isLoading = boardQuery.isLoading;
  const hasRows = (board?.rows.length ?? 0) > 0;
  const hasFilteredRows = visibleRows.length > 0;
  const isFilteredEmpty = !isLoading && !hasQueryError && hasRows && !hasFilteredRows;
  const isTrueEmpty = !isLoading && !hasQueryError && !hasRows;

  const sidebarHeaderText = isLoading
    ? "Loading diagnostics…"
    : hasQueryError
      ? "Query error · refresh to retry"
      : diagnostics
        ? `Scanned · equip ${diagnostics.equipmentRowsScanned} (${diagnostics.equipmentWithCoordinates} mapped, ${diagnostics.equipmentMissingCoordinates} missing coords) · deals ${diagnostics.openDealRowsScanned} · visits ${diagnostics.visitListRowsScanned} · trades ${diagnostics.tradeSignalRowsScanned}`
        : `${visibleRows.length} mapped signals · ${tradeSignals} trade signal${tradeSignals === 1 ? "" : "s"}`;

  const ironHeadline = isLoading
    ? "Iron is scanning mapped opportunity signals and triaging the highest-pressure accounts."
    : hasQueryError
      ? "Opportunity map feed is offline — one or more source queries failed."
      : isFilteredEmpty
        ? "Filters are hiding all mapped rows — enable revenue, visit, rental, or trade overlays to repopulate the board."
        : isTrueEmpty
          ? "No mapped opportunity rows yet — add equipment coordinates and at least one open deal, visit signal, or trade flag."
          : criticalAccounts > 0
            ? `${criticalAccounts} critical account${criticalAccounts === 1 ? "" : "s"} need action now. ${routeCandidates} route candidate${routeCandidates === 1 ? "" : "s"} are ready for command routing.`
            : `${mappedAccounts} mapped account${mappedAccounts === 1 ? "" : "s"} are live on the canvas with ${routeCandidates} route candidate${routeCandidates === 1 ? "" : "s"} and ${visitTargets} visit target${visitTargets === 1 ? "" : "s"}.`;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-2 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Opportunity Map"
        subtitle="Geographic overlay of open revenue, visit targets, rentals, and trade signals."
        crumb={{ surface: "GRAPH", lens: "MAP", count: mappedAccounts }}
        metrics={[
          { label: "Mapped", value: mappedAccounts.toLocaleString() },
          { label: "Critical", value: criticalAccounts, tone: criticalAccounts > 0 ? "hot" : undefined },
          { label: "Route", value: routeCandidates, tone: routeCandidates > 0 ? "active" : undefined },
          { label: "Open Revenue", value: formatCurrency(openRevenue), tone: openRevenue > 0 ? "live" : undefined },
          { label: "Rentals", value: activeRentals, tone: activeRentals > 0 ? "ok" : undefined },
        ]}
        ironBriefing={{
          headline: ironHeadline,
          actions: [{ label: "Opportunity command →", href: "/qrm" }],
        }}
        rightRail={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]"
              onClick={() => void boardQuery.refetch()}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 font-mono text-[11px] uppercase tracking-[0.1em]"
              onClick={() => navigate("/qrm")}
            >
              Command Center
            </Button>
          </div>
        }
      />
      <QrmSubNav />

      <MapWithSidebar
        sidebar={
          <div className="divide-y divide-qep-deck-rule/40">
            {isLoading ? (
              <div className="p-3 text-xs text-muted-foreground">Loading opportunity rows and diagnostics…</div>
            ) : hasQueryError ? (
              <div className="space-y-1 p-3 text-xs text-muted-foreground">
                <p className="text-foreground">We could not load opportunity-map data from one or more source queries.</p>
                <p>Use Refresh to retry the equipment, open deal, visit list, and trade signal scans.</p>
              </div>
            ) : isFilteredEmpty ? (
              <div className="space-y-1 p-3 text-xs text-muted-foreground">
                <p className="text-foreground">No rows match current overlays.</p>
                <p>Turn on open revenue, visit targets, rentals, or trade signals to reveal mapped accounts.</p>
              </div>
            ) : isTrueEmpty ? (
              <div className="space-y-1 p-3 text-xs text-muted-foreground">
                <p className="text-foreground">No mapped opportunity rows are ready yet.</p>
                <p>Prerequisites: equipment with coordinates and at least one open deal, visit recommendation, or trade signal.</p>
                <p>Next action: add missing lat/lng metadata and refresh signal sources.</p>
              </div>
            ) : (
              visibleRows.map((row) => (
                <div key={row.id} className="p-2.5">
                  <p className="truncate text-[13px] font-medium text-foreground">{row.label}</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    {row.kind === "rental" ? "Rental" : row.urgency}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {formatCurrency(row.openRevenue)} open · {row.openDealCount} deal{row.openDealCount === 1 ? "" : "s"} · {row.visitTargetCount} visit{row.visitTargetCount === 1 ? "" : "s"}
                  </p>
                  {row.reasons.length > 0 && (
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{row.reasons.slice(0, 2).join(" · ")}</p>
                  )}
                  {row.companyId ? (
                    <div className="mt-1">
                      <Button asChild size="sm" variant="ghost" className="h-6 px-0 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                        <Link to={buildAccountCommandHref(row.companyId)}>
                          Open <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        }
        sidebarHeader={
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {sidebarHeaderText}
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
                  {isLoading
                    ? "Loading opportunity map…"
                    : hasQueryError
                      ? "Opportunity map data could not be loaded"
                      : isFilteredEmpty
                        ? "No mapped rows match current overlays"
                        : "No mapped opportunity signals yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isLoading
                    ? "Scanning equipment, open deals, visit lists, and trade signals now."
                    : hasQueryError
                      ? "Refresh to retry source queries for equipment, open deals, visit lists, and trade signals."
                      : isFilteredEmpty
                        ? "Enable revenue, visit, rental, or trade overlays to show eligible mapped rows."
                        : "Map markers require equipment coordinates plus open deal, visit, or trade signal evidence."}
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
