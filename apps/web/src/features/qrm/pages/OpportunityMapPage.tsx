import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { DeckSurface } from "../components/command-deck";

const DEFAULT_OVERLAYS: MapOverlay[] = [
  { key: "open_revenue", label: "Open revenue", enabled: true },
  { key: "visit_targets", label: "Visit targets", enabled: true },
  { key: "rentals", label: "Active rentals", enabled: true },
  { key: "trades", label: "Trade signals", enabled: true },
];

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
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

  const summary = boardQuery.data?.summary;
  const mapped = summary?.mappedAccounts ?? 0;
  const openRev = summary?.openRevenue ?? 0;
  const visits = summary?.visitTargets ?? 0;
  const trades = summary?.tradeSignals ?? 0;
  const rentals = summary?.activeRentals ?? 0;

  // Iron briefing — route the operator to the sharpest geographic lever.
  const mapIronHeadline = boardQuery.isLoading
    ? "Fusing open revenue, visit targets, rentals, and trade signal coordinates…"
    : boardQuery.isError
      ? "Opportunity map offline — one of the feeders failed. Check the console."
      : mapped === 0
        ? "No mapped accounts yet — equipment needs usable coordinates in metadata before the map lights up."
        : visits > 0
          ? `${visits} visit target${visits === 1 ? "" : "s"} on the map today — route them before the rest of the week compounds. ${fmtMoney(openRev)} open revenue · ${trades} trade signal${trades === 1 ? "" : "s"}.`
          : trades > 0
            ? `${trades} trade signal${trades === 1 ? "" : "s"} across ${mapped} mapped accounts — plan the upgrade touch before a competitor does. ${fmtMoney(openRev)} open revenue on the canvas.`
            : openRev > 0
              ? `${fmtMoney(openRev)} open revenue across ${mapped} mapped account${mapped === 1 ? "" : "s"}. Use the overlays to route today's motion.`
              : `${mapped} mapped account${mapped === 1 ? "" : "s"}, ${rentals} active rental${rentals === 1 ? "" : "s"} on the canvas. No urgent geographic pressure.`;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-2 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Opportunity Map"
        subtitle="Open revenue, visit targets, rentals, and trade signals on one geographic canvas."
        crumb={{ surface: "GRAPH", lens: "MAP", count: mapped }}
        metrics={[
          { label: "Mapped", value: mapped.toLocaleString() },
          { label: "Open rev", value: fmtMoney(openRev), tone: openRev > 0 ? "active" : undefined },
          { label: "Visit targets", value: visits, tone: visits > 0 ? "ok" : undefined },
          { label: "Trade signals", value: trades, tone: trades > 0 ? "live" : undefined },
          { label: "Rentals", value: rentals, tone: "active" },
        ]}
        ironBriefing={{
          headline: mapIronHeadline,
          actions: [{ label: "Seasonal map →", href: "/qrm/seasonal-opportunity-map" }],
        }}
      />
      <QrmSubNav />

      <MapWithSidebar
        sidebarHeader={
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {boardQuery.isLoading ? "Loading…" : `${visibleRows.length} mapped signals`}
          </div>
        }
        sidebar={
          <div className="divide-y divide-qep-deck-rule/40">
            {visibleRows.map((row) => (
              <div key={row.id} className="p-2.5">
                <p className="truncate text-[13px] font-medium text-foreground">{row.label}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {row.kind === "rental"
                    ? "Active rental marker"
                    : `${formatCurrency(row.openRevenue)} open · ${row.visitTargetCount} visit · ${row.tradeSignalCount} trade`}
                </p>
                <div className="mt-1">
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-6 px-0 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80"
                  >
                    <Link to={row.kind === "rental" ? "/qrm/rentals" : buildAccountCommandHref(row.companyId ?? "")}>
                      Open <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
            {!boardQuery.isLoading && visibleRows.length === 0 && (
              <DeckSurface className="m-2 p-3">
                <p className="text-xs text-muted-foreground">No mapped opportunity signals yet.</p>
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
