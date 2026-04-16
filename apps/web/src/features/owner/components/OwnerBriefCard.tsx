/**
 * OwnerBriefCard — Claude-generated 3–5 sentence narrative for the morning.
 *
 * Slice B placeholder: renders the component scaffold + refresh button, but
 * the actual narrative is deferred to Slice C where the edge function lands.
 * Shows the last 24h event count + most-recent predictive play as a tease.
 */
import { useQuery } from "@tanstack/react-query";
import { RefreshCcw, Sparkles, Clock } from "lucide-react";
import { useState } from "react";
import {
  fetchOwnerEventFeed,
  fetchOwnerMorningBrief,
  type OwnerEventFeed,
  type OwnerMorningBrief,
} from "../lib/owner-api";

export function OwnerBriefCard() {
  const [refreshing, setRefreshing] = useState(false);

  const events = useQuery<OwnerEventFeed>({
    queryKey: ["owner", "event-feed", 24],
    queryFn: () => fetchOwnerEventFeed(24),
    refetchInterval: 300_000,
  });

  const brief = useQuery<OwnerMorningBrief>({
    queryKey: ["owner", "morning-brief"],
    queryFn: () => fetchOwnerMorningBrief(),
    // Edge function lands in Slice C; if it 404s we fall back to a local synthesis.
    retry: 0,
    staleTime: 60 * 60_000, // 60 min cache
  });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetchOwnerMorningBrief({ refresh: true });
      await brief.refetch();
    } catch {
      // ignore — function may not be deployed yet
    } finally {
      setRefreshing(false);
    }
  }

  const narrative = brief.data?.brief ?? synthLocalBrief(events.data);

  return (
    <div className="relative flex h-full min-h-[260px] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.88))] p-6 backdrop-blur">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-qep-orange/90">
            Owner Brief
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            What you should know right now
          </h2>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200 transition hover:border-qep-orange/40 hover:bg-qep-orange/10 hover:text-qep-orange disabled:opacity-50"
        >
          <RefreshCcw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Thinking" : "Refresh"}
        </button>
      </div>

      <div className="mt-4 flex-1 text-[15px] leading-relaxed text-slate-200">
        <Sparkles className="mr-1 inline h-4 w-4 text-qep-orange" />
        {narrative}
      </div>

      <div className="mt-4 flex items-center gap-4 text-[11px] uppercase tracking-[0.18em] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {events.data ? `${events.data.count} events · last 24h` : "…"}
        </span>
        {brief.data?.model && <span>· {brief.data.model}</span>}
        {!brief.data?.brief && <span className="text-amber-400/80">· local synthesis</span>}
      </div>
    </div>
  );
}

function synthLocalBrief(feed: OwnerEventFeed | undefined): string {
  if (!feed) return "Loading the last 24 hours of business events…";
  if (feed.count === 0) {
    return "Quiet overnight — no new parts orders, predictive plays, CDK imports, or deal closures in the last 24 hours. The AI Owner Brief (Claude Sonnet 4.6) will synthesize this into a sharper narrative once the edge function ships.";
  }
  const plays = feed.events.filter((e) => e.type === "predictive_play_created").length;
  const orders = feed.events.filter((e) => e.type === "parts_order_created").length;
  const imports = feed.events.filter((e) => e.type === "cdk_import_committed").length;
  const deals = feed.events.filter((e) => e.type === "deal_closed_won").length;
  const parts: string[] = [];
  if (orders) parts.push(`${orders} new parts order${orders > 1 ? "s" : ""}`);
  if (plays) parts.push(`${plays} predictive play${plays > 1 ? "s" : ""} written overnight`);
  if (imports) parts.push(`${imports} CDK import${imports > 1 ? "s" : ""} committed`);
  if (deals) parts.push(`${deals} deal${deals > 1 ? "s" : ""} closed won`);
  return `Last 24 hours: ${parts.join(" · ")}. The AI Owner Brief (Claude Sonnet 4.6) will take over this narrative once the edge function ships — it will rank these by impact and tell you the one thing you should do before lunch.`;
}
