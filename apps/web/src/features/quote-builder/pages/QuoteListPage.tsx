import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, FileText, Mic, MessageSquare } from "lucide-react";
import { listQuotePackages } from "../lib/quote-api";
import type { QuoteListItem } from "../../../../../../shared/qep-moonshot-contracts";

const STATUS_FILTERS = ["all", "draft", "ready", "sent", "accepted"] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-blue-500/10 text-blue-400",
  sent: "bg-qep-orange/10 text-qep-orange",
  accepted: "bg-emerald-500/10 text-emerald-400",
  rejected: "bg-red-500/10 text-red-400",
  expired: "bg-muted text-muted-foreground",
};

const ENTRY_ICONS: Record<string, typeof FileText> = {
  voice: Mic,
  ai_chat: MessageSquare,
  manual: FileText,
};

function fmt(amount: number | null): string {
  if (amount == null) return "—";
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function QuoteListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); }, []);
  function handleSearch(value: string) {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(value.trim()), 300);
  }

  const quotesQuery = useQuery({
    queryKey: ["quote-builder", "list", status, debouncedSearch],
    queryFn: () =>
      listQuotePackages({
        status: status !== "all" ? status : undefined,
        search: debouncedSearch || undefined,
      }),
    staleTime: 10_000,
  });

  const items: QuoteListItem[] = quotesQuery.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            All equipment proposals — search, filter, or start a new one.
          </p>
        </div>
        <Button onClick={() => navigate("/quote-v2")}>
          <Plus className="mr-1 h-4 w-4" /> New Quote
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by quote number, customer, or company…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition ${
                status === f
                  ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
                  : "border-border text-muted-foreground hover:border-foreground/20"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {quotesQuery.isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-20 animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {quotesQuery.isError && (
        <Card className="border-red-500/20 p-4">
          <p className="text-sm text-red-400">Failed to load quotes. Try refreshing.</p>
        </Card>
      )}

      {/* Empty state */}
      {!quotesQuery.isLoading && items.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">
            {debouncedSearch || status !== "all"
              ? "No quotes match your filters"
              : "No quotes yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {debouncedSearch || status !== "all"
              ? "Try broadening your search or changing the status filter."
              : "Create your first equipment proposal to get started."}
          </p>
          {!debouncedSearch && status === "all" && (
            <Button onClick={() => navigate("/quote-v2")} className="mt-2">
              <Plus className="mr-1 h-4 w-4" /> New Quote
            </Button>
          )}
        </Card>
      )}

      {/* Quote cards */}
      {items.map((item) => {
        const EntryIcon = ENTRY_ICONS[item.entry_mode ?? "manual"] ?? FileText;
        return (
          <Card
            key={item.id}
            className="cursor-pointer p-4 transition hover:border-qep-orange/30"
            onClick={() => {
              const params = new URLSearchParams({ package_id: item.id });
              navigate(`/quote-v2?${params.toString()}`);
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {item.customer_company || item.customer_name || "Unnamed quote"}
                  </p>
                  <Badge
                    className={`text-[10px] uppercase tracking-wider ${
                      STATUS_COLORS[item.status] ?? STATUS_COLORS.draft
                    }`}
                  >
                    {item.status}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  {item.quote_number && <span className="font-mono">{item.quote_number}</span>}
                  {item.customer_name && item.customer_company && (
                    <span>{item.customer_name}</span>
                  )}
                  <span className="flex items-center gap-1">
                    <EntryIcon className="h-3 w-3" />
                    {item.equipment_summary}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-foreground">{fmt(item.net_total)}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(item.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
