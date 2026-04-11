import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ShieldAlert, Swords, Users, Warehouse } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildCompetitiveDisplacementBoard } from "../lib/competitive-displacement";
import { buildCompetitiveThreatMapBoard } from "../lib/competitive-threat-map";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { supabase } from "@/lib/supabase";
import { useBranches } from "@/hooks/useBranches";

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return "text-emerald-400";
    case "medium":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Competitive Threat Map"
        subtitle="Competitive pressure rolled up by account, rep, and branch from live market listings and field mentions."
      />
      <QrmSubNav />

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading competitive threat map…</Card>
      ) : isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          Competitive threat map is unavailable right now.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={ShieldAlert} label="Accounts" value={String(board.summary.threatenedAccounts)} />
            <SummaryCard icon={Users} label="Reps" value={String(board.summary.threatenedReps)} />
            <SummaryCard icon={Warehouse} label="Branches" value={String(board.summary.threatenedBranches)} />
            <SummaryCard icon={Swords} label="Take-Share" value={String(board.summary.takeShareWindows)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ThreatColumn
              title="Account Pressure"
              rows={board.accountRows}
              actionBuilder={(row) => buildAccountCommandHref(row.id)}
              emptyText="No accounts are under measurable competitive pressure."
            />
            <ThreatColumn
              title="Rep Pressure"
              rows={board.repRows}
              actionBuilder={() => "/qrm/deals"}
              emptyText="No rep lanes are under measurable competitive pressure."
            />
            <ThreatColumn
              title="Branch Pressure"
              rows={board.branchRows}
              actionBuilder={(row) => `/qrm/branches/${row.id}/command`}
              emptyText="No branch lanes are under measurable competitive pressure."
            />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Take-share windows</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Competitor inventory sitting long enough to create a realistic displacement opening.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/qrm/competitive-displacement">
                  Competitive center <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {board.marketRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No take-share windows are active right now.</p>
              ) : (
                board.marketRows.slice(0, 8).map((row) => (
                  <div key={`${row.make}:${row.model}`} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                    <p className="text-sm font-medium text-foreground">{row.make} {row.model}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.staleListingCount}/{row.listingCount} stale competitor listing{row.listingCount === 1 ? "" : "s"} · {row.matchingAccounts} matching account{row.matchingAccounts === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCurrency(row.weightedRevenue)} weighted revenue exposed
                      {row.avgAsk != null ? ` · avg ask ${formatCurrency(row.avgAsk)}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function ThreatColumn({
  title,
  rows,
  actionBuilder,
  emptyText,
}: {
  title: string;
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
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          rows.slice(0, 8).map((row) => (
            <div key={row.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{row.label}</p>
                    <span className={`text-[11px] font-medium ${confidenceTone(row.confidence)}`}>
                      {row.confidence} confidence
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.threatenedAccounts} threatened account{row.threatenedAccounts === 1 ? "" : "s"} · {formatCurrency(row.weightedRevenue)} weighted revenue
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{row.trace.join(" · ")}</p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link to={actionBuilder(row)}>
                    Open <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
