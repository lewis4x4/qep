import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  ChevronRight,
  Download,
  Mail,
  Phone,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { QrmContactEditorSheet } from "../components/QrmContactEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  DeckSurface,
  EmptyState,
  KbdHint,
  MoonshotBeat,
  RetryState,
  RowSkeleton,
  SignalChip,
  StatusDot,
  type StatusTone,
} from "../components/command-deck";
import { buildAccountCommandHref } from "../lib/account-command";
import { listCrmContacts } from "../lib/qrm-api";
import { listDuplicateCandidates } from "../lib/qrm-router-api";
import { isUuid } from "@/lib/uuid";
import { crmSupabase, type QrmDatabase } from "../lib/qrm-supabase";

type ContactHealthProfileRow = Pick<
  QrmDatabase["public"]["Tables"]["customer_profiles_extended"]["Row"],
  "id" | "health_score"
>;

/**
 * Map a raw health score (0–100) to a command-deck status tone.
 * Mirrors the band the existing HealthScorePill uses so the vocabulary stays
 * consistent across the app.
 */
function toneFromHealth(score: number | null | undefined): StatusTone {
  if (score == null) return "cool";
  if (score >= 80) return "hot";
  if (score >= 60) return "active";
  if (score >= 40) return "warm";
  return "cool";
}

function formatAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function QrmContactsPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const treeRootParam = searchParams.get("treeRoot");
  const treeRootCompanyId = useMemo(() => {
    if (!treeRootParam || !isUuid(treeRootParam)) return undefined;
    return treeRootParam;
  }, [treeRootParam]);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [healthDrawerProfileId, setHealthDrawerProfileId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const canReviewDuplicates = profile?.role === "admin" || profile?.role === "manager" || profile?.role === "owner";

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

  const startedAt = useMemo(() => performance.now(), [debouncedSearch]);

  const contactsQuery = useInfiniteQuery({
    queryKey: ["crm", "contacts", debouncedSearch, treeRootCompanyId ?? null],
    queryFn: ({ pageParam, signal }) =>
      listCrmContacts(debouncedSearch, pageParam, {
        treeRootCompanyId: treeRootCompanyId,
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60_000,
    meta: { startedAt },
  });

  const contacts = contactsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const profileIds = useMemo(
    () =>
      contacts
        .map((contact) => contact.dgeCustomerProfileId)
        .filter((value): value is string => Boolean(value)),
    [contacts],
  );
  const { data: healthProfiles = [] } = useQuery({
    queryKey: ["crm", "contacts", "health-profiles", profileIds.join(",")],
    enabled: profileIds.length > 0,
    queryFn: async () => {
      const { data, error } = await crmSupabase
        .from("customer_profiles_extended")
        .select("id, health_score")
        .in("id", profileIds);
      if (error) return [];
      return (data ?? []) satisfies ContactHealthProfileRow[];
    },
    staleTime: 60_000,
  });
  const healthProfileById = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of healthProfiles) {
      map.set(row.id, row.health_score);
    }
    return map;
  }, [healthProfiles]);
  const hasNextPage = contactsQuery.hasNextPage;
  const isFetchingNextPage = contactsQuery.isFetchingNextPage;
  const isInitialLoading = contactsQuery.isLoading && contacts.length === 0;
  const hasCohort = contacts.length > 0;

  // Duplicate-candidate surfacing (unchanged contract — see prior comment).
  const duplicatesQuery = useQuery({
    queryKey: ["crm", "duplicates", "hint"],
    queryFn: async () => {
      try {
        return await listDuplicateCandidates();
      } catch {
        return [];
      }
    },
    enabled: canReviewDuplicates,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const duplicateCount = canReviewDuplicates ? duplicatesQuery.data?.length ?? 0 : 0;

  // Derived pulse metrics for the header strip.
  const loaded = contacts.length;
  const healthScores = contacts
    .map((c) => (c.dgeCustomerProfileId ? healthProfileById.get(c.dgeCustomerProfileId) ?? null : null))
    .filter((s): s is number => typeof s === "number");
  const hot = healthScores.filter((s) => s >= 80).length;
  const cool = healthScores.filter((s) => s < 40).length;
  const newThisWeek = contacts.filter((c) => {
    if (!c.createdAt) return false;
    return Date.now() - new Date(c.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const reachable = contacts.filter((c) => c.email || c.phone || c.cell || c.directPhone).length;
  const missingReach = Math.max(loaded - reachable, 0);
  const smsReady = contacts.filter((c) => c.smsOptIn && c.cell).length;
  const callReady = contacts.filter((c) => c.cell || c.directPhone || c.phone).length;
  const emailReady = contacts.filter((c) => c.email).length;

  const ironHeadline =
    isInitialLoading
      ? "Iron is loading the contact cohort, reach channels, and duplicate graph."
      : !hasCohort
        ? "No contact cohort loaded yet; add an operator contact or reset filters to restore reach intelligence."
        : duplicateCount > 0
          ? `${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} detected across ${loaded} contacts; one merge pass protects deals, activity, and timelines.`
          : hot > 0
            ? `${hot} hot contact${hot === 1 ? "" : "s"} in scope. ${reachable}/${loaded || 0} reachable now.`
            : `${loaded} contact${loaded === 1 ? "" : "s"} loaded; ${reachable}/${loaded || 0} have a usable reach path.`;

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Contacts"
        subtitle="Every person in the field — rep, operator, buyer — reachable in one keystroke."
        crumb={{ surface: "GRAPH", lens: "CONTACTS", count: isInitialLoading ? "loading" : hasCohort ? loaded : "empty" }}
        metrics={[
          { label: "Loaded", value: isInitialLoading || !hasCohort ? "—" : loaded.toLocaleString() },
          { label: "Reachable", value: isInitialLoading || !hasCohort ? "—" : `${reachable}/${loaded || 0}`, tone: reachable > 0 ? "live" : "warm" },
          { label: "Missing reach", value: isInitialLoading || !hasCohort ? "—" : missingReach || "—", tone: missingReach > 0 ? "warm" : undefined },
          { label: "Hot (≥80)", value: healthScores.length > 0 ? hot : "—", tone: hot > 0 ? "hot" : undefined },
          canReviewDuplicates
            ? {
                label: "Duplicates",
                value: duplicateCount || "—",
                tone: duplicateCount > 0 ? "warm" : undefined,
              }
            : { label: "Cool (<40)", value: healthScores.length > 0 ? cool : "—", tone: cool > 0 ? "warm" : undefined },
        ]}
        ironBriefing={{
          headline: ironHeadline,
          evidence: isInitialLoading ? "Loading cohort" : duplicateCount > 0 ? "Merge graph · Activity · Deals" : "Reach · Pulse · Activity",
          confidence: isInitialLoading ? 0.5 : duplicateCount > 0 ? 0.91 : 0.84,
          freshness: isInitialLoading ? "loading" : newThisWeek > 0 ? `${newThisWeek} new 7d` : "live cohort",
          actions:
            duplicateCount > 0
              ? [{ label: "Review merges →", href: "/admin/duplicates" }]
              : undefined,
        }}
        rightRail={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]"
              onClick={() => {
                import("@/lib/csv-export").then(({ exportContacts }) => {
                  exportContacts(
                    contacts.map((c) => ({
                      ...c,
                      companyName: c.primaryCompanyName ?? null,
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

      {treeRootCompanyId && (
        <DeckSurface className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-qep-orange" aria-hidden />
            <p>
              Scoped to this company and its child companies — same roll-up as the
              company detail page.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-auto">
            <Button asChild variant="outline" size="sm">
              <Link to={buildAccountCommandHref(treeRootCompanyId)}>Open account command</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/qrm/contacts">Clear filter</Link>
            </Button>
          </div>
        </DeckSurface>
      )}

      <MoonshotBeat
        pending
        headline="Reach intelligence is reserving a best-channel-now lane for every contact in this view."
        evidence={
          isInitialLoading
            ? "Loading reach lanes · awaiting duplicate graph"
            : !hasCohort
              ? "No contact cohort · add or reset filters"
              : `${smsReady} SMS-ready · ${callReady} call-ready · ${emailReady} email-ready · ${missingReach} missing reach`
        }
        why="Channel fit · role · recency"
        action={{ label: duplicateCount > 0 ? "Review merges →" : "Open reach plan →", href: duplicateCount > 0 ? "/admin/duplicates" : "/qrm/contacts" }}
      />

      {/* Search rail */}
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="crm-contacts-search"
            ref={searchRef}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name · email · phone · role"
            aria-label="Search contacts"
            className="h-10 w-full rounded-sm border border-qep-deck-rule bg-qep-deck-elevated/60 pl-9 pr-16 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/80 focus:border-qep-orange focus:outline-none focus:ring-1 focus:ring-qep-orange/50"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            <KbdHint />
          </div>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          / focus · {isInitialLoading ? "loading cohort" : `${loaded.toLocaleString()} loaded`}{treeRootCompanyId ? " · company tree scoped" : " · all contacts"}
        </p>
      </div>

      {contactsQuery.isLoading && <RowSkeleton variant="contact" />}

      {contactsQuery.isError && (
        <RetryState
          message="Failed to load contacts. The router can retry without dropping scope or search state."
          diagnostic={`${contactsQuery.error?.name ?? "Unknown"} · ${new Date().toLocaleTimeString()}`}
          onRetry={() => void contactsQuery.refetch()}
        />
      )}

      {!contactsQuery.isLoading && !contactsQuery.isError && contacts.length === 0 && (
        <EmptyState
          headline={treeRootCompanyId ? "No contacts in this tree" : debouncedSearch ? "No contact match" : "No contacts loaded"}
          body={
            treeRootCompanyId
              ? "No contacts are linked to this company tree with the current search. Clear scope or add the missing operator contact."
              : "Add a contact, clear the current search, or wait for the next IntelliDealer sync to populate this lane."
          }
          primary={
            <Button size="sm" className="h-8 font-mono text-[11px] uppercase tracking-[0.1em]" onClick={() => setEditorOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add contact
            </Button>
          }
          secondary={
            debouncedSearch || treeRootCompanyId ? (
              <Button asChild variant="outline" size="sm" className="h-8 font-mono text-[11px] uppercase tracking-[0.1em]">
                <Link to="/qrm/contacts" onClick={() => setSearchInput("")}>Reset view</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {!contactsQuery.isLoading && !contactsQuery.isError && contacts.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 px-3 py-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Iron sort
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" className="rounded-sm border border-qep-orange/40 bg-qep-orange/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-orange">
                Default
              </button>
              {["Hottest", "Best channel now", "Newest"].map((label) => (
                <button key={label} type="button" disabled className="rounded-sm border border-qep-live/20 bg-qep-live/[0.04] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-qep-live/70 disabled:cursor-not-allowed disabled:opacity-70">
                  {label} · soon
                </button>
              ))}
            </div>
          </div>

          {/* Column legend */}
          <div className="grid grid-cols-12 gap-3 border-b border-qep-deck-rule/50 px-3 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            <div className="col-span-5 sm:col-span-4">Contact</div>
            <div className="col-span-4 hidden sm:block">Reach</div>
            <div className="col-span-2 hidden md:block">Role</div>
            <div className="col-span-3 text-right sm:col-span-1">Age</div>
            <div className="col-span-4 text-right sm:col-span-1">Health</div>
          </div>

          <div className="divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40">
            {contacts.map((contact, index) => {
              const score = contact.dgeCustomerProfileId
                ? healthProfileById.get(contact.dgeCustomerProfileId) ?? null
                : null;
              const tone = toneFromHealth(score);
              const age = formatAge(contact.createdAt);
              const hasHealth =
                contact.dgeCustomerProfileId &&
                healthProfileById.has(contact.dgeCustomerProfileId);
              const reach = contact.email || contact.cell || contact.directPhone || contact.phone;
              const ReachIcon = contact.email ? Mail : reach ? Phone : null;
              const companyLine = contact.primaryCompanyName || contact.primaryCompanyId || null;
              const rowDescriptionId = `contact-row-${contact.id}`;

              return (
                <div
                  key={contact.id}
                  role="group"
                  aria-describedby={rowDescriptionId}
                  className="group grid grid-cols-12 items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-qep-orange/[0.04] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
                  style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
                >
                  <span id={rowDescriptionId} className="sr-only">
                    {contact.firstName} {contact.lastName}, {contact.title || "role unknown"}, {companyLine || "company unknown"}, health {score ?? "unknown"}, reach {reach || "missing"}.
                  </span>
                  {/* Contact */}
                  <div className="col-span-5 flex min-w-0 items-center gap-2.5 sm:col-span-4">
                    <StatusDot tone={tone} pulse={tone === "hot"} />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/qrm/contacts/${contact.id}`}
                        aria-describedby={rowDescriptionId}
                        className="block truncate font-medium text-foreground focus-visible:ring-2 focus-visible:ring-qep-orange/40 focus-visible:ring-offset-2 focus-visible:ring-offset-qep-deck-elevated"
                      >
                        {contact.firstName} {contact.lastName}
                      </Link>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {companyLine || contact.title || "Company pending"}
                      </p>
                      {contact.smsOptIn && contact.cell && (
                        <SignalChip label="SMS" tone="live" className="mt-0.5" />
                      )}
                    </div>
                  </div>

                  {/* Reach */}
                  <div className="col-span-4 hidden min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground sm:flex">
                    {ReachIcon && <ReachIcon className="h-3 w-3 shrink-0" />}
                    <span className="truncate font-mono">{reach || "—"}</span>
                  </div>

                  {/* Role */}
                  <div className="col-span-2 hidden min-w-0 text-[12px] text-muted-foreground md:block">
                    <span className="truncate">{contact.title || "—"}</span>
                  </div>

                  {/* Age */}
                  <div className="col-span-3 text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:col-span-1">
                    {age || "—"}
                  </div>

                  {/* Health */}
                  <div className="col-span-4 flex items-center justify-end gap-1 sm:col-span-1">
                    {hasHealth ? (
                      <button
                        type="button"
                        aria-label={`Open health score for ${contact.firstName} ${contact.lastName}`}
                        aria-describedby={rowDescriptionId}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setHealthDrawerProfileId(contact.dgeCustomerProfileId);
                        }}
                        className="inline-flex"
                      >
                        <SignalChip
                          label="H"
                          value={score ?? "—"}
                          tone={tone}
                        />
                      </button>
                    ) : (
                      <span className="font-mono text-[11px] text-muted-foreground/50">—</span>
                    )}
                    <Link
                      to={`/qrm/contacts/${contact.id}`}
                      aria-describedby={rowDescriptionId}
                      className="focus-visible:ring-2 focus-visible:ring-qep-orange/40"
                    >
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" aria-hidden />
                      <span className="sr-only">Open {contact.firstName} {contact.lastName}</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {contacts.length.toLocaleString()} loaded
            </p>
            {hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 font-mono text-[11px] uppercase tracking-[0.1em]"
                onClick={() => void contactsQuery.fetchNextPage()}
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

      <QrmContactEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={(contact) => navigate(`/qrm/contacts/${contact.id}`)}
      />
      <HealthScoreDrawer
        customerProfileId={healthDrawerProfileId}
        open={healthDrawerProfileId !== null}
        onOpenChange={(open) => !open && setHealthDrawerProfileId(null)}
      />
    </div>
  );
}
