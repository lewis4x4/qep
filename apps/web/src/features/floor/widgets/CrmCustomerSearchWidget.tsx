/**
 * CrmCustomerSearchWidget — the universal "find a customer" reflex.
 *
 * Autofocused search input. Typing filters `qrm_companies` by name /
 * dba / phone. Top 5 hits render as rows, each click-through deep-links
 * to /qrm/companies/{id}. Empty state teaches the Floor's search affordance.
 *
 * Sized `wide` by default — sits prominently on any role that picks up
 * the phone or walks in with a customer. Intentionally a simple
 * controlled input + useQuery; no fancy debouncing library, a manual
 * 180ms debounce keeps Supabase quiet while the rep is typing.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, Loader2, Phone, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type CompanyHitRow = Pick<
  Database["public"]["Tables"]["qrm_companies"]["Row"],
  "id" | "name" | "dba" | "legacy_customer_number" | "phone" | "city" | "state"
>;

type CompanyHit = CompanyHitRow;

const RESULT_LIMIT = 5;
const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 180;

async function searchCompanies(query: string): Promise<CompanyHit[]> {
  if (query.trim().length < MIN_QUERY_LEN) return [];
  // Supabase `or()` with ilike on the most-searchable customer fields.
  // `legacy_customer_number` keeps migrated IntelliDealer customers
  // findable by the number users already know from the old system.
  const pattern = `%${query.trim().replace(/[()%,*]/g, "")}%`;
  const { data, error } = await supabase
    .from("qrm_companies")
    .select("id, name, dba, legacy_customer_number, phone, city, state")
    .is("deleted_at", null)
    .or(`name.ilike.${pattern},dba.ilike.${pattern},legacy_customer_number.ilike.${pattern},phone.ilike.${pattern}`)
    .order("name", { ascending: true })
    .limit(RESULT_LIMIT);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function CrmCustomerSearchWidget() {
  const [raw, setRaw] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [raw]);

  const trimmed = useMemo(() => debounced.trim(), [debounced]);
  const showResults = trimmed.length >= MIN_QUERY_LEN;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["floor", "customer-search", trimmed],
    queryFn: () => searchCompanies(trimmed),
    enabled: showResults,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div
      role="search"
      aria-label="Customer search"
      className="floor-widget-in relative flex h-full min-h-[200px] flex-col overflow-hidden rounded-xl border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck-elevated))] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-all duration-150 ease-out hover:border-[hsl(var(--qep-orange))]/40"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px] bg-[hsl(var(--qep-orange))]/60"
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5 text-[hsl(var(--qep-gray))]" aria-hidden="true" />
          <h3 className="font-kpi text-[11px] font-extrabold uppercase tracking-[0.14em] text-[hsl(var(--qep-gray))]">
            Customer search
          </h3>
        </div>
        <Link
          to="/qrm/companies"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-[hsl(var(--qep-orange))]"
        >
          All
        </Link>
      </div>

      {/* Search input — styled as a first-class action, not a form field */}
      <div className="relative mt-3">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Type a name, DBA, or phone number"
          aria-label="Search customers"
          className="h-10 w-full rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))] pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-[hsl(var(--qep-orange))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--qep-orange))]/40"
        />
        {raw && (
          <button
            type="button"
            onClick={() => setRaw("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Results */}
      <div className="mt-3 flex-1">
        {!showResults && (
          <p className="text-xs text-muted-foreground">
            {raw.trim().length > 0 && raw.trim().length < MIN_QUERY_LEN
              ? "Keep typing — needs at least two characters."
              : "Start typing. The Floor finds the company, contacts, and recent history."}
          </p>
        )}
        {showResults && isFetching && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Searching…
          </div>
        )}
        {showResults && isError && (
          <p className="text-xs text-rose-300">
            Search hit an error. Try again or open the full QRM customer list.
          </p>
        )}
        {showResults && !isFetching && !isError && (data?.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground">
            No match for <span className="font-semibold text-foreground">{trimmed}</span>.
            Try a shorter fragment, or open the full list above.
          </p>
        )}
        {showResults && !isFetching && !isError && (data?.length ?? 0) > 0 && (
          <ul className="space-y-1.5">
            {data!.map((hit) => (
              <li key={hit.id}>
                <Link
                  to={`/qrm/companies/${hit.id}`}
                  className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-[hsl(var(--qep-deck-rule))] hover:bg-[hsl(var(--qep-deck))]"
                >
                  <Building2
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-[hsl(var(--qep-orange))]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {hit.dba || hit.name || "Unnamed company"}
                    </p>
                    {(hit.city || hit.state || hit.phone || hit.legacy_customer_number) && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        {hit.legacy_customer_number && (
                          <span className="font-semibold text-muted-foreground">
                            IntelliDealer {hit.legacy_customer_number}
                          </span>
                        )}
                        {hit.legacy_customer_number && hit.phone && <span>·</span>}
                        {hit.phone && (
                          <>
                            <Phone className="h-2.5 w-2.5" aria-hidden="true" />
                            {hit.phone}
                          </>
                        )}
                        {(hit.legacy_customer_number || hit.phone) && (hit.city || hit.state) && <span>·</span>}
                        {[hit.city, hit.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
