/**
 * GraphExplorer — the single-list entity explorer that powers the Graph
 * surface of the 4-surface shell. It replaces "Contacts / Companies / Deals /
 * Inventory / Rentals / Operators" as separate top-level tabs with one list
 * that can be filtered by entity type via chips.
 *
 * Contract:
 *   - Universal search over the operator graph (qrm-router /qrm/search).
 *   - Chip row to narrow to one entity type at a time.
 *   - Debounced input so we don't hammer the edge function.
 *   - Clicking a result navigates to its canonical detail page.
 *   - Empty state explains the Graph surface in plain language.
 *
 * This component is feature-flagged via shell_v2 and currently backs graph
 * routes that do not yet have dedicated command-deck pages, notably /qrm/deals.
 * Contacts and Companies now own dedicated pages but share this same Graph
 * shell rhythm through QrmPageHeader, QrmSubNav, and command-deck primitives.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Search,
  Sparkles,
  Tractor,
  Truck,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { searchQrmGraph } from "../lib/qrm-router-api";
import type { QrmSearchEntityType, QrmSearchItem } from "../lib/types";
import { QrmPageHeader } from "./QrmPageHeader";
import { QrmSubNav } from "./QrmSubNav";
import {
  DeckSurface,
  EmptyState,
  KbdHint,
  MoonshotBeat,
  RetryState,
  SignalChip,
} from "./command-deck";
import { hrefForGraphResult } from "./graphExplorerRoutes";
import { ASK_IRON_PATH, type AskIronSeedState } from "./askIronHandoff";
import { formatIronGraphPrompt } from "./graphExplorerHelpers";

interface LensDefinition {
  id: "all" | QrmSearchEntityType;
  label: string;
  icon: typeof UserRound;
  description: string;
}

const LENSES: LensDefinition[] = [
  { id: "all", label: "All", icon: Search, description: "Everything" },
  { id: "contact", label: "Contacts", icon: UserRound, description: "People" },
  { id: "company", label: "Companies", icon: Building2, description: "Businesses" },
  { id: "deal", label: "Deals", icon: Briefcase, description: "Active pipeline" },
  { id: "equipment", label: "Inventory", icon: Tractor, description: "Iron on the lot" },
  { id: "rental", label: "Rentals", icon: Truck, description: "Rental requests" },
];

const RESULT_ICON: Record<QrmSearchEntityType, typeof UserRound> = {
  contact: UserRound,
  company: Building2,
  deal: Briefcase,
  equipment: Tractor,
  rental: Truck,
};

const RESULT_INTENT: Record<QrmSearchEntityType, string> = {
  contact: "text-sky-600 dark:text-sky-300",
  company: "text-indigo-600 dark:text-indigo-300",
  deal: "text-emerald-600 dark:text-emerald-300",
  equipment: "text-amber-600 dark:text-amber-300",
  rental: "text-violet-600 dark:text-violet-300",
};

const RESULT_BG: Record<QrmSearchEntityType, string> = {
  contact: "bg-sky-100 dark:bg-sky-950",
  company: "bg-indigo-100 dark:bg-indigo-950",
  deal: "bg-emerald-100 dark:bg-emerald-950",
  equipment: "bg-amber-100 dark:bg-amber-950",
  rental: "bg-violet-100 dark:bg-violet-950",
};

interface GraphExplorerProps {
  /** Initial lens to highlight. Defaults to "all". */
  defaultLens?: LensDefinition["id"];
  /** Optional heading override. */
  title?: string;
  /** Optional subtitle override. */
  subtitle?: string;
  className?: string;
}

export function GraphExplorer({
  defaultLens = "all",
  title = "The Graph",
  subtitle = "Every contact, company, deal, machine, and rental — one explorer.",
  className,
}: GraphExplorerProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [lens, setLens] = useState<LensDefinition["id"]>(defaultLens);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the query so each keystroke doesn't fire a router call.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Slice 9 — mirror of Pulse → Iron. Compose an entity-specific brief and
  // navigate to Ask Iron with the question in router state. AskIronSurface
  // consumes the seed via isAskIronSeedState and auto-sends once. Clicking
  // Ask Iron does NOT navigate to the entity detail — the two affordances
  // are distinct (detail = "inspect", Iron = "interpret").
  const handleAskIron = (item: QrmSearchItem) => {
    const question = formatIronGraphPrompt(item);
    const state: AskIronSeedState = {
      askIronSeed: {
        question,
        source: "graph",
        sourceId: item.id,
      },
    };
    navigate(ASK_IRON_PATH, { state });
  };

  // Keep the input focused on mount so the surface feels like a command bar.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const types = useMemo<QrmSearchEntityType[] | undefined>(() => {
    if (lens === "all") return undefined;
    return [lens];
  }, [lens]);

  const resultsQuery = useQuery<QrmSearchItem[]>({
    queryKey: ["qrm", "graph-explorer", debouncedQuery, lens],
    queryFn: () => searchQrmGraph(debouncedQuery, types),
    enabled: debouncedQuery.length > 0,
    staleTime: 15_000,
  });

  const rawResults = resultsQuery.data ?? [];
  const results = useMemo(() => {
    // Defensive: backend may return types that aren't in the active lens when
    // "all" is selected; keep in place. For a specific lens, filter client-side
    // as a belt-and-braces guard.
    if (lens === "all") return rawResults;
    return rawResults.filter((item) => item.type === lens);
  }, [rawResults, lens]);

  const hasQuery = debouncedQuery.length > 0;
  const isLoading = hasQuery && resultsQuery.isFetching;
  const isError = hasQuery && resultsQuery.isError;

  const countsByType = useMemo(() => {
    const counts: Record<QrmSearchEntityType, number> = {
      contact: 0,
      company: 0,
      deal: 0,
      equipment: 0,
      rental: 0,
    };
    for (const item of rawResults) counts[item.type] += 1;
    return counts;
  }, [rawResults]);

  const activeLens = useMemo(
    () => LENSES.find((option) => option.id === lens) ?? LENSES[0],
    [lens],
  );
  const activeLensCount = lens === "all" ? rawResults.length : countsByType[lens];
  const matchedTypes = Object.values(countsByType).filter((count) => count > 0).length;
  const resultCountLabel = hasQuery
    ? isLoading && results.length === 0
      ? "searching"
      : isError
        ? "error"
        : results.length.toLocaleString()
    : "ready";
  const moonshotHeadline = hasQuery
    ? isLoading && results.length === 0
      ? `Graph intelligence is searching ${activeLens.label.toLowerCase()} against the router-backed operator graph.`
      : isError
        ? "Graph intelligence is blocked by the search router; retry keeps the command deck in place."
        : results.length > 0
          ? `Graph intelligence found ${results.length} ${activeLens.label.toLowerCase()} match${results.length === 1 ? "" : "es"}; open a result or hand one to Iron for interpretation.`
          : `No ${activeLens.label.toLowerCase()} match yet; widen the lens or change the spelling to keep the graph search honest.`
    : `Command search is staged for ${activeLens.label.toLowerCase()}; type once to traverse contacts, companies, deals, iron, and rentals.`;

  return (
    <div className={cn("mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8", className)}>
      <QrmPageHeader
        title={title}
        subtitle={subtitle}
        crumb={{ surface: "GRAPH", lens: activeLens.label.toUpperCase(), count: resultCountLabel }}
        metrics={[
          { label: "Lens", value: activeLens.label },
          { label: "Results", value: hasQuery && !isError ? results.length.toLocaleString() : "—", tone: results.length > 0 ? "live" : undefined },
          { label: "Matched types", value: hasQuery && !isError ? matchedTypes : "—" },
          { label: "Active lens hits", value: hasQuery && !isError ? activeLensCount.toLocaleString() : "—" },
          { label: "Router", value: isError ? "Blocked" : hasQuery ? "Live" : "Ready", tone: isError ? "warm" : hasQuery ? "live" : undefined },
        ]}
        ironBriefing={{
          headline: hasQuery
            ? isLoading && results.length === 0
              ? `Iron is searching ${activeLens.label.toLowerCase()} now; results will populate when the router responds.`
              : isError
                ? "Iron cannot read the graph right now because the search router failed; retry to restore live results."
                : results.length > 0
                  ? `${results.length} result${results.length === 1 ? "" : "s"} in ${activeLens.label}; Enter opens the top hit, Ask Iron explains any row.`
                  : `No ${activeLens.label.toLowerCase()} results yet; widen the lens or adjust the query.`
            : "Iron is ready to search the operator graph; start with a customer, deal, serial, rental, or machine clue.",
          evidence: hasQuery ? "QRM router · Graph lens · Row Ask Iron" : "QRM router · Command search",
          freshness: isLoading ? "searching" : hasQuery ? "live query" : "ready",
          actions: [
            { label: "Focus search", onClick: () => inputRef.current?.focus() },
            {
              label: "Ask graph",
              onClick: () =>
                navigate(ASK_IRON_PATH, {
                  state: {
                    askIronSeed: {
                      question: `Help me explore the QRM graph${query.trim() ? ` for "${query.trim()}"` : ""}. Recommend the next account, deal, or machine to inspect and explain the source evidence.`,
                      source: "graph",
                    },
                  } satisfies AskIronSeedState,
                }),
            },
          ],
        }}
        showDataSourceBadge={false}
      />
      <QrmSubNav />

      <MoonshotBeat
        label="Graph intelligence"
        headline={moonshotHeadline}
        evidence={
          hasQuery
            ? `searchQrmGraph · lens ${activeLens.id} · ${rawResults.length} raw result${rawResults.length === 1 ? "" : "s"}`
            : "searchQrmGraph · contacts · companies · deals · equipment · rentals"
        }
        pending={!hasQuery || isLoading || isError || results.length === 0}
        why={
          hasQuery
            ? isError
              ? "Router blocked"
              : results.length > 0
                ? "Source-backed"
                : "Pending match"
            : "Awaiting query"
        }
        action={{ label: "Focus search", onClick: () => inputRef.current?.focus() }}
      />

      <DeckSurface className="overflow-hidden">
        <div className="border-b border-qep-deck-rule/70 bg-qep-deck-elevated/60 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              autoComplete="off"
              placeholder="Search any contact, company, deal, machine, or rental…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results[0]) {
                  event.preventDefault();
                  navigate(hrefForGraphResult(results[0]));
                }
              }}
              className="h-11 border-qep-deck-rule bg-background/80 pl-9 pr-10 text-base shadow-none focus-visible:ring-qep-orange/40"
              aria-label="Search the operator graph"
            />
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <KbdHint>/</KbdHint>
            </div>
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {hasQuery ? `Searching ${activeLens.label}; press Enter to open the top result.` : "Press / to focus search. One command bar spans all graph lenses."}
          </p>
        </div>

        <nav aria-label="Entity filter" className="flex flex-wrap gap-2 border-b border-qep-deck-rule/70 px-4 py-3">
          {LENSES.map((option) => {
            const active = lens === option.id;
            const Icon = option.icon;
            const count =
              option.id === "all"
                ? rawResults.length
                : countsByType[option.id as QrmSearchEntityType];
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setLens(option.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] transition",
                  active
                    ? "border-qep-live/40 bg-qep-live/10 text-qep-live shadow-sm"
                    : "border-qep-deck-rule bg-background/60 text-muted-foreground hover:border-qep-orange/40 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span>{option.label}</span>
                {hasQuery && !isError && (
                  <span
                    className={cn(
                      "ml-0.5 rounded-sm px-1.5 text-[10px]",
                      active
                        ? "bg-qep-live/15 text-qep-live"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <section
          aria-live="polite"
          aria-label="Search results"
          className="flex flex-col divide-y divide-qep-deck-rule/70"
        >
          {!hasQuery && (
            <EmptyState
              headline="Start typing to explore the graph"
              body="One explorer. One command-deck rhythm. Five entity types stay searchable without leaving the QRM Graph surface."
              className="m-4 border-dashed"
            />
          )}
          {hasQuery && isLoading && results.length === 0 && (
            <EmptyState
              headline="Searching"
              body="Reaching through the operator graph and preserving the active lens while the router responds."
              className="m-4"
            />
          )}
          {hasQuery && isError && (
            <RetryState
              message="Search failed"
              diagnostic={
                resultsQuery.error instanceof Error
                  ? resultsQuery.error.message
                  : "Something went wrong reaching the graph."
              }
              onRetry={() => void resultsQuery.refetch()}
              className="m-4"
            />
          )}
          {hasQuery && !isLoading && !isError && results.length === 0 && (
            <EmptyState
              headline="Nothing matches yet"
              body="Try a different spelling, or drop the lens filter to widen the search."
              className="m-4"
            />
          )}
          {results.map((item) => {
            const Icon = RESULT_ICON[item.type];
            return (
              <div
                key={`${item.type}-${item.id}`}
                className="group flex w-full items-center gap-1 transition hover:bg-accent/40"
              >
                <button
                  type="button"
                  onClick={() => navigate(hrefForGraphResult(item))}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm",
                      RESULT_BG[item.type],
                    )}
                  >
                    <Icon className={cn("h-4 w-4", RESULT_INTENT[item.type])} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      <SignalChip label={item.type} tone="live" className="shrink-0" />
                    </span>
                    {item.subtitle && (
                      <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span>
                    )}
                  </span>
                </button>
                {/*
                  Slice 9 — "Ask Iron" sibling. Mirrors the Pulse pattern
                  (orange chip, Sparkles icon) so operators build one muscle
                  memory across surfaces. Kept as a sibling button rather
                  than nested inside the navigate button because <button>
                  inside <button> is invalid HTML and breaks Tab order.
                */}
                <button
                  type="button"
                  onClick={() => handleAskIron(item)}
                  className={cn(
                    "mr-3 inline-flex shrink-0 items-center gap-1 rounded-full border border-qep-orange/30 bg-qep-orange/5 px-2.5 py-1 text-[11px] font-medium text-qep-orange",
                    "transition-colors hover:border-qep-orange/60 hover:bg-qep-orange/10",
                    "focus:outline-none focus:ring-2 focus:ring-qep-orange/40",
                  )}
                  aria-label={`Ask Iron about ${item.title}`}
                  title="Hand this entity to Ask Iron"
                >
                  <Sparkles className="h-3 w-3" aria-hidden />
                  Ask Iron
                </button>
              </div>
            );
          })}
        </section>
      </DeckSurface>
    </div>
  );
}
