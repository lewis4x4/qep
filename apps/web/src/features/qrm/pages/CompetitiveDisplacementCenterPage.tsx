import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Swords, TrendingUp, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildCompetitiveDisplacementBoard } from "../lib/competitive-displacement";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { supabase } from "@/lib/supabase";

export function CompetitiveDisplacementCenterPage() {
  const dealsQuery = useQuery({
    queryKey: ["competitive-displacement", "deals"],
    queryFn: () => listCrmWeightedOpenDeals(),
    staleTime: 60_000,
  });

  const boardQuery = useQuery({
    queryKey: ["competitive-displacement", "signals"],
    queryFn: async () => {
      const [listingsResult, equipmentResult, voiceResult] = await Promise.all([
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
      ]);

      if (listingsResult.error) throw new Error(listingsResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (voiceResult.error) throw new Error(voiceResult.error.message);

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
      };
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = useMemo(() => buildCompetitiveDisplacementBoard({
    listings: boardQuery.data?.listings ?? [],
    equipment: boardQuery.data?.equipment ?? [],
    voiceSignals: boardQuery.data?.voiceSignals ?? [],
    deals: dealsQuery.data ?? [],
  }), [boardQuery.data, dealsQuery.data]);

  const isLoading = dealsQuery.isLoading || boardQuery.isLoading;
  const isError = dealsQuery.isError || boardQuery.isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Competitive Displacement Center"
        subtitle="Where competitor pressure is rising and where stale competitor inventory creates a take-share opening."
      />
      <QrmSubNav />

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading competitive displacement…</Card>
      ) : isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          Competitive displacement is unavailable right now.
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard icon={ShieldAlert} label="Threatened Accounts" value={String(board.summary.threatenedAccounts)} detail="Accounts with competitor voice pressure or matching market listings." />
            <SummaryCard icon={Swords} label="Take-Share Windows" value={String(board.summary.takeShareWindows)} detail="Make/model markets where competitor inventory is sitting." />
            <SummaryCard icon={TrendingUp} label="Active Listings" value={String(board.summary.activeListings)} detail={`${board.summary.staleListings} stale listings ripe for displacement`} />
            <SummaryCard icon={TrendingUp} label="Weighted Exposure" value={formatCurrency(board.defenseRows.reduce((sum, row) => sum + row.weightedRevenue, 0))} detail="Open weighted revenue on threatened accounts." />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Accounts to defend</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Accounts showing competitor mentions and matching inventory pressure that need immediate rep action.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {board.defenseRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active competitor pressure detected.</p>
                ) : (
                  board.defenseRows.slice(0, 10).map((row) => (
                    <div key={row.companyId} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{row.companyName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatCurrency(row.weightedRevenue)} weighted revenue · {row.competitorMentionCount} mention{row.competitorMentionCount === 1 ? "" : "s"} · {row.matchingListings} matching listing{row.matchingListings === 1 ? "" : "s"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{row.reasons.join(" · ")}</p>
                        </div>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={buildAccountCommandHref(row.companyId)}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Take-share windows</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Competitor inventory that has been sitting long enough to create a displacement opening.
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {board.takeShareRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No clear take-share windows right now.</p>
                ) : (
                  board.takeShareRows.slice(0, 10).map((row) => (
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
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open Competitive Threat Map to see the same pressure rolled up by account, rep, and branch.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/qrm/competitive-threat-map">
                  Threat map <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
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
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
