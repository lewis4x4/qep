import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildCompetitiveDisplacementBoard } from "../lib/competitive-displacement";
import { buildCompetitiveThreatMapBoard } from "../lib/competitive-threat-map";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, SignalChip, StatusDot, type StatusTone } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import { useBranches } from "@/hooks/useBranches";

function confidenceTone(confidence: "high" | "medium" | "low"): StatusTone {
  switch (confidence) {
    case "high":
      return "ok";
    case "medium":
      return "active";
    default:
      return "cool";
  }
}

export function CompetitiveThreatMapPage() {
  const branchesQuery = useBranches();
  const dealsQuery = useQuery({
    queryKey: ["competitive-threat-map", "deals"],
    queryFn: () => listCrmWeightedOpenDeals(),
    staleTime: 60_000,
  });

  const boardQuery = useQuery({
    queryKey: ["competitive-threat-map", "signals"],
    queryFn: async () => {
      const [listingsResult, equipmentResult, voiceResult, serviceResult, profilesResult] = await Promise.all([
        supabase
          .from("competitor_listings")
          .select("id, make, model, asking_price, first_seen_at, last_seen_at, source, location")
          .eq("is_active", true)
          .limit(1000),
        supabase
          .from("crm_equipment")
          .select("company_id, make, model, crm_companies(name)")
          .eq("ownership", "customer_owned")
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("voice_captures")
          .select("linked_company_id, competitor_mentions")
          .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
          .limit(1000),
        supabase
          .from("service_jobs")
          .select("customer_id, branch_id, current_stage")
          .is("deleted_at", null)
          .limit(1000),
        supabase
          .from("profiles")
          .select("id, full_name")
          .limit(500),
      ]);

      if (listingsResult.error) throw new Error(listingsResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (serviceResult.error) throw new Error(serviceResult.error.message);
      if (profilesResult.error) throw new Error(profilesResult.error.message);

      return {
        listings: (listingsResult.data ?? []).map((row) => ({
          id: row.id,
          make: row.make,
          model: row.model,
          askingPrice: row.asking_price,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          source: row.source,
          location: row.location,
        })),
        equipment: (equipmentResult.data ?? []).map((row) => {
          const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
          return {
            companyId: row.company_id,
            companyName: companyJoin?.name ?? null,
            make: row.make,
            model: row.model,
          };
        }),
        voiceSignals: (voiceResult.data ?? []).map((row) => ({
          companyId: row.linked_company_id,
          mentions: Array.isArray(row.competitor_mentions) ? row.competitor_mentions.filter((entry): entry is string => typeof entry === "string") : [],
        })),
        serviceLinks: (serviceResult.data ?? [])
          .filter((row) => row.current_stage !== "paid_closed")
          .map((row) => ({
            branchId: row.branch_id,
            companyId: row.customer_id,
          })),
        repNameById: new Map((profilesResult.data ?? []).map((row) => [row.id, row.full_name ?? "Rep"])),
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = useMemo(() => {
    const displacement = buildCompetitiveDisplacementBoard({
      listings: boardQuery.data?.listings ?? [],
      equipment: boardQuery.data?.equipment ?? [],
      voiceSignals: boardQuery.data?.voiceSignals ?? [],
      deals: dealsQuery.data ?? [],
    });

    return buildCompetitiveThreatMapBoard({
      defenseRows: displacement.defenseRows,
      takeShareRows: displacement.takeShareRows,
      deals: dealsQuery.data ?? [],
      repNameById: boardQuery.data?.repNameById ?? new Map(),
      branchNameById: new Map((branchesQuery.data ?? []).map((branch) => [branch.slug, branch.display_name])),
      serviceLinks: boardQuery.data?.serviceLinks ?? [],
    });
  }, [boardQuery.data, dealsQuery.data, branchesQuery.data]);

  const isLoading = dealsQuery.isLoading || boardQuery.isLoading || branchesQuery.isLoading;
  const isError = dealsQuery.isError || boardQuery.isError || branchesQuery.isError;
  const summary = board.summary;

  // Cascading Iron briefing — route to the sharpest threat lever.
  const threatIronHeadline = isLoading
    ? "Fusing competitor listings, voice mentions, service footprint, and deal pressure…"
    : isError
      ? "Threat map offline — one of the feeders failed. Check the console."
      : summary.takeShareWindows > 0 && summary.threatenedAccounts > 0
        ? `${summary.threatenedAccounts} account${summary.threatenedAccounts === 1 ? "" : "s"} under pressure · ${summary.takeShareWindows} take-share window${summary.takeShareWindows === 1 ? "" : "s"} open. Defend and strike.`
        : summary.threatenedAccounts > 0
          ? `${summary.threatenedAccounts} account${summary.threatenedAccounts === 1 ? "" : "s"} under pressure across ${summary.threatenedReps} rep${summary.threatenedReps === 1 ? "" : "s"} and ${summary.threatenedBranches} branch${summary.threatenedBranches === 1 ? "" : "es"}.`
          : summary.takeShareWindows > 0
            ? `${summary.takeShareWindows} take-share window${summary.takeShareWindows === 1 ? "" : "s"} on stale competitor iron — ready to flip.`
            : "Threat board quiet — press white-space instead.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Competitive Threat Map"
        subtitle="Competitive pressure rolled up by account, rep, and branch from live market listings and field mentions."
        crumb={{ surface: "PULSE", lens: "THREAT", count: summary.threatenedAccounts }}
        metrics={[
          { label: "Accounts", value: summary.threatenedAccounts, tone: summary.threatenedAccounts > 0 ? "hot" : undefined },
          { label: "Reps", value: summary.threatenedReps, tone: summary.threatenedReps > 0 ? "warm" : undefined },
          { label: "Branches", value: summary.threatenedBranches, tone: summary.threatenedBranches > 0 ? "warm" : undefined },
          { label: "Take-share", value: summary.takeShareWindows, tone: summary.takeShareWindows > 0 ? "active" : undefined },
        ]}
        ironBriefing={{
          headline: threatIronHeadline,
          actions: [{ label: "Competitive center →", href: "/qrm/competitive-displacement" }],
        }}
      />
      <QrmSubNav />

      {isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading competitive threat map…</DeckSurface>
      ) : isError ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          Competitive threat map is unavailable right now.
        </DeckSurface>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 xl:grid-cols-3">
            <ThreatColumn
              title="Account pressure"
              tone="hot"
              rows={board.accountRows}
              actionBuilder={(row) => buildAccountCommandHref(row.id)}
              emptyText="No accounts are under measurable competitive pressure."
            />
            <ThreatColumn
              title="Rep pressure"
              tone="warm"
              rows={board.repRows}
              actionBuilder={() => "/qrm/deals"}
              emptyText="No rep lanes are under measurable competitive pressure."
            />
            <ThreatColumn
              title="Branch pressure"
              tone="warm"
              rows={board.branchRows}
              actionBuilder={(row) => `/qrm/branches/${row.id}/command`}
              emptyText="No branch lanes are under measurable competitive pressure."
            />
          </div>

          <DeckSurface className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <StatusDot tone="active" pulse={false} />
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Take-share windows</h2>
              </div>
              <Button asChild size="sm" variant="outline" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em]">
                <Link to="/qrm/competitive-displacement">
                  Compete <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
              {board.marketRows.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No take-share windows are active right now.</p>
              ) : (
                board.marketRows.slice(0, 8).map((row) => {
                  const tone: StatusTone = row.staleListingCount > 0 && row.matchingAccounts > 0 ? "active" : "cool";
                  return (
                    <div key={`${row.make}:${row.model}`} className="flex items-start gap-3 px-3 py-2.5">
                      <StatusDot tone={tone} pulse={false} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{row.make} {row.model}</p>
                        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {row.staleListingCount}/{row.listingCount} stale · {row.matchingAccounts} match · {formatCurrency(row.weightedRevenue)} weighted
                          {row.avgAsk != null ? ` · avg ask ${formatCurrency(row.avgAsk)}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </DeckSurface>
        </div>
      )}
    </div>
  );
}

function ThreatColumn({
  title,
  tone,
  rows,
  actionBuilder,
  emptyText,
}: {
  title: string;
  tone: StatusTone;
  rows: Array<{
    id: string;
    label: string;
    threatenedAccounts: number;
    weightedRevenue: number;
    confidence: "high" | "medium" | "low";
    trace: string[];
  }>;
  actionBuilder: (row: { id: string }) => string;
  emptyText: string;
}) {
  return (
    <DeckSurface className="p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} pulse={tone === "hot"} />
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">{title}</h2>
      </div>
      <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.slice(0, 8).map((row) => {
            const rowTone = confidenceTone(row.confidence);
            return (
              <div key={row.id} className="flex items-start gap-3 px-3 py-2.5">
                <StatusDot tone={rowTone} pulse={false} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[13px] font-medium text-foreground">{row.label}</p>
                    <SignalChip label={row.confidence} tone={rowTone} />
                  </div>
                  <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {row.threatenedAccounts} threat · {formatCurrency(row.weightedRevenue)} weighted
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{row.trace.join(" · ")}</p>
                </div>
                <Button asChild size="sm" variant="ghost" className="h-7 px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-qep-orange hover:text-qep-orange/80">
                  <Link to={actionBuilder(row)}>
                    Open <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            );
          })
        )}
      </div>
    </DeckSurface>
  );
}
