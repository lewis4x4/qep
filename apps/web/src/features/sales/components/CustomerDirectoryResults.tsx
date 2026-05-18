import { useNavigate } from "react-router-dom";
import {
  Building2,
  UserRound,
  MapPin,
  ArrowRight,
  Search as SearchIcon,
} from "lucide-react";
import type {
  CustomerSearchResult,
  CustomerWarmth,
} from "@/features/quote-builder/lib/customer-search-api";
import type { RepCustomer } from "../lib/types";

interface CustomerDirectoryResultsProps {
  query: string;
  results: CustomerSearchResult[];
  isLoading: boolean;
  /** IDs of customers already in the rep's book — used to mark "In your book" */
  bookCompanyIds: Set<string>;
}

const WARMTH_STYLES: Record<
  CustomerWarmth,
  { bg: string; text: string; label: string }
> = {
  warm: { bg: "bg-red-500/15", text: "text-red-400", label: "Warm" },
  cool: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Cool" },
  dormant: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Dormant" },
  new: { bg: "bg-foreground/[0.06]", text: "text-muted-foreground", label: "New" },
};

export function CustomerDirectoryResults({
  query,
  results,
  isLoading,
  bookCompanyIds,
}: CustomerDirectoryResultsProps) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-[22px] h-[22px] rounded-[7px] bg-cyan-500/10 flex items-center justify-center">
          <SearchIcon className="w-[11px] h-[11px] text-cyan-400" />
        </div>
        <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.08em]">
          Dealer Directory
        </span>
        {!isLoading && (
          <span className="text-[11px] text-muted-foreground/60 ml-auto">
            {results.length} {results.length === 1 ? "match" : "matches"}
          </span>
        )}
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          aria-label="Searching dealer directory"
          className="space-y-2 animate-pulse motion-reduce:animate-none"
        >
          <span className="sr-only">Searching dealer directory…</span>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[64px] rounded-xl bg-white/[0.04] border border-white/[0.05]"
              aria-hidden
            />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-foreground/[0.02] p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No matches in the dealer directory for{" "}
            <span className="text-foreground font-semibold">
              &ldquo;{trimmed}&rdquo;
            </span>
            .
          </p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            Try a company name, contact, city, or legacy customer #.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((result) => (
            <DirectoryResultRow
              key={resultKey(result)}
              result={result}
              alreadyInBook={isInBook(result, bookCompanyIds)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DirectoryResultRow({
  result,
  alreadyInBook,
}: {
  result: CustomerSearchResult;
  alreadyInBook: boolean;
}) {
  const navigate = useNavigate();
  const companyId =
    result.kind === "company" ? result.companyId : result.companyId;
  const warmthStyle = WARMTH_STYLES[result.warmth];

  const title =
    result.kind === "company"
      ? result.companyName
      : result.contactName;
  const subtitle =
    result.kind === "company"
      ? formatCompanyLocation(result.companyCity, result.companyState) ||
        (result.companyDba ? `dba ${result.companyDba}` : "Company")
      : result.companyName
        ? `${result.contactTitle ? result.contactTitle + " · " : ""}${result.companyName}`
        : result.contactEmail ?? "Contact";

  const Icon = result.kind === "company" ? Building2 : UserRound;
  const iconTone =
    result.kind === "company"
      ? "bg-qep-orange/15 text-qep-orange"
      : "bg-cyan-500/15 text-cyan-400";

  const canOpen = Boolean(companyId);

  return (
    <button
      type="button"
      onClick={() => canOpen && navigate(`/sales/customers/${companyId}`)}
      disabled={!canOpen}
      aria-label={`Open ${title}${alreadyInBook ? " (already in your book)" : ""}`}
      className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-[hsl(var(--card))] hover:border-white/20 transition-all text-left active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qep-orange"
    >
      <div
        className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${iconTone}`}
      >
        <Icon className="w-[17px] h-[17px]" strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13.5px] font-bold text-foreground truncate">
            {title}
          </p>
          {alreadyInBook && (
            <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.06em] px-1.5 py-[1px] rounded bg-emerald-500/15 text-emerald-400">
              In Book
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-[11.5px] text-muted-foreground truncate flex items-center gap-1 min-w-0">
            {result.kind === "company" &&
              (result.companyCity || result.companyState) && (
                <MapPin className="w-[10px] h-[10px] shrink-0" />
              )}
            <span className="truncate">{subtitle}</span>
          </p>
          <span
            className={`shrink-0 text-[9px] font-bold uppercase tracking-[0.06em] px-1.5 py-[1px] rounded ${warmthStyle.bg} ${warmthStyle.text}`}
          >
            {warmthStyle.label}
          </span>
        </div>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
    </button>
  );
}

function resultKey(r: CustomerSearchResult): string {
  return r.kind === "company" ? `c-${r.companyId}` : `p-${r.contactId}`;
}

function isInBook(
  r: CustomerSearchResult,
  bookCompanyIds: Set<string>,
): boolean {
  const id = r.kind === "company" ? r.companyId : r.companyId;
  return id ? bookCompanyIds.has(id) : false;
}

function formatCompanyLocation(
  city: string | null,
  state: string | null,
): string {
  if (city && state) return `${city}, ${state}`;
  return city ?? state ?? "";
}

/** Helper to build the in-book set from rep customers. */
export function buildBookCompanyIdSet(
  customers: RepCustomer[],
): Set<string> {
  const s = new Set<string>();
  for (const c of customers) {
    if (c.customer_id) s.add(c.customer_id);
  }
  return s;
}
