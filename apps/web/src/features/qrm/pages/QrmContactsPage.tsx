import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  ChevronRight,
  Download,
  GitMerge,
  Mail,
  Phone,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { QrmContactEditorSheet } from "../components/QrmContactEditorSheet";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  DeckSurface,
  SignalChip,
  StatusDot,
  type StatusTone,
} from "../components/command-deck";
import { listCrmContacts } from "../lib/qrm-api";
import { listDuplicateCandidates } from "../lib/qrm-router-api";
import { isUuid } from "@/lib/uuid";

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

  const startedAt = useMemo(() => performance.now(), [debouncedSearch]);

  const contactsQuery = useInfiniteQuery({
    queryKey: ["crm", "contacts", debouncedSearch, treeRootCompanyId ?? null],
    queryFn: ({ pageParam }) =>
      listCrmContacts(debouncedSearch, pageParam, {
        treeRootCompanyId: treeRootCompanyId,
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
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            in: (
              column: string,
              values: string[],
            ) => Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>;
          };
        };
      })
        .from("customer_profiles_extended")
        .select("id, health_score")
        .in("id", profileIds);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const healthProfileById = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of healthProfiles) {
      if (typeof row.id === "string") {
        map.set(row.id, typeof row.health_score === "number" ? row.health_score : null);
      }
    }
    return map;
  }, [healthProfiles]);
  const hasNextPage = contactsQuery.hasNextPage;
  const isFetchingNextPage = contactsQuery.isFetchingNextPage;

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
    staleTime: 5 * 60_000,
    retry: false,
  });
  const duplicateCount = duplicatesQuery.data?.length ?? 0;

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

  const ironHeadline =
    duplicateCount > 0
      ? `${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} detected across ${loaded} contacts — resolving keeps activity, deals, and timelines on one record.`
      : hot > 0
        ? `${hot} hot contact${hot === 1 ? "" : "s"} in scope. Newest touch ${newThisWeek} this week.`
        : `${loaded} contact${loaded === 1 ? "" : "s"} loaded. No urgent signal from this cohort.`;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Contacts"
        subtitle="Every person in the field — rep, operator, buyer — reachable in one keystroke."
        crumb={{ surface: "GRAPH", lens: "CONTACTS", count: loaded }}
        metrics={[
          { label: "Loaded", value: loaded.toLocaleString() },
          { label: "Hot (≥80)", value: hot, tone: hot > 0 ? "hot" : undefined },
          { label: "Cool (<40)", value: cool, tone: cool > 0 ? "warm" : undefined },
          {
            label: "New 7d",
            value: newThisWeek,
            delta: newThisWeek > 0 ? { value: `+${newThisWeek}`, direction: "up" } : undefined,
          },
          {
            label: "Duplicates",
            value: duplicateCount,
            tone: duplicateCount > 0 ? "warm" : undefined,
          },
        ]}
        ironBriefing={{
          headline: ironHeadline,
          actions:
            duplicateCount > 0
              ? [{ label: "Review merges →", href: "/qrm/duplicates" }]
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
                      companyName: null,
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
          <Button asChild variant="outline" size="sm" className="shrink-0 self-start sm:self-auto">
            <Link to="/qrm/contacts">Clear filter</Link>
          </Button>
        </DeckSurface>
      )}

      {duplicateCount > 0 && (
        <DeckSurface
          className="flex flex-col gap-2 border-qep-warm/40 bg-qep-warm/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Duplicate contacts detected"
        >
          <div className="flex items-start gap-2 text-sm">
            <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-qep-warm" aria-hidden />
            <p className="text-foreground/90">
              <span className="font-mono font-semibold text-qep-warm">
                {duplicateCount} possible duplicate{duplicateCount === 1 ? "" : "s"}
              </span>{" "}
              detected. Resolving keeps activity, deals, and timelines on one record.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 self-start sm:self-auto">
            <Link to="/qrm/duplicates">Review merges</Link>
          </Button>
        </DeckSurface>
      )}

      {/* Search rail */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="crm-contacts-search"
          ref={searchRef}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search name · email · phone · role"
          className="h-8 w-full rounded-sm border border-qep-deck-rule bg-qep-deck-elevated/60 pl-9 pr-3 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/80 focus:border-qep-orange focus:outline-none focus:ring-1 focus:ring-qep-orange/50"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-sm border border-qep-deck-rule px-1 font-mono text-[10px] text-muted-foreground md:inline">
          /
        </span>
      </div>

      {contactsQuery.isLoading && (
        <div className="space-y-1.5" role="status" aria-label="Loading contacts">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-sm border border-qep-deck-rule/50 bg-muted/20"
            />
          ))}
        </div>
      )}

      {contactsQuery.isError && (
        <DeckSurface className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load contacts. Refresh and try again.
          </p>
        </DeckSurface>
      )}

      {!contactsQuery.isLoading && !contactsQuery.isError && contacts.length === 0 && (
        <DeckSurface className="p-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            No results
          </p>
          <p className="mt-2 text-sm text-foreground/80">
            {treeRootCompanyId
              ? "No contacts linked to this company tree with the current search."
              : "No contacts found. Try a different search term."}
          </p>
        </DeckSurface>
      )}

      {!contactsQuery.isLoading && !contactsQuery.isError && contacts.length > 0 && (
        <div className="space-y-4">
          {/* Column legend */}
          <div className="grid grid-cols-12 gap-3 border-b border-qep-deck-rule/50 px-3 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            <div className="col-span-5 sm:col-span-4">Contact</div>
            <div className="col-span-4 hidden sm:block">Reach</div>
            <div className="col-span-2 hidden md:block">Role</div>
            <div className="col-span-3 text-right sm:col-span-1">Age</div>
            <div className="col-span-4 text-right sm:col-span-1">Health</div>
          </div>

          <div className="divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40">
            {contacts.map((contact) => {
              const score = contact.dgeCustomerProfileId
                ? healthProfileById.get(contact.dgeCustomerProfileId) ?? null
                : null;
              const tone = toneFromHealth(score);
              const age = formatAge(contact.createdAt);
              const hasHealth =
                contact.dgeCustomerProfileId &&
                healthProfileById.has(contact.dgeCustomerProfileId);
              const reach = contact.email || contact.phone;
              const ReachIcon = contact.email ? Mail : contact.phone ? Phone : null;

              return (
                <Link
                  key={contact.id}
                  to={`/qrm/contacts/${contact.id}`}
                  className="group grid grid-cols-12 items-center gap-3 px-3 py-1.5 text-[13px] transition-colors hover:bg-qep-orange/[0.04]"
                >
                  {/* Contact */}
                  <div className="col-span-5 flex min-w-0 items-center gap-2.5 sm:col-span-4">
                    <StatusDot tone={tone} pulse={tone === "hot"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {contact.firstName} {contact.lastName}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground sm:hidden">
                        {contact.title || "—"}
                      </p>
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
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" />
                  </div>
                </Link>
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
