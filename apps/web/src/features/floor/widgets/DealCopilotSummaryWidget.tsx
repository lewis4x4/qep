/**
 * DealCopilotSummaryWidget — live feed of the Deal Copilot's recent work.
 *
 * The Copilot (Slice 21) produces an ongoing stream of turns on the
 * reps' quotes: extracted signals, deterministic patches, new scores.
 * Each turn is a mechanical event that moved a deal's probability. This
 * widget surfaces the 5 most recent turns authored by the signed-in
 * user across all their quotes, with the score delta, the extracted
 * signal summary, and a click-through that deep-links to the quote
 * with the DealCopilotPanel drawer pre-open on that turn.
 *
 * Moonshot:
 *   • Headline KPI at the top: "{N} deals moved this week" — a single
 *     number that says whether the Copilot is earning its keep for
 *     this rep. Only counts turns with a non-zero score delta.
 *   • Signal chips per row show what was extracted: objection,
 *     financing pref, timeline pressure, competitor mention, warmth
 *     re-rate — each with its own color.
 *   • Score delta pill is color-graded — green for up, rose for down,
 *     muted for zero.
 *   • Click a row → /quote-v2/{quotePackageId}?copilotTurn={turnId}
 *     which triggers the DealCopilotPanel auto-open + scroll-to
 *     behavior already wired in Slice 21.
 *   • Empty state stays brand-true: "Your Copilot is quiet — drop a
 *     voice note on any quote and it'll start moving scores."
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  Clock,
  Loader2,
  MessageSquareText,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

interface TurnRow {
  id: string;
  quotePackageId: string;
  customerLabel: string;
  turnIndex: number;
  rawInput: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
  extractedSignals: Record<string, unknown> | null;
  copilotReply: string | null;
  createdAt: string;
  inputSource: string;
}

const RESULT_LIMIT = 5;

async function fetchRecentTurns(userId: string): Promise<TurnRow[]> {
  const { data, error } = await supabase
    .from("qb_quote_copilot_turns")
    .select(
      `
      id, quote_package_id, turn_index, raw_input, score_before, score_after,
      extracted_signals, copilot_reply, created_at, input_source,
      quote:quote_packages ( id, deal_id, customer_name, customer_company, quote_number )
    `,
    )
    .eq("author_user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(RESULT_LIMIT);

  if (error) throw new Error(error.message);

  type Raw = {
    id: string;
    quote_package_id: string;
    turn_index: number;
    raw_input: string;
    score_before: number | null;
    score_after: number | null;
    extracted_signals: Record<string, unknown> | null;
    copilot_reply: string | null;
    created_at: string;
    input_source: string;
    quote:
      | {
          id?: string | null;
          customer_name?: string | null;
          customer_company?: string | null;
          quote_number?: string | null;
        }
      | Array<{
          customer_name?: string | null;
          customer_company?: string | null;
          quote_number?: string | null;
        }>
      | null;
  };

  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const quote = Array.isArray(r.quote) ? r.quote[0] : r.quote;
    const customerLabel =
      quote?.customer_company ||
      quote?.customer_name ||
      quote?.quote_number ||
      "Quote";
    return {
      id: r.id,
      quotePackageId: r.quote_package_id,
      customerLabel,
      turnIndex: r.turn_index,
      rawInput: r.raw_input,
      scoreBefore: r.score_before,
      scoreAfter: r.score_after,
      extractedSignals: r.extracted_signals,
      copilotReply: r.copilot_reply,
      createdAt: r.created_at,
      inputSource: r.input_source,
    };
  });
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMin = Math.floor((Date.now() - t) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function extractChips(signals: TurnRow["extractedSignals"]): Array<{
  key: string;
  label: string;
  tone: "objection" | "financing" | "timeline" | "competitor" | "warmth";
}> {
  if (!signals || typeof signals !== "object") return [];
  const chips: Array<{
    key: string;
    label: string;
    tone: "objection" | "financing" | "timeline" | "competitor" | "warmth";
  }> = [];
  const s = signals as Record<string, unknown>;
  const cs = s.customerSignals as Record<string, unknown> | undefined;
  if (cs && typeof cs === "object") {
    const objections = cs.objections;
    if (Array.isArray(objections) && objections.length > 0) {
      chips.push({
        key: "objections",
        label: `${objections.length} objection${objections.length === 1 ? "" : "s"}`,
        tone: "objection",
      });
    }
    const timeline = cs.timelinePressure;
    if (typeof timeline === "string" && timeline.length > 0) {
      chips.push({
        key: "timeline",
        label: `Timeline: ${timeline}`,
        tone: "timeline",
      });
    }
    const competitors = cs.competitorMentions;
    if (Array.isArray(competitors) && competitors.length > 0) {
      chips.push({
        key: "competitors",
        label: `vs ${(competitors[0] as string) ?? "competitor"}`,
        tone: "competitor",
      });
    }
  }
  if (typeof s.financingPref === "string") {
    chips.push({ key: "financingPref", label: `Financing: ${s.financingPref}`, tone: "financing" });
  }
  if (typeof s.customerWarmth === "string") {
    chips.push({ key: "warmth", label: `Warmth: ${s.customerWarmth}`, tone: "warmth" });
  }
  return chips;
}

const CHIP_CLASSES: Record<string, string> = {
  objection: "border-rose-500/30 bg-rose-500/5 text-rose-300",
  financing: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  timeline: "border-sky-500/30 bg-sky-500/5 text-sky-300",
  competitor: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  warmth: "border-border/60 bg-background/60 text-muted-foreground",
};

export function DealCopilotSummaryWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["floor", "copilot-summary", userId],
    queryFn: () => fetchRecentTurns(userId),
    enabled: !!userId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // KPI: how many distinct deals moved this week (non-zero delta in
  // the last 7 days). Captured from the same data set we're rendering
  // so no extra query — the widget is its own KPI source.
  const weeklyDealsMoved = useMemo(() => {
    const rows = data ?? [];
    const weekAgo = Date.now() - 7 * 86_400_000;
    const seen = new Set<string>();
    for (const r of rows) {
      if (new Date(r.createdAt).getTime() < weekAgo) continue;
      if (r.scoreBefore == null || r.scoreAfter == null) continue;
      if (r.scoreBefore === r.scoreAfter) continue;
      seen.add(r.quotePackageId);
    }
    return seen.size;
  }, [data]);

  return (
    <div
      role="figure"
      aria-label="Deal Copilot — recent signals"
      className="floor-widget-in relative flex h-full min-h-[240px] flex-col overflow-hidden rounded-xl border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-all duration-150 ease-out hover:border-[hsl(var(--qep-orange))]/40"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px] bg-[hsl(var(--qep-orange))]/60"
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--qep-gray))]" aria-hidden="true" />
          <h3 className="font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-gray))]">
            Deal Copilot signals
          </h3>
        </div>
        <Link
          to="/sales/today"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-[hsl(var(--qep-orange))]"
        >
          All
        </Link>
      </div>

      {/* KPI line */}
      {!isLoading && !isError && (data?.length ?? 0) > 0 && (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-kpi text-3xl font-extrabold tabular-nums text-foreground">
            {weeklyDealsMoved}
          </span>
          <span className="text-[11px] text-muted-foreground">
            deal{weeklyDealsMoved === 1 ? "" : "s"} moved this week
          </span>
        </div>
      )}

      {/* Body */}
      <div className="mt-3 flex-1">
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}
        {isError && (
          <p className="text-xs text-rose-300">Couldn&apos;t load Copilot feed right now.</p>
        )}
        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <MessageSquareText className="h-6 w-6 text-muted-foreground/70" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">
              Your Copilot is quiet
            </p>
            <p className="max-w-[18rem] text-[11px] text-muted-foreground">
              Drop a voice note on any open quote and the Copilot will start moving scores and
              signals in here.
            </p>
          </div>
        )}
        {!isLoading && !isError && (data?.length ?? 0) > 0 && (
          <ul className="space-y-1.5">
            {data!.map((row) => (
              <TurnRowCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TurnRowCard({ row }: { row: TurnRow }) {
  const delta =
    row.scoreBefore != null && row.scoreAfter != null ? row.scoreAfter - row.scoreBefore : null;
  const chips = extractChips(row.extractedSignals);
  const DeltaIcon = delta == null ? Activity : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Clock;

  return (
    <li>
      <Link
        to={`/quote-v2/${row.quotePackageId}?copilotTurn=${row.id}`}
        className="group block rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-[hsl(var(--qep-deck-rule))] hover:bg-[hsl(var(--qep-deck))]"
      >
        <div className="flex items-start gap-2">
          {/* Score delta pill */}
          <span
            aria-label={delta == null ? "No score change" : `Score change ${delta}`}
            className={
              "flex h-10 w-14 shrink-0 flex-col items-center justify-center rounded-md border font-kpi text-xs font-extrabold tabular-nums " +
              (delta == null
                ? "border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] text-muted-foreground"
                : delta > 0
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : delta < 0
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                    : "border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] text-muted-foreground")
            }
          >
            <DeltaIcon className="h-3 w-3" aria-hidden="true" />
            <span>
              {delta == null
                ? "—"
                : delta > 0
                  ? `+${delta}`
                  : `${delta}`}
            </span>
          </span>

          {/* Middle column */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-foreground group-hover:text-[hsl(var(--qep-orange))]">
                {row.customerLabel}
              </p>
              <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {formatRelative(row.createdAt)}
              </span>
            </div>
            {row.copilotReply ? (
              <p className="mt-0.5 line-clamp-1 text-[11px] italic text-muted-foreground">
                &ldquo;{row.copilotReply}&rdquo;
              </p>
            ) : (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                Turn #{row.turnIndex} · {row.inputSource}
              </p>
            )}
            {chips.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {chips.slice(0, 3).map((c) => (
                  <span
                    key={c.key}
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] " +
                      CHIP_CLASSES[c.tone]
                    }
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <ArrowUpRight
            className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
      </Link>
    </li>
  );
}
