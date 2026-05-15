import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MapWithSidebar, MapLibreCanvas, type MapMarker, type MapOverlay } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Map as MapIcon, RotateCcw, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildOpportunityMapBoard, buildOpportunityRoute, parseUccProspectCsv, type UccProspectRow } from "../lib/opportunity-map";
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

const RENTAL_MARKER_RADIUS = 6;
const RENTAL_MARKER_WEIGHT = 1;
const ACCOUNT_MARKER_MIN_RADIUS = 6;
const ACCOUNT_MARKER_MAX_RADIUS = 16;
const ACCOUNT_MARKER_FALLBACK_WEIGHT = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildProspectCompanyCreateHref(row: { label: string; source?: string | null; lender?: string | null }): string {
  const params = new URLSearchParams({
    new: "1",
    name: row.label,
    status: "Prospect",
    source: row.source ?? "ucc_csv",
  });
  if (row.lender) params.set("lender", row.lender);
  return `/qrm/companies?${params.toString()}`;
}

export function OpportunityMapPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [overlays, setOverlays] = useState<MapOverlay[]>(DEFAULT_OVERLAYS);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [minOpenRevenue, setMinOpenRevenue] = useState<number>(0);
  const [signalFilter, setSignalFilter] = useState<"all" | "open_revenue" | "visit_targets" | "trade_signals" | "rentals">("all");
  const [uccProspects, setUccProspects] = useState<UccProspectRow[]>([]);
  const [uccImportError, setUccImportError] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];
  const uccProspectsQueryKey = useMemo(
    () => uccProspects.map((row) => row.id).slice().sort().join(","),
    [uccProspects],
  );

  const boardQuery = useQuery({
    queryKey: ["qrm", "opportunity-map", profile?.id, today, uccProspectsQueryKey],
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
        uccProspects,
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
      if (row.kind === "rental") {
        if (!enabled.has("rentals")) return false;
        if (!(signalFilter === "all" || signalFilter === "rentals")) return false;
        if (minOpenRevenue > 0) return false;
        return true;
      }

      const overlayMatch =
        (enabled.has("open_revenue") && row.openRevenue > 0) ||
        (enabled.has("visit_targets") && row.visitTargetCount > 0) ||
        (enabled.has("trades") && row.tradeSignalCount > 0) ||
        (!enabled.has("open_revenue") && !enabled.has("visit_targets") && !enabled.has("trades"));
      if (!overlayMatch) return false;
      if (row.openRevenue < minOpenRevenue) return false;

      if (signalFilter === "open_revenue") return row.openRevenue > 0;
      if (signalFilter === "visit_targets") return row.visitTargetCount > 0;
      if (signalFilter === "trade_signals") return row.tradeSignalCount > 0;
      return true;
    });
  }, [board?.rows, overlays, minOpenRevenue, signalFilter]);

  const markers: MapMarker[] = useMemo(
    () => visibleRows.map((row) => {
      const tone = row.kind === "rental"
        ? "violet"
        : row.kind === "prospect"
          ? "neutral"
          : row.tradeSignalCount > 0
            ? "orange"
            : row.visitTargetCount > 0
              ? "green"
              : "blue";

      if (row.kind === "rental") {
        return {
          id: row.id,
          lat: row.lat,
          lng: row.lng,
          label: row.label,
          tone,
          radius: RENTAL_MARKER_RADIUS,
          weight: RENTAL_MARKER_WEIGHT,
          onClick: () => setSelectedRowId(row.id),
        };
      }

      const normalizedRevenue = clamp(row.openRevenue / 250_000, 0, 1);
      const normalizedScore = clamp(row.score / 100, 0, 1);
      const intensity = Math.max(normalizedRevenue, normalizedScore);
      const radius = clamp(
        ACCOUNT_MARKER_MIN_RADIUS + intensity * (ACCOUNT_MARKER_MAX_RADIUS - ACCOUNT_MARKER_MIN_RADIUS),
        ACCOUNT_MARKER_MIN_RADIUS,
        ACCOUNT_MARKER_MAX_RADIUS,
      );
      const weight = row.openRevenue > 0 ? row.openRevenue : ACCOUNT_MARKER_FALLBACK_WEIGHT;

      return {
        id: row.id,
        lat: row.lat,
        lng: row.lng,
        label: row.label,
        tone,
        radius,
        weight,
        onClick: () => setSelectedRowId(row.id),
      };
    }),
    [visibleRows],
  );

  const selectedRow = useMemo(
    () => (selectedRowId ? visibleRows.find((row) => row.id === selectedRowId) ?? null : null),
    [selectedRowId, visibleRows],
  );

  const routePlan = useMemo(() => buildOpportunityRoute(visibleRows), [visibleRows]);

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

  async function handleUccCsvUpload(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const prospects = parseUccProspectCsv(await file.text());
      setUccProspects(prospects);
      setUccImportError(prospects.length === 0
        ? "No routeable UCC prospects found. Include latitude/longitude columns."
        : null);
      setSignalFilter("all");
    } catch (error) {
      setUccProspects([]);
      setUccImportError(error instanceof Error ? error.message : "Could not parse CSV.");
    }
  }

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
        mobileSidebarMode="bottom-sheet"
        sidebar={
          <div className="divide-y divide-qep-deck-rule/40">
            <div className="space-y-2 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Min open revenue</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={minOpenRevenue}
                    onChange={(event) => setMinOpenRevenue(Math.max(0, Number(event.target.value) || 0))}
                    className="h-8 w-full rounded-md border border-qep-deck-rule bg-background px-2 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Signal type</span>
                  <select
                    value={signalFilter}
                    onChange={(event) => setSignalFilter(event.target.value as "all" | "open_revenue" | "visit_targets" | "trade_signals" | "rentals")}
                    className="h-8 w-full rounded-md border border-qep-deck-rule bg-background px-2 text-xs"
                  >
                    <option value="all">All signals</option>
                    <option value="open_revenue">Open revenue</option>
                    <option value="visit_targets">Visit targets</option>
                    <option value="trade_signals">Trade signals</option>
                    <option value="rentals">Rentals</option>
                  </select>
                </label>
              </div>
              <div className="rounded-md border border-qep-deck-rule/70 bg-background/70 p-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  Route · {routePlan.stops.length} stop{routePlan.stops.length === 1 ? "" : "s"} · {routePlan.estimatedMiles.toFixed(1)} mi
                </p>
                {routePlan.googleMapsUrl ? (
                  <Button asChild size="sm" variant="ghost" className="mt-1 h-6 px-0 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                    <a href={routePlan.googleMapsUrl} target="_blank" rel="noreferrer">
                      Open route in Google Maps <ArrowUpRight className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                ) : (
                  <p className="mt-1 text-[10.5px] text-muted-foreground">No visible route candidates yet.</p>
                )}
              </div>
              <div className="rounded-md border border-qep-deck-rule/70 bg-background/70 p-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      UCC prospect import
                    </p>
                    <p className="mt-1 text-[10.5px] text-muted-foreground">
                      CSV needs company/name plus lat/lng. Pins stay local until saved to CRM.
                    </p>
                  </div>
                  <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-qep-deck-rule px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-qep-orange hover:bg-qep-orange/10">
                    <Upload className="h-3 w-3" />
                    Upload
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="sr-only"
                      onChange={(event) => void handleUccCsvUpload(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                {uccProspects.length > 0 ? (
                  <p className="mt-2 text-[10.5px] text-emerald-300">
                    {uccProspects.length} UCC prospect{uccProspects.length === 1 ? "" : "s"} loaded into the map.
                  </p>
                ) : null}
                {uccImportError ? (
                  <p className="mt-2 text-[10.5px] text-amber-300">{uccImportError}</p>
                ) : null}
              </div>
            </div>
            {isLoading ? (
              <div className="p-3 text-xs text-muted-foreground">Loading opportunity rows and diagnostics…</div>
            ) : hasQueryError ? (
              <div className="space-y-1 p-3 text-xs text-muted-foreground">
                <p className="text-foreground">We could not load opportunity-map data from one or more source queries.</p>
                <p>Use Refresh to retry the equipment, open deal, visit list, and trade signal scans.</p>
              </div>
            ) : isFilteredEmpty ? (
              <div className="space-y-1 p-3 text-xs text-muted-foreground">
                <p className="text-foreground">No rows match current filters and overlays.</p>
                <p>Adjust min revenue, signal type, or overlay toggles to reveal mapped accounts.</p>
              </div>
            ) : isTrueEmpty ? (
              <div className="space-y-1 p-3 text-xs text-muted-foreground">
                <p className="text-foreground">No mapped opportunity rows are ready yet.</p>
                <p>Prerequisites: equipment with coordinates and at least one open deal, visit recommendation, or trade signal.</p>
                <p>Next action: add missing lat/lng metadata and refresh signal sources.</p>
              </div>
            ) : (
              visibleRows.map((row) => (
                <div
                  key={row.id}
                  className={`p-2.5 ${selectedRowId === row.id ? "bg-qep-orange/10" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedRowId(row.id)}
                    className="block w-full text-left"
                  >
                    <p className="truncate text-[13px] font-medium text-foreground">{row.label}</p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {row.kind === "rental" ? "Rental" : row.kind === "prospect" ? "UCC prospect" : row.urgency}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {row.kind === "prospect"
                        ? "Imported prospect · route candidate"
                        : `${formatCurrency(row.openRevenue)} open · ${row.openDealCount} deal${row.openDealCount === 1 ? "" : "s"} · ${row.visitTargetCount} visit${row.visitTargetCount === 1 ? "" : "s"}`}
                    </p>
                    {row.reasons.length > 0 && (
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">{row.reasons.slice(0, 2).join(" · ")}</p>
                    )}
                  </button>
                  {row.companyId ? (
                    <div className="mt-1">
                      <Button asChild size="sm" variant="ghost" className="h-6 px-0 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                        <Link to={buildAccountCommandHref(row.companyId)}>
                          Open <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  ) : row.kind === "prospect" ? (
                    <div className="mt-1">
                      <Button asChild size="sm" variant="ghost" className="h-6 px-0 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                        <Link to={buildProspectCompanyCreateHref(row)}>
                          Create customer <ArrowUpRight className="ml-1 h-3 w-3" />
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
            <div className="relative h-full w-full">
              <MapLibreCanvas markers={markers} cluster />
              {selectedRow ? (
                <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-sm">
                  <div className="pointer-events-auto rounded-md border border-qep-deck-rule bg-background/95 p-3 shadow-md backdrop-blur-sm">
                    <p className="truncate text-sm font-semibold text-foreground">{selectedRow.label}</p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {selectedRow.kind === "rental" ? "Rental" : selectedRow.kind === "prospect" ? "UCC prospect" : selectedRow.urgency}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedRow.kind === "prospect"
                        ? "Imported UCC prospect · route candidate"
                        : `${formatCurrency(selectedRow.openRevenue)} open · ${selectedRow.openDealCount} deal${selectedRow.openDealCount === 1 ? "" : "s"} · ${selectedRow.visitTargetCount} visit target${selectedRow.visitTargetCount === 1 ? "" : "s"} · ${selectedRow.tradeSignalCount} trade signal${selectedRow.tradeSignalCount === 1 ? "" : "s"}`}
                    </p>
                    {selectedRow.reasons.length > 0 ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">{selectedRow.reasons.slice(0, 3).join(" · ")}</p>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      {selectedRow.companyId ? (
                        <Button asChild size="sm" variant="outline" className="h-7 px-2 font-mono text-[10px] uppercase tracking-[0.08em]">
                          <Link to={buildAccountCommandHref(selectedRow.companyId)}>
                            Open account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      ) : selectedRow.kind === "prospect" ? (
                        <Button asChild size="sm" variant="outline" className="h-7 px-2 font-mono text-[10px] uppercase tracking-[0.08em]">
                          <Link to={buildProspectCompanyCreateHref(selectedRow)}>
                            Create customer <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 font-mono text-[10px] uppercase tracking-[0.08em]"
                        onClick={() => setSelectedRowId(null)}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
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
                        ? "No mapped rows match current filters/overlays"
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
