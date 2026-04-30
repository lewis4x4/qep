import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Database, Download, MapPin, Plus, Search } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { QrmCompanyEditorSheet } from "../components/QrmCompanyEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  DeckSurface,
  SignalChip,
  StatusDot,
  type StatusTone,
} from "../components/command-deck";
import { buildAccountCommandHref } from "../lib/account-command";
import { listCrmCompanies } from "../lib/qrm-api";
import { crmSupabase, type QrmDatabase } from "../lib/qrm-supabase";

type CustomerHealthProfileRow = Pick<
  QrmDatabase["public"]["Tables"]["customer_profiles_extended"]["Row"],
  "id" | "crm_company_id" | "health_score"
>;

function toneFromHealth(score: number | null | undefined): StatusTone {
  if (score == null) return "cool";
  if (score >= 80) return "hot";
  if (score >= 60) return "active";
  if (score >= 40) return "warm";
  return "cool";
}

export function QrmCompaniesPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [healthDrawerProfileId, setHealthDrawerProfileId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      searchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const companiesQuery = useInfiniteQuery({
    queryKey: ["crm", "companies", debouncedSearch],
    queryFn: ({ pageParam }) => listCrmCompanies(debouncedSearch, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60_000,
  });

  const companies = companiesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const companyIds = useMemo(() => companies.map((company) => company.id), [companies]);
  const { data: healthProfiles = [] } = useQuery({
    queryKey: ["crm", "companies", "health-profiles", companyIds.join(",")],
    enabled: companyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await crmSupabase
        .from("customer_profiles_extended")
        .select("id, crm_company_id, health_score")
        .in("crm_company_id", companyIds);
      if (error) return [];
      return (data ?? []) satisfies CustomerHealthProfileRow[];
    },
    staleTime: 60_000,
  });
  const healthProfileByCompanyId = useMemo(() => {
    const map = new Map<string, { profileId: string; score: number | null }>();
    for (const row of healthProfiles) {
      if (row.crm_company_id) {
        map.set(row.crm_company_id, {
          profileId: row.id,
          score: row.health_score,
        });
      }
    }
    return map;
  }, [healthProfiles]);
  const hasNextPage = companiesQuery.hasNextPage;
  const isFetchingNextPage = companiesQuery.isFetchingNextPage;

  // Derived metrics
  const loaded = companies.length;
  const scores = companies
    .map((c) => healthProfileByCompanyId.get(c.id)?.score ?? null)
    .filter((s): s is number => typeof s === "number");
  const hot = scores.filter((s) => s >= 80).length;
  const cool = scores.filter((s) => s < 40).length;
  const states = new Set(companies.map((c) => c.state).filter(Boolean));

  const ironHeadline =
    hot > 0
      ? `${hot} account${hot === 1 ? "" : "s"} running hot across ${states.size} state${states.size === 1 ? "" : "s"}. ${cool} account${cool === 1 ? "" : "s"} have gone cold.`
      : `${loaded} account${loaded === 1 ? "" : "s"} across ${states.size} state${states.size === 1 ? "" : "s"}. No breach signal today.`;

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Companies"
        subtitle="Every account and sub-account — rolled up by territory, rep, and health."
        crumb={{ surface: "GRAPH", lens: "COMPANIES", count: loaded }}
        metrics={[
          { label: "Loaded", value: loaded.toLocaleString() },
          { label: "States", value: states.size },
          { label: "Hot (≥80)", value: hot, tone: hot > 0 ? "hot" : undefined },
          { label: "Cool (<40)", value: cool, tone: cool > 0 ? "warm" : undefined },
          { label: "Tracked", value: scores.length },
        ]}
        ironBriefing={{
          headline: ironHeadline,
        }}
        rightRail={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]"
              onClick={() => {
                import("@/lib/csv-export").then(({ exportCompanies }) => {
                  exportCompanies(
                    companies.map((c) => ({
                      ...c,
                      assignedRepName: null,
                    })),
                  );
                });
              }}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              CSV
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 font-mono text-[11px] uppercase tracking-[0.1em]"
              onClick={() => setEditorOpen(true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New
            </Button>
          </div>
        }
      />
      <QrmSubNav />

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="crm-companies-search"
          ref={searchRef}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search company · IntelliDealer # · Search 1/2 · city · state"
          className="h-10 w-full rounded-sm border border-qep-deck-rule bg-qep-deck-elevated/60 pl-9 pr-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/80 focus:border-qep-orange focus:outline-none focus:ring-1 focus:ring-qep-orange/50"
        />
      </div>

      {companiesQuery.isLoading && (
        <div className="space-y-1.5" role="status" aria-label="Loading companies">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-sm border border-qep-deck-rule/50 bg-muted/20"
            />
          ))}
        </div>
      )}

      {companiesQuery.isError && (
        <DeckSurface className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load companies. Refresh and try again.
          </p>
        </DeckSurface>
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length === 0 && (
        <DeckSurface className="p-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            No results
          </p>
          <p className="mt-2 text-sm text-foreground/80">
            No companies found. Try a different search term.
          </p>
        </DeckSurface>
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length > 0 && (
        <div className="space-y-4">
          {/* Column legend */}
          <div className="grid grid-cols-12 gap-3 border-b border-qep-deck-rule/50 px-3 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            <div className="col-span-6 sm:col-span-5">Account</div>
            <div className="col-span-6 hidden sm:block">Location</div>
            <div className="col-span-3 text-right sm:col-span-1">Health</div>
          </div>

          <div className="divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40">
            {companies.map((company) => {
              const entry = healthProfileByCompanyId.get(company.id);
              const score = entry?.score ?? null;
              const tone = toneFromHealth(score);
              const hasHealth = entry !== undefined;
              const location =
                [company.city, company.state, company.country].filter(Boolean).join(", ") ||
                "—";

              return (
                <Link
                  key={company.id}
                  to={buildAccountCommandHref(company.id)}
                  className="group grid grid-cols-12 items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-qep-orange/[0.04]"
                >
                  {/* Account */}
                  <div className="col-span-6 flex min-w-0 items-center gap-2.5 sm:col-span-5">
                    <StatusDot tone={tone} pulse={tone === "hot"} />
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-qep-deck-rule bg-qep-deck-elevated">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{company.name}</p>
                      {(company.search1 || company.search2) && (
                        <p className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                          {[company.search1, company.search2].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {company.legacyCustomerNumber && (
                        <p className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-sm border border-sky-500/20 bg-sky-500/[0.05] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-sky-300">
                          <Database className="h-2.5 w-2.5 shrink-0" aria-hidden />
                          <span className="truncate">IntelliDealer {company.legacyCustomerNumber}</span>
                        </p>
                      )}
                      <p className="truncate text-[11px] text-muted-foreground sm:hidden">
                        {location}
                      </p>
                    </div>
                  </div>

                  {/* Location */}
                  <div className="col-span-6 hidden min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground sm:flex">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate font-mono">{location}</span>
                  </div>

                  {/* Health */}
                  <div className="col-span-3 flex items-center justify-end gap-1 sm:col-span-1">
                    {hasHealth ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setHealthDrawerProfileId(entry.profileId);
                        }}
                        className="inline-flex"
                      >
                        <SignalChip label="H" value={score ?? "—"} tone={tone} />
                      </button>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground/50">—</span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" />
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {companies.length.toLocaleString()} loaded
            </p>
            {hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 font-mono text-[11px] uppercase tracking-[0.1em]"
                onClick={() => void companiesQuery.fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : (
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
                end of list
              </p>
            )}
          </div>
        </div>
      )}

      <QrmCompanyEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(company) => navigate(`/crm/companies/${company.id}`)}
      />
      <HealthScoreDrawer
        customerProfileId={healthDrawerProfileId}
        open={healthDrawerProfileId !== null}
        onOpenChange={(open) => !open && setHealthDrawerProfileId(null)}
      />
    </div>
  );
}
