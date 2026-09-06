import { useState, useEffect } from "react";
import { Search, Building2, Briefcase, Tractor, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { searchQrmGraph } from "@/features/qrm/lib/qrm-router-api";
import type { QrmSearchItem } from "@/features/qrm/lib/types";

export function salesSearchResultHref(item: QrmSearchItem): string {
  if (item.type === "company") return `/sales/customers/${item.id}`;
  if (item.type === "deal") return `/sales/deals/${item.id}`;
  return `/qrm/equipment/${item.id}`;
}

export function SalesGlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const { profile } = useAuth();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const resultsQuery = useQuery({
    queryKey: ["sales", "global-search", profile?.id, profile?.active_workspace_id, debounced],
    queryFn: () => searchQrmGraph(debounced, ["company", "deal", "equipment"]),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
  const waiting = query.trim() !== debounced || (debounced.length >= 2 && resultsQuery.isFetching);
  const results = resultsQuery.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogTitle>Search sales records</DialogTitle>
        <label className="flex items-center gap-3 rounded-lg border p-3">
          <Search className="h-5 w-5 shrink-0" aria-hidden />
          <input autoFocus aria-label="Search sales records" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers, deals, equipment…" className="min-w-0 flex-1 bg-transparent text-base outline-none" />
        </label>
        <div aria-live="polite">
          {query.trim().length < 2 ? <p className="text-sm text-muted-foreground">Enter at least two characters.</p>
            : waiting ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Searching…</p>
            : resultsQuery.isError ? <div role="alert"><p>Search failed. Your query is retained.</p><button className="mt-2 underline" onClick={() => void resultsQuery.refetch()}>Retry search</button></div>
            : results.length === 0 ? <p>No matching records in your scope for “{query}”.</p>
            : <><p className="mb-2 text-xs text-muted-foreground">Top matching records in your scope. Refine your search for more specific results.</p>
              {results.map((item) => {
                const Icon = item.type === "company" ? Building2 : item.type === "deal" ? Briefcase : Tractor;
                return <button key={`${item.type}:${item.id}`} onClick={() => { navigate(salesSearchResultHref(item)); onClose(); }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-muted">
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span><span className="block font-medium">{item.title}</span><span className="block text-xs text-muted-foreground">{item.type} · {item.subtitle}</span></span>
                </button>;
              })}</>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
