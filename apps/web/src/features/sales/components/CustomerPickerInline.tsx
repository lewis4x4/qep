import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { matchesRepCustomerSearch } from "../lib/customer-search";
import type { RepCustomer } from "../lib/types";

export type CustomerPickerSearch = (
  rawQuery: string,
  limit?: number,
  signal?: AbortSignal,
) => Promise<RepCustomer[]>;

// Two-tier search: rep's own book first, then a workspace-wide fallback
// when the book has no matches and the rep has typed at least 2 chars.
export function CustomerPickerInline({
  bookCustomers,
  initialSearch,
  searchCompanies,
  onPick,
  onClose,
}: {
  bookCustomers: RepCustomer[];
  initialSearch?: string;
  searchCompanies: CustomerPickerSearch;
  onPick: (picked: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(initialSearch ?? "");
  const [debounced, setDebounced] = useState((initialSearch ?? "").trim());

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 220);
    return () => window.clearTimeout(id);
  }, [search]);

  const bookMatches = useMemo(() => {
    if (!debounced) return bookCustomers.slice(0, 12);
    return bookCustomers
      .filter((c) => matchesRepCustomerSearch(c, debounced))
      .slice(0, 12);
  }, [bookCustomers, debounced]);

  const showFallback = debounced.length >= 2 && bookMatches.length === 0;

  const fallbackQuery = useQuery({
    queryKey: ["sales", "smart-voice-capture", "ws-fallback", debounced.toLowerCase()],
    queryFn: ({ signal }) => searchCompanies(debounced, 8, signal),
    enabled: showFallback,
    staleTime: 60_000,
  });

  const fallbackRows = showFallback ? (fallbackQuery.data ?? []) : [];

  return (
    <section
      className="rounded-2xl border border-border bg-card p-3"
      data-testid="customer-picker-inline"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Find a customer
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-semibold text-qep-orange"
        >
          Cancel
        </button>
      </div>
      <input
        autoFocus
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Customer name…"
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
        {bookMatches.map((c) => (
          <CustomerPickerRow
            key={`book-${c.customer_id}`}
            customer={c}
            source="book"
            onPick={() => onPick({ id: c.customer_id, name: c.company_name })}
          />
        ))}
        {showFallback && (
          <p
            className="px-3 py-2 text-[11px] text-muted-foreground"
            data-testid="customer-picker-fallback-copy"
          >
            {fallbackQuery.isLoading
              ? "No matches in your rep book. Searching workspace customers…"
              : fallbackRows.length > 0
                ? "No rep-book match. Showing workspace customer results."
                : "No matches in your rep book or workspace search. Try a different spelling."}
          </p>
        )}
        {fallbackRows.map((c) => (
          <CustomerPickerRow
            key={`ws-${c.customer_id}`}
            customer={c}
            source="workspace"
            onPick={() => onPick({ id: c.customer_id, name: c.company_name })}
          />
        ))}
        {!showFallback && bookMatches.length === 0 && debounced.length < 2 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Start typing to find a customer.
          </p>
        )}
      </div>
    </section>
  );
}

function CustomerPickerRow({
  customer,
  source,
  onPick,
}: {
  customer: RepCustomer;
  source: "book" | "workspace";
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate">{customer.company_name}</span>
        {source === "workspace" && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </span>
        )}
      </span>
      {customer.primary_contact_name && (
        <span className="block text-[11px] text-muted-foreground">
          {customer.primary_contact_name}
        </span>
      )}
    </button>
  );
}
