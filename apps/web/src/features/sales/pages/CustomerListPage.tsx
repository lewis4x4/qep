import { useState } from "react";
import { useCustomers } from "../hooks/useCustomers";
import { useCustomerDirectorySearch } from "../hooks/useCustomerDirectorySearch";
import { SalesCustomerCard } from "../components/SalesCustomerCard";
import { CustomerSearchBar } from "../components/CustomerSearchBar";
import { CustomerEmptyState } from "../components/CustomerEmptyState";
import { CustomerInsightsStrip } from "../components/CustomerInsightsStrip";
import { CustomerPulse } from "../components/CustomerPulse";
import { CustomerSkeleton } from "../components/CustomerSkeleton";
import {
  CustomerDirectoryResults,
  buildBookCompanyIdSet,
} from "../components/CustomerDirectoryResults";
import { Flame, Zap, X } from "lucide-react";
import {
  filterCustomersByInsight,
  CUSTOMER_INSIGHT_LABELS,
  type CustomerInsightKey,
} from "../lib/customer-insight-filters";

export function CustomerListPage() {
  const { customers, allCustomers, search, setSearch, isLoading } =
    useCustomers();

  // Insight filter narrows the full list before search composes on top.
  const [insightFilter, setInsightFilter] = useState<CustomerInsightKey | null>(
    null,
  );

  // Directory search fires only when the rep types ≥2 chars. Hits crm_companies
  // + crm_contacts directly so the rep can find customers outside their book.
  const directoryQuery = useCustomerDirectorySearch(search);
  const isSearching = search.trim().length >= 2;

  if (isLoading) {
    return <CustomerSkeleton />;
  }

  // Hero stats — always computed from the unfiltered set.
  const totalOpen = allCustomers.reduce((sum, c) => sum + c.open_deals, 0);
  const hotCount = allCustomers.filter((c) => c.opportunity_score >= 70).length;

  // Resolve the visible list. Search is already applied by useCustomers via
  // `customers`. When an insight filter is active, narrow the full list first
  // then re-apply search so both compose.
  const visibleCustomers = insightFilter
    ? filterCustomersByInsight(customers, insightFilter)
    : customers;

  const isFullyEmpty = allCustomers.length === 0;

  return (
    <div className="flex flex-col pb-20 max-w-lg mx-auto">
      {/* Hero stats */}
      <div
        className="px-4 pt-3.5 pb-3 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-[10px] font-extrabold text-muted-foreground/60 uppercase tracking-[0.1em] mb-0.5">
              My Book of Business
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-black text-foreground tracking-[-0.02em]">
                {allCustomers.length}
              </span>
              <span className="text-xs text-muted-foreground font-semibold">
                active customers
              </span>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.08em]">
                Open Deals
              </p>
              <p className="text-[15px] font-extrabold text-qep-orange">
                {totalOpen}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.08em]">
                Hot
              </p>
              <p className="text-[15px] font-extrabold text-red-400 flex items-center gap-1 justify-end">
                <Flame className="w-[13px] h-[13px]" />
                {hotCount}
              </p>
            </div>
          </div>
        </div>

        {/* Search — always visible so reps can find any customer in the
            dealer directory, even when their book is empty. */}
        <CustomerSearchBar value={search} onChange={setSearch} />
      </div>

      {/* Pulse + Insights strip — hidden while searching to keep focus on
          search results; also hidden when book is fully empty. */}
      {!isFullyEmpty && !isSearching && (
        <>
          <CustomerPulse customers={allCustomers} />
          <CustomerInsightsStrip
            customers={allCustomers}
            activeFilter={insightFilter}
            onFilterChange={setInsightFilter}
          />
        </>
      )}

      {/* Book section header — only when there's a book to label */}
      {!isFullyEmpty && (
        insightFilter ? (
          <InsightFilterBanner
            label={CUSTOMER_INSIGHT_LABELS[insightFilter]}
            count={visibleCustomers.length}
            onClear={() => setInsightFilter(null)}
          />
        ) : (
          <div className="px-4 pt-2.5 pb-0 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-[22px] h-[22px] rounded-[7px] bg-qep-orange/10 flex items-center justify-center">
                <Zap className="w-[11px] h-[11px] text-qep-orange" />
              </div>
              <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.08em]">
                {isSearching ? "In Your Book" : "Iron-Ranked by Opportunity"}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground/60 font-semibold">
              {visibleCustomers.length} result
              {visibleCustomers.length !== 1 ? "s" : ""}
            </span>
          </div>
        )
      )}

      {/* Local book results — present whenever the rep has a book. */}
      {!isFullyEmpty && (
        <div className="px-4 py-2.5 space-y-2.5">
          {visibleCustomers.length > 0 ? (
            visibleCustomers.map((customer, idx) => (
              <SalesCustomerCard
                key={customer.customer_id}
                customer={customer}
                rank={idx}
                showRank={!insightFilter && !search}
              />
            ))
          ) : isSearching ? (
            <p className="text-center text-[12px] text-muted-foreground/70 py-2">
              No book matches — see dealer directory below.
            </p>
          ) : (
            <CustomerEmptyState
              filterLabel={
                insightFilter
                  ? CUSTOMER_INSIGHT_LABELS[insightFilter]
                  : undefined
              }
              onClearFilter={() => setInsightFilter(null)}
            />
          )}
        </div>
      )}

      {/* Dealer directory results — appears whenever the rep is searching. */}
      {isSearching && (
        <CustomerDirectoryResults
          query={search}
          results={directoryQuery.data ?? []}
          isLoading={directoryQuery.isLoading}
          bookCompanyIds={buildBookCompanyIdSet(allCustomers)}
        />
      )}

      {/* Activated empty state — only when no book AND no active search. */}
      {isFullyEmpty && !isSearching && (
        <div className="px-4 py-2.5">
          <CustomerEmptyState />
        </div>
      )}
    </div>
  );
}

/* ── Active insight filter banner ───────────────────────── */
function InsightFilterBanner({
  label,
  count,
  onClear,
}: {
  label: string;
  count: number;
  onClear: () => void;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-white/[0.06]">
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-[12px] bg-qep-orange/10 border border-qep-orange/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-qep-orange animate-pulse shrink-0" />
          <p className="text-[12px] font-bold text-foreground truncate">
            Filtered: <span className="text-qep-orange">{label}</span>
            <span className="text-muted-foreground/70 font-normal ml-1.5">
              · {count} {count === 1 ? "customer" : "customers"}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold text-qep-orange hover:bg-qep-orange/15 transition-colors shrink-0"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      </div>
    </div>
  );
}
