import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Database, Download, MapPin, Plus, Search, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { QrmCompanyEditorSheet } from "../components/QrmCompanyEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  EmptyState,
  KbdHint,
  MoonshotBeat,
  RetryState,
  RowSkeleton,
  SignalChip,
  StatusDot,
  type StatusTone,
} from "../components/command-deck";
import { ASK_IRON_PATH, createAskIronSeedState } from "../components/askIronHandoff";
import { buildAccountCommandHref } from "../lib/account-command";
import { listCrmCompanies } from "../lib/qrm-api";
import { crmSupabase, type QrmDatabase } from "../lib/qrm-supabase";

type CustomerHealthProfileRow = Pick<
  QrmDatabase["public"]["Tables"]["customer_profiles_extended"]["Row"],
  "id" | "crm_company_id" | "health_score"
>;

type CompanySortMode = "default" | "coverageRisk";

function toneFromHealth(score: number | null | undefined): StatusTone {
  if (score == null) return "cool";
  if (score >= 80) return "hot";
  if (score >= 60) return "active";
  if (score >= 40) return "warm";
  return "cool";
}

function cleanDisplayText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+\s*$/g, "")
    .trim();
}

export function QrmCompaniesPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [includeExtendedFields, setIncludeExtendedFields] = useState(false);
  const [companySortMode, setCompanySortMode] = useState<CompanySortMode>("default");
  const [editorOpen, setEditorOpen] = useState(false);
  const [healthDrawerProfileId, setHealthDrawerProfileId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      searchRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const companiesQuery = useInfiniteQuery({
    queryKey: ["crm", "companies", debouncedSearch, includeExtendedFields],
    queryFn: ({ pageParam, signal }) => listCrmCompanies(debouncedSearch, pageParam, { includeExtendedFields, signal }),
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
  const isInitialLoading = companiesQuery.isLoading && companies.length === 0;
  const hasCohort = companies.length > 0;

  // Derived metrics
  const loaded = companies.length;
  const scores = companies
    .map((c) => healthProfileByCompanyId.get(c.id)?.score ?? null)
    .filter((s): s is number => typeof s === "number");
  const hot = scores.filter((s) => s >= 80).length;
  const cool = scores.filter((s) => s < 40).length;
  const states = new Set(companies.map((c) => c.state).filter(Boolean));
  const tracked = scores.length;
  const legacyIds = companies.filter((c) => Boolean(c.legacyCustomerNumber)).length;
  const coverageGap = Math.max(loaded - tracked, 0);
  const coverageDelta = loaded > 0 && tracked < loaded ? { value: "Backfill", direction: "flat" as const } : undefined;
  const lowestHealthCompany = useMemo(() => {
    let current: { name: string; score: number } | null = null;
    for (const company of companies) {
      const score = healthProfileByCompanyId.get(company.id)?.score;
      if (typeof score !== "number") continue;
      if (!current || score < current.score) {
        current = { name: cleanDisplayText(company.name) || "Unnamed account", score };
      }
    }
    return current;
  }, [companies, healthProfileByCompanyId]);
  const sortedCompanies = useMemo(() => {
    if (companySortMode !== "coverageRisk") return companies;

    const risk = (company: (typeof companies)[number]) => {
      const entry = healthProfileByCompanyId.get(company.id);
      const score = entry?.score;
      const healthRisk = typeof score === "number" ? Math.max(0, 80 - score) : 90;
      return (
        (entry ? 0 : 120) +
        healthRisk +
        (company.legacyCustomerNumber ? 0 : 15) +
        (company.city || company.state ? 0 : 10)
      );
    };

    return [...companies].sort((a, b) => risk(b) - risk(a) || cleanDisplayText(a.name).localeCompare(cleanDisplayText(b.name)));
  }, [companies, companySortMode, healthProfileByCompanyId]);
  const moonshotPending = isInitialLoading || !hasCohort || coverageGap > 0 || tracked === 0;
  const lowestHealthIsHighRisk = lowestHealthCompany ? lowestHealthCompany.score < 40 : false;
  const moonshotHeadline = isInitialLoading
    ? "Account intelligence is loading account rows and health coverage."
    : !hasCohort
      ? "Account intelligence pending: no company cohort is loaded for this view."
      : coverageGap > 0
        ? `Coverage intelligence pending: ${coverageGap} of ${loaded} account${loaded === 1 ? "" : "s"} in this view have no health row yet.`
        : lowestHealthCompany
          ? lowestHealthIsHighRisk
            ? `Highest health risk in this view: ${lowestHealthCompany.name} at health ${lowestHealthCompany.score}.`
            : `No high-risk accounts in this view; lowest health score is ${lowestHealthCompany.name} at ${lowestHealthCompany.score}.`
          : `Coverage is complete for ${loaded} account${loaded === 1 ? "" : "s"}; no health-risk score is available yet.`;

  const ironHeadline =
    isInitialLoading
      ? "Iron is loading the account cohort, health coverage, and IntelliDealer evidence."
      : !hasCohort
        ? "No account cohort loaded yet; add an account or clear filters to restore the command view."
        : tracked === 0
          ? `Health intel pending sync for ${loaded} account${loaded === 1 ? "" : "s"}; list remains safe to search, export, and command.`
          : hot > 0
            ? `${hot} account${hot === 1 ? "" : "s"} running hot across ${states.size} state${states.size === 1 ? "" : "s"}. ${cool} account${cool === 1 ? "" : "s"} need recovery.`
            : `${loaded} account${loaded === 1 ? "" : "s"} across ${states.size} state${states.size === 1 ? "" : "s"}; ${legacyIds} carry IntelliDealer evidence.`;

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Companies"
        subtitle="Every account and sub-account — rolled up by territory, rep, and health."
        crumb={{ surface: "GRAPH", lens: "COMPANIES", count: isInitialLoading ? "loading" : hasCohort ? loaded : "empty" }}
        metrics={[
          { label: "Loaded", value: isInitialLoading || !hasCohort ? "—" : loaded.toLocaleString() },
          { label: "States", value: isInitialLoading || !hasCohort ? "—" : states.size },
          {
            label: "Coverage",
            value: isInitialLoading || !hasCohort ? "—" : `${tracked}/${loaded || 0}`,
            tone: tracked > 0 ? "live" : "warm",
            delta: coverageDelta,
          },
          { label: "Hot (≥80)", value: tracked > 0 ? hot : "—", tone: hot > 0 ? "hot" : undefined },
          { label: "Cool (<40)", value: tracked > 0 ? cool : "—", tone: cool > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: ironHeadline,
          evidence: isInitialLoading ? "Loading cohort" : includeExtendedFields ? "Pulse · Pricing · Legacy" : "Pulse · Pricing · Service",
          freshness: isInitialLoading ? "loading" : tracked > 0 ? "live cohort" : "sync pending",
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

      <MoonshotBeat
        label="Account intelligence"
        headline={moonshotHeadline}
        evidence={
          isInitialLoading
            ? "Loading CRM rows"
            : `customer_profiles_extended health_score · company row coverage ${tracked}/${loaded || 0} · IntelliDealer IDs ${legacyIds}/${loaded || 0}`
        }
        pending={moonshotPending}
        why={coverageGap > 0 ? "Coverage gap" : "Source-backed"}
        action={hasCohort ? { label: "Sort coverage risk", onClick: () => setCompanySortMode("coverageRisk") } : undefined}
      />

      {/* Search */}
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="crm-companies-search"
            ref={searchRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search company · IntelliDealer # · Search 1/2 · city · state"
            aria-label="Search companies"
            className="h-10 w-full rounded-sm border border-qep-deck-rule bg-qep-deck-elevated/60 pl-9 pr-36 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/80 focus:border-qep-orange focus:outline-none focus:ring-1 focus:ring-qep-orange/50"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            <button
              type="button"
              className={`rounded-sm border px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] transition-colors focus-visible:ring-2 focus-visible:ring-qep-orange/40 ${includeExtendedFields ? "border-qep-orange/40 bg-qep-orange/10 text-qep-orange" : "border-qep-deck-rule bg-muted/30 text-muted-foreground hover:text-foreground"}`}
              aria-pressed={includeExtendedFields}
              onClick={() => setIncludeExtendedFields((enabled) => !enabled)}
            >
              ID+ {includeExtendedFields ? "on" : "off"}
            </button>
            <KbdHint />
          </div>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {includeExtendedFields
            ? "Searching legacy customer fields, Search 1/2, contacts, phones, email, and ship-to aliases."
            : `/${" "}focus · ${isInitialLoading ? "loading cohort" : `${loaded.toLocaleString()} loaded`} · base fields active`}
        </p>
      </div>

      {companiesQuery.isLoading && <RowSkeleton variant="company" />}

      {companiesQuery.isError && (
        <RetryState
          message="Failed to load companies. The router can retry without losing the current search."
          diagnostic={`${companiesQuery.error?.name ?? "Unknown"} · ${new Date().toLocaleTimeString()}`}
          onRetry={() => void companiesQuery.refetch()}
        />
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length === 0 && (
        <EmptyState
          headline={debouncedSearch ? "No company match" : "No companies loaded"}
          body={
            includeExtendedFields
              ? "Extended IntelliDealer fields were included. Add a company or clear the search to return to the command deck."
              : "Try IntelliDealer extended search, clear the current filters, or add the missing account now."
          }
          primary={
            <Button size="sm" className="h-8 font-mono text-[11px] uppercase tracking-[0.1em]" onClick={() => setEditorOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add company
            </Button>
          }
          secondary={
            debouncedSearch ? (
              <Button variant="outline" size="sm" className="h-8 font-mono text-[11px] uppercase tracking-[0.1em]" onClick={() => setSearchInput("")}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      )}

      {!companiesQuery.isLoading && !companiesQuery.isError && companies.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 px-3 py-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Iron sort
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setCompanySortMode("default")}
                aria-pressed={companySortMode === "default"}
                className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${companySortMode === "default" ? "border-qep-orange/40 bg-qep-orange/10 text-qep-orange" : "border-qep-deck-rule bg-muted/20 text-muted-foreground hover:text-foreground"}`}
              >
                Default
              </button>
              <button
                type="button"
                onClick={() => setCompanySortMode("coverageRisk")}
                aria-pressed={companySortMode === "coverageRisk"}
                className={`rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${companySortMode === "coverageRisk" ? "border-qep-orange/40 bg-qep-orange/10 text-qep-orange" : "border-qep-live/20 bg-qep-live/[0.04] text-qep-live/80 hover:border-qep-live/40 hover:bg-qep-live/10"}`}
              >
                Coverage risk
              </button>
              {["Largest pipeline", "Newest touch"].map((label) => (
                <button key={label} type="button" disabled className="rounded-sm border border-qep-live/20 bg-qep-live/[0.04] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-live/70 disabled:cursor-not-allowed disabled:opacity-70">
                  {label} · soon
                </button>
              ))}
            </div>
          </div>

          {/* Column legend */}
          <div className="grid grid-cols-12 gap-3 border-b border-qep-deck-rule/50 px-3 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            <div className="col-span-6 sm:col-span-5">Account</div>
            <div className="col-span-6 hidden sm:block">Location</div>
            <div className="col-span-3 text-right sm:col-span-1">Health</div>
          </div>

          <div className="divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40">
            {sortedCompanies.map((company, index) => {
              const entry = healthProfileByCompanyId.get(company.id);
              const score = entry?.score ?? null;
              const tone = toneFromHealth(score);
              const hasHealth = entry !== undefined;
              const displayName = cleanDisplayText(company.name) || "Unnamed account";
              const location =
                [cleanDisplayText(company.city), cleanDisplayText(company.state), cleanDisplayText(company.country)].filter(Boolean).join(", ") ||
                "—";
              const operatingMeta = [
                company.territoryCode ? `Territory ${cleanDisplayText(company.territoryCode)}` : null,
                company.termsCode || company.paymentTermsCode ? `Terms ${cleanDisplayText(company.termsCode || company.paymentTermsCode)}` : null,
                typeof company.pricingLevel === "number" ? `Price L${company.pricingLevel}` : null,
              ].filter(Boolean).join(" · ");
              const rowDescriptionId = `company-row-${company.id}`;
              const askIronQuestion = [
                "Give me the account picture for this company — open deals, recent signals, and any moves worth queueing.",
                `• Company: ${displayName}`,
                location !== "—" ? `• Location: ${location}` : null,
                operatingMeta ? `• Operating fields: ${operatingMeta}` : null,
                company.legacyCustomerNumber ? `• IntelliDealer customer #: ${company.legacyCustomerNumber}` : null,
                hasHealth ? `• Health score in CRM profile: ${score ?? "pending"}` : "• Health score in CRM profile: missing",
                `• Entity: company (${company.id})`,
                "Call summarize_company with this company_id to pull the account row + open deals + recent activities + signals in one shot. If there's a clear follow-up, call propose_move; otherwise tell me what you'd want to know before queueing anything.",
              ].filter(Boolean).join("\n");

              return (
                <div
                  key={company.id}
                  role="group"
                  aria-describedby={rowDescriptionId}
                  className="group grid grid-cols-12 items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-qep-orange/[0.04] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
                  style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
                >
                  <span id={rowDescriptionId} className="sr-only">
                    {displayName}, {location}, health {score ?? "unknown"}, {operatingMeta || "operating fields pending"}.
                  </span>
                  {/* Account */}
                  <div className="col-span-6 flex min-w-0 items-center gap-2.5 sm:col-span-5">
                    <StatusDot tone={tone} pulse={tone === "hot"} />
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-qep-deck-rule bg-qep-deck-elevated">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={buildAccountCommandHref(company.id)}
                        aria-describedby={rowDescriptionId}
                        className="block truncate font-medium text-foreground focus-visible:ring-2 focus-visible:ring-qep-orange/40 focus-visible:ring-offset-2 focus-visible:ring-offset-qep-deck-elevated"
                      >
                        {displayName}
                      </Link>
                      {(company.search1 || company.search2 || operatingMeta) && (
                        <p className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                          {[cleanDisplayText(company.search1), cleanDisplayText(company.search2), operatingMeta].filter(Boolean).join(" · ")}
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
                        aria-label={`Open health score for ${displayName}`}
                        aria-describedby={rowDescriptionId}
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
                    <button
                      type="button"
                      onClick={() =>
                        navigate(ASK_IRON_PATH, {
                          state: createAskIronSeedState(askIronQuestion, "graph", company.id),
                        })
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-qep-orange/30 bg-qep-orange/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange opacity-100 transition-opacity hover:border-qep-orange/60 hover:bg-qep-orange/10 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-qep-orange/40 xl:opacity-0 xl:group-hover:opacity-100"
                      aria-label={`Ask Iron about ${displayName}`}
                      title="Hand this company to Ask Iron"
                    >
                      <Sparkles className="h-3 w-3" aria-hidden />
                      Ask
                    </button>
                    <Link
                      to={buildAccountCommandHref(company.id)}
                      aria-describedby={rowDescriptionId}
                      className="hidden font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange/80 focus-visible:ring-2 focus-visible:ring-qep-orange/40 lg:inline"
                    >
                      Command
                    </Link>
                    <Link
                      to={buildAccountCommandHref(company.id)}
                      aria-describedby={rowDescriptionId}
                      className="focus-visible:ring-2 focus-visible:ring-qep-orange/40"
                    >
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" aria-hidden />
                      <span className="sr-only">Open {displayName}</span>
                    </Link>
                  </div>
                </div>
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
        onSaved={(company) => navigate(buildAccountCommandHref(company.id))}
      />
      <HealthScoreDrawer
        customerProfileId={healthDrawerProfileId}
        open={healthDrawerProfileId !== null}
        onOpenChange={(open) => !open && setHealthDrawerProfileId(null)}
      />
    </div>
  );
}
