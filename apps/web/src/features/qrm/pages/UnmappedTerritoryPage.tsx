import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { MapWithSidebar, MapLibreCanvas, type MapMarker, type MapOverlay } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Map as MapIcon, Radar } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildUnmappedTerritoryBoard } from "../lib/unmapped-territory";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

const DEFAULT_OVERLAYS: MapOverlay[] = [
  { key: "no_rep", label: "No assigned rep", enabled: true },
  { key: "silent", label: "No recent signal", enabled: true },
  { key: "no_visit", label: "No visit target", enabled: true },
  { key: "no_pipeline", label: "No open pipeline", enabled: true },
];

export function UnmappedTerritoryPage() {
  const navigate = useNavigate();
  const [overlays, setOverlays] = useState<MapOverlay[]>(DEFAULT_OVERLAYS);
  const today = new Date().toISOString().split("T")[0];

  const boardQuery = useQuery({
    queryKey: ["qrm", "unmapped-territory", today],
    queryFn: async () => {
      const [equipmentResult, companiesResult, dealsResult, activityResult, voiceResult, visitsResult] = await Promise.all([
        supabase
          .from("crm_equipment")
          .select("company_id, metadata, crm_companies(name)")
          .eq("ownership", "customer_owned")
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("crm_companies")
          .select("id, assigned_rep_id")
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("crm_deals")
          .select("company_id")
          .is("deleted_at", null)
          .is("closed_at", null)
          .limit(1000),
        supabase
          .from("crm_activities")
          .select("company_id")
          .gte("occurred_at", new Date(Date.now() - 45 * 86_400_000).toISOString())
          .limit(1000),
        supabase
          .from("voice_captures")
          .select("linked_company_id")
          .gte("created_at", new Date(Date.now() - 45 * 86_400_000).toISOString())
          .limit(1000),
        supabase
          .from("predictive_visit_lists")
          .select("recommendations")
          .eq("list_date", today)
          .limit(50),
      ]);

      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (companiesResult.error) throw new Error(companiesResult.error.message);
      if (dealsResult.error) throw new Error(dealsResult.error.message);
      if (activityResult.error) throw new Error(activityResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (visitsResult.error) throw new Error(visitsResult.error.message);

      const visitSignals = (visitsResult.data ?? []).flatMap((row) => {
        const recs = Array.isArray(row.recommendations) ? row.recommendations : [];
        return recs
          .filter((rec): rec is Record<string, unknown> => rec != null && typeof rec === "object")
          .map((rec) => ({
            companyId: typeof rec.company_id === "string" ? rec.company_id : null,
          }));
      });

      return buildUnmappedTerritoryBoard({
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
        companies: (companiesResult.data ?? []).map((row) => ({
          companyId: row.id,
          assignedRepId: row.assigned_rep_id,
        })),
        deals: (dealsResult.data ?? []).map((row) => ({ companyId: row.company_id })),
        activities: (activityResult.data ?? []).map((row) => ({ companyId: row.company_id })),
        voiceSignals: (voiceResult.data ?? []).map((row) => ({ companyId: row.linked_company_id })),
        visitSignals,
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const visibleRows = useMemo(() => {
    const enabled = new Set(overlays.filter((overlay) => overlay.enabled).map((overlay) => overlay.key));
    return (boardQuery.data?.rows ?? []).filter((row) => (
      (enabled.has("no_rep") && row.missingRep) ||
      (enabled.has("silent") && row.recentActivityCount === 0 && row.recentVoiceCount === 0) ||
      (enabled.has("no_visit") && row.visitTargetCount === 0) ||
      (enabled.has("no_pipeline") && row.openDealCount === 0)
    ));
  }, [boardQuery.data?.rows, overlays]);

  const markers = useMemo<MapMarker[]>(() => visibleRows.map((row) => ({
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    label: row.label,
    tone: row.missingRep ? "orange" : row.recentActivityCount === 0 && row.recentVoiceCount === 0 ? "red" : "blue",
    onClick: () => navigate(buildAccountCommandHref(row.companyId)),
  })), [navigate, visibleRows]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-2 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Unmapped Territory"
        subtitle="A map of provable absence: installed-base accounts where coverage, ownership, or current signal is missing."
      />
      <QrmSubNav />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Mapped Accounts" value={String(boardQuery.data?.summary.mappedAccounts ?? 0)} detail="Accounts with customer-owned equipment and usable coordinates." />
        <SummaryCard label="Absence Accounts" value={String(boardQuery.data?.summary.absenceAccounts ?? 0)} detail="Accounts with at least two provable absence signals." />
        <SummaryCard label="No Rep" value={String(boardQuery.data?.summary.noRepAccounts ?? 0)} detail="Mapped accounts with no assigned rep." />
        <SummaryCard label="Silent" value={String(boardQuery.data?.summary.silentAccounts ?? 0)} detail="No CRM activity and no voice signal in the recent window." />
      </div>

      <MapWithSidebar
        sidebarHeader={
          <div className="text-[10px] text-muted-foreground">
            {boardQuery.isLoading ? "Loading…" : `${visibleRows.length} absence markers`}
          </div>
        }
        sidebar={
          <div className="divide-y divide-border">
            {visibleRows.map((row) => (
              <div key={row.id} className="p-2">
                <p className="text-xs font-medium text-foreground">{row.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {row.absenceScore} absence signals · {row.reasons.join(" · ")}
                </p>
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
                <p className="text-xs text-muted-foreground">No mapped absence signals are active right now.</p>
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
                  {boardQuery.isLoading ? "Loading unmapped territory…" : "No mapped absence signals yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Markers appear only when the repo can prove spatial presence and signal absence at the same time.
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
            <h2 className="text-sm font-semibold text-foreground">Companion map</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Opportunity Map shows where current signal exists. Unmapped Territory shows where coverage is missing.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/qrm/opportunity-map">
              Opportunity map <ArrowUpRight className="ml-1 h-3 w-3" />
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
