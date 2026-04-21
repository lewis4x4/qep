import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { listCrmWeightedOpenDeals } from "../lib/qrm-deals-api";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildCompetitiveDisplacementBoard } from "../lib/competitive-displacement";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, StatusDot, type StatusTone } from "../components/command-deck";
import { supabase } from "@/lib/supabase";

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

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
  const summary = board.summary;
  const exposure = board.defenseRows.reduce((sum, row) => sum + row.weightedRevenue, 0);

  // Cascading Iron briefing — route to the sharpest compete lever.
  const competeIronHeadline = isLoading
    ? "Fusing competitor listings, voice mentions, and open deal pressure…"
    : isError
      ? "Competitive displacement offline — one of the feeders failed. Check the console."
      : summary.threatenedAccounts > 0
        ? `${summary.threatenedAccounts} account${summary.threatenedAccounts === 1 ? "" : "s"} under pressure with ${fmtMoney(exposure)} weighted exposure — defend before listings harden. ${summary.takeShareWindows} take-share window${summary.takeShareWindows === 1 ? "" : "s"}.`
        : summary.takeShareWindows > 0
          ? `${summary.takeShareWindows} take-share window${summary.takeShareWindows === 1 ? "" : "s"} open — stale competitor iron ready to flip. ${summary.staleListings} stale listing${summary.staleListings === 1 ? "" : "s"} on the board.`
          : summary.activeListings > 0
            ? `${summary.activeListings} active listing${summary.activeListings === 1 ? "" : "s"} tracked, no pressure yet. Keep the watch — signals turn fast.`
            : "No competitive pressure surfaced. Quiet market — press white-space instead.";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Competitive Displacement"
        subtitle="Where competitor pressure is rising and where stale competitor inventory creates a take-share opening."
        crumb={{ surface: "PULSE", lens: "COMPETE", count: summary.threatenedAccounts }}
        metrics={[
          { label: "Threatened", value: summary.threatenedAccounts, tone: summary.threatenedAccounts > 0 ? "hot" : undefined },
          { label: "Take-share", value: summary.takeShareWindows, tone: summary.takeShareWindows > 0 ? "active" : undefined },
          { label: "Listings", value: summary.activeListings, tone: summary.activeListings > 0 ? "live" : undefined },
          { label: "Exposure", value: fmtMoney(exposure), tone: exposure > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: competeIronHeadline,
          actions: [{ label: "Threat map →", href: "/qrm/competitive-threat-map" }],
        }}
      />
      <QrmSubNav />

      {isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading competitive displacement…</DeckSurface>
      ) : isError ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          Competitive displacement is unavailable right now.
        </DeckSurface>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          <DeckSurface className="p-3 sm:p-4">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Accounts to defend</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Accounts showing competitor mentions and matching inventory pressure — immediate rep action.
            </p>
            <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
              {board.defenseRows.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No active competitor pressure detected.</p>
              ) : (
                board.defenseRows.slice(0, 10).map((row) => {
                  const tone: StatusTone = row.weightedRevenue > 0 ? "hot" : "warm";
                  return (
                    <Link
                      key={row.companyId}
                      to={buildAccountCommandHref(row.companyId)}
                      className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-qep-orange/[0.04]"
                    >
                      <StatusDot tone={tone} pulse={tone === "hot"} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{row.companyName}</p>
                        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {formatCurrency(row.weightedRevenue)} · {row.competitorMentionCount} mention{row.competitorMentionCount === 1 ? "" : "s"} · {row.matchingListings} listing{row.matchingListings === 1 ? "" : "s"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{row.reasons.join(" · ")}</p>
                      </div>
                      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-qep-orange" />
                    </Link>
                  );
                })
              )}
            </div>
          </DeckSurface>

          <DeckSurface className="p-3 sm:p-4">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Take-share windows</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Competitor inventory sitting long enough to create a displacement opening.
            </p>
            <div className="mt-3 divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/30">
              {board.takeShareRows.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No clear take-share windows right now.</p>
              ) : (
                board.takeShareRows.slice(0, 10).map((row) => {
                  const tone: StatusTone = row.staleListingCount > 0 && row.matchingAccounts > 0 ? "active" : "cool";
                  return (
                    <div key={`${row.make}:${row.model}`} className="flex items-start gap-3 px-3 py-2.5">
                      <StatusDot tone={tone} pulse={false} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{row.make} {row.model}</p>
                        <p className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {row.staleListingCount}/{row.listingCount} stale · {row.matchingAccounts} match · {formatCurrency(row.weightedRevenue)} weighted
                          {row.avgAsk != null ? ` · ask ${fmtMoney(row.avgAsk)}` : ""}
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
