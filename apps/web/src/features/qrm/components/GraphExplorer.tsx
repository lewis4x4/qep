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
 * This component is feature-flagged via shell_v2 and rendered on
 * /qrm/contacts, /qrm/companies, and /qrm/deals when the flag is on. The
 * legacy list pages remain as the default behind the flag so we can compare
 * side-by-side in staging before flipping the flag globally.
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

  return (
    <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6", className)}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

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
          className="h-11 pl-9 text-base"
          aria-label="Search the operator graph"
        />
      </div>

      <nav aria-label="Entity filter" className="flex flex-wrap gap-2">
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
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:border-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{option.label}</span>
              {hasQuery && !isError && (
                <span
                  className={cn(
                    "ml-0.5 rounded-full px-1.5 text-[10px] font-medium",
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
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
        className="flex flex-col divide-y divide-border rounded-lg border bg-card"
      >
        {!hasQuery && (
          <EmptyState
            title="Start typing to explore the graph."
            body="One explorer. One list. Five entity types. Your CRM is a graph, not a tab bar."
          />
        )}
        {hasQuery && isLoading && results.length === 0 && (
          <EmptyState title="Searching…" body="Reaching through the operator graph." />
        )}
        {hasQuery && isError && (
          <EmptyState
            title="Search failed"
            body={
              resultsQuery.error instanceof Error
                ? resultsQuery.error.message
                : "Something went wrong reaching the graph."
            }
          />
        )}
        {hasQuery && !isLoading && !isError && results.length === 0 && (
          <EmptyState
            title="Nothing matches yet."
            body="Try a different spelling, or drop the lens filter to widen the search."
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
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    RESULT_BG[item.type],
                  )}
                >
                  <Icon className={cn("h-4 w-4", RESULT_INTENT[item.type])} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{item.title}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        RESULT_BG[item.type],
                        RESULT_INTENT[item.type],
                      )}
                    >
                      {item.type}
                    </span>
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
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-1 px-6 py-10 text-sm">
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground">{body}</span>
    </div>
  );
}
