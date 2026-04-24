/**
 * CustomerPicker — Quote Builder step 1 customer selection.
 *
 * Single input with a dropdown that interleaves crm_contacts and
 * crm_companies results with in-the-moment signals (open deals, past
 * quote count, warmth). Replaces the 4-field free-text form for
 * customers who already exist in the CRM. A "New customer" row at the
 * bottom falls through to manual entry for first-time customers.
 *
 * Interaction:
 *  - Debounce 220ms on keystrokes (enough to feel instant but avoid
 *    thrashing supabase on every character).
 *  - ↑/↓ to move, Enter to select, Esc to close.
 *  - ⌘K / Ctrl-K focuses the input from anywhere on the parent page.
 *  - "New customer" is always the last row — Enter on an empty/no-match
 *    query picks it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Building2, User, Phone, Mail, Plus, Flame, Snowflake, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  searchCustomers,
  MIN_QUERY_CHARS,
  EMPTY_SIGNALS,
  type CustomerSearchResult,
  type CustomerSearchContact,
  type CustomerSearchCompany,
  type CustomerWarmth,
  type CompanySignals,
} from "../lib/customer-search-api";

// ── Public contract ──────────────────────────────────────────────────────

export interface PickedCustomer {
  contactId:     string | null;
  companyId:     string | null;
  customerName:  string;
  customerCompany: string;
  customerPhone: string;
  customerEmail: string;
  /** Slice 20a: signals from the picker row are threaded through so the
   *  Customer step can render the Digital Twin intel panel without a
   *  second fetch. Null for manually-entered ("+ New customer") picks. */
  signals:       CompanySignals | null;
  warmth:        CustomerWarmth | null;
}

export interface CustomerPickerProps {
  /**
   * Controlled query value — the parent owns it so typing in "new
   * customer" mode can flow through to manual name/company fields
   * without losing text.
   */
  query: string;
  onQueryChange: (next: string) => void;
  onPick: (picked: PickedCustomer) => void;
  /**
   * When the search yields no results and the rep chose "new customer",
   * the parent swaps to a 4-field manual entry. This callback tells the
   * parent to enter that mode with the current query as the starting
   * customer name.
   */
  onRequestManualEntry: (startingQuery: string) => void;
}

const DEBOUNCE_MS = 220;

// ── Component ────────────────────────────────────────────────────────────

export function CustomerPicker({
  query,
  onQueryChange,
  onPick,
  onRequestManualEntry,
}: CustomerPickerProps) {
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the search query — one timer in a ref so rapid typing
  // collapses into the last char before hitting the network.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < MIN_QUERY_CHARS) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    timerRef.current = setTimeout(async () => {
      try {
        const out = await searchCustomers(query);
        if (!cancelled) {
          setResults(out);
          setHighlight(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; };
  }, [query]);

  // ⌘K / Ctrl+K — focus the input from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Row flattening: results + "new customer" sentinel ─────────────────
  const rows = useMemo(() => {
    // Always include a trailing "new customer" row when the query has
    // enough characters to make the fallback meaningful. This gives reps
    // a deterministic Enter-to-create path even when there are matches.
    const includeNew = query.trim().length >= MIN_QUERY_CHARS;
    return includeNew
      ? ([...results, { kind: "new" as const }] as Array<CustomerSearchResult | { kind: "new" }>)
      : results;
  }, [results, query]);

  // Clamp highlight to valid range
  useEffect(() => {
    if (highlight >= rows.length) setHighlight(Math.max(0, rows.length - 1));
  }, [rows.length, highlight]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(0, rows.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (!open || rows.length === 0) return;
      e.preventDefault();
      pickRow(rows[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }, [open, rows, highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickRow = useCallback((row: CustomerSearchResult | { kind: "new" }) => {
    if (row.kind === "new") {
      onRequestManualEntry(query);
      setOpen(false);
      return;
    }
    if (row.kind === "contact") {
      onPick({
        contactId:       row.contactId,
        companyId:       row.companyId,
        customerName:    row.contactName,
        customerCompany: row.companyName ?? "",
        customerPhone:   row.contactPhone ?? "",
        customerEmail:   row.contactEmail ?? "",
        signals:         row.signals ?? EMPTY_SIGNALS,
        warmth:          row.warmth,
      });
    } else if (row.kind === "company") {
      onPick({
        contactId:       null,
        companyId:       row.companyId,
        customerName:    "",
        customerCompany: row.companyName,
        customerPhone:   row.companyPhone ?? "",
        customerEmail:   "",
        signals:         row.signals ?? EMPTY_SIGNALS,
        warmth:          row.warmth,
      });
    }
    setOpen(false);
  }, [onPick, onRequestManualEntry, query]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">Customer</p>
        {/* Always-visible escape hatch — the dropdown's "+ New customer"
            row is only reachable after typing 2+ chars, which made the
            new-customer path feel hidden. This button skips search and
            goes straight to the 4-field manual form. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRequestManualEntry("")}
          className="gap-1.5"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Add new
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay close so a row click registers before the blur closes the dropdown
            setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className="pl-9 pr-16"
          aria-label="Search customers"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-muted/40 px-1.5 text-[10px] font-mono text-muted-foreground">
          ⌘K
        </kbd>
      </div>

      {open && query.trim().length >= MIN_QUERY_CHARS && (
        <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
          {loading && rows.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">Searching…</div>
          ) : rows.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No matches.</div>
          ) : (
            <ul role="listbox" aria-label="Customer results">
              {rows.map((row, i) => (
                <li
                  key={rowKey(row, i)}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    // Use mousedown so the click fires before the input blur
                    e.preventDefault();
                    pickRow(row);
                  }}
                  className={`cursor-pointer border-t border-border first:border-t-0 px-3 py-2 ${
                    i === highlight ? "bg-qep-orange/10" : "hover:bg-muted/30"
                  }`}
                >
                  {row.kind === "contact" && <ContactRow row={row} />}
                  {row.kind === "company" && <CompanyRow row={row} />}
                  {row.kind === "new" && <NewCustomerRow query={query} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {query.trim().length < MIN_QUERY_CHARS && (
        <p className="text-[11px] text-muted-foreground">
          Type at least {MIN_QUERY_CHARS} characters to search, or click{" "}
          <span className="font-medium text-foreground">Add new</span> for a brand-new customer.
        </p>
      )}
    </Card>
  );
}

// ── Row sub-components ───────────────────────────────────────────────────

function ContactRow({ row }: { row: CustomerSearchContact }) {
  return (
    <div className="flex items-start gap-3">
      <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{row.contactName}</span>
          {row.contactTitle && (
            <span className="text-[11px] text-muted-foreground">· {row.contactTitle}</span>
          )}
          {row.companyName && (
            <span className="text-[11px] text-muted-foreground">@ {row.companyName}</span>
          )}
          <WarmthBadge warmth={row.warmth} />
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
          {row.contactPhone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{row.contactPhone}</span>}
          {row.contactEmail && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{row.contactEmail}</span>}
        </div>
        <SignalsLine signals={row.signals} />
      </div>
    </div>
  );
}

function CompanyRow({ row }: { row: CustomerSearchCompany }) {
  return (
    <div className="flex items-start gap-3">
      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground truncate">{row.companyName}</span>
          {row.companyDba && (
            <span className="text-[11px] text-muted-foreground">dba {row.companyDba}</span>
          )}
          <WarmthBadge warmth={row.warmth} />
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
          {row.contactCount > 0 && <span>{row.contactCount} contact{row.contactCount === 1 ? "" : "s"}</span>}
          {(row.companyCity || row.companyState) && (
            <span>{[row.companyCity, row.companyState].filter(Boolean).join(", ")}</span>
          )}
          {row.companyClassification && <span>{row.companyClassification}</span>}
        </div>
        <SignalsLine signals={row.signals} />
      </div>
    </div>
  );
}

function NewCustomerRow({ query }: { query: string }) {
  return (
    <div className="flex items-center gap-3">
      <Plus className="h-4 w-4 text-qep-orange" />
      <div className="text-sm text-foreground">
        + New customer <span className="text-muted-foreground">"{query.trim()}"</span>
      </div>
    </div>
  );
}

function SignalsLine({ signals }: { signals: CompanySignals }) {
  const parts: string[] = [];
  if (signals.openDeals > 0) {
    parts.push(`${signals.openDeals} open deal${signals.openDeals === 1 ? "" : "s"}${
      signals.openDealValueCents > 0 ? ` (${fmtCompactCents(signals.openDealValueCents)})` : ""
    }`);
  }
  if (signals.pastQuoteCount > 0) {
    parts.push(`${signals.pastQuoteCount} past quote${signals.pastQuoteCount === 1 ? "" : "s"}`);
  }
  if (signals.lastContactDaysAgo != null && signals.lastContactDaysAgo > 0) {
    parts.push(`${signals.lastContactDaysAgo}d since last touch`);
  }
  if (parts.length === 0) return null;
  return (
    <div className="mt-0.5 text-[11px] text-muted-foreground">
      · {parts.join(" · ")}
    </div>
  );
}

function WarmthBadge({ warmth }: { warmth: CustomerWarmth }) {
  if (warmth === "warm") {
    return <Badge variant="default" className="gap-1 text-[10px]"><Flame className="h-3 w-3" />Warm</Badge>;
  }
  if (warmth === "cool") {
    return <Badge variant="secondary" className="text-[10px]">Cool</Badge>;
  }
  if (warmth === "dormant") {
    return <Badge variant="outline" className="gap-1 text-[10px]"><Snowflake className="h-3 w-3" />Dormant</Badge>;
  }
  // "new" — no badge, clutters the primary line
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function rowKey(row: CustomerSearchResult | { kind: "new" }, fallbackIndex: number): string {
  if (row.kind === "contact") return `ct-${row.contactId || fallbackIndex}`;
  if (row.kind === "company") return `co-${row.companyId || fallbackIndex}`;
  return `new-${fallbackIndex}`;
}

function fmtCompactCents(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000)     return `$${Math.round(dollars / 1_000)}k`;
  return `$${dollars.toLocaleString("en-US")}`;
}
