import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Search,
  X,
  CheckCircle2,
  Plus,
  MessageSquare,
} from "lucide-react";
import { searchParts } from "../lib/companion-api";
import { IntelliDealerBadge } from "../components/IntelliDealerBadge";
import type { SearchResponse, PartSearchResult, CrossReference } from "../lib/types";

// ── Kbd helper ──────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-px rounded border border-[#D1D5DB] bg-[#F9FAFB] text-[11px] font-medium font-mono text-[#718096] min-w-[20px]">
      {children}
    </kbd>
  );
}

// ── Cross Reference Chip ────────────────────────────────────

function CrossRefChip({ crossRef }: { crossRef: CrossReference }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
      style={{
        background: crossRef.verified ? "#EDE9FE" : "#FEF3C7",
        color: crossRef.verified ? "#5B21B6" : "#92400E",
        border: `1px solid ${crossRef.verified ? "#DDD6FE" : "#FDE68A"}`,
      }}
    >
      {crossRef.source}:{" "}
      <span className="font-mono font-semibold">{crossRef.part_number}</span>
      {crossRef.verified && <CheckCircle2 size={10} />}
    </span>
  );
}

// ── Lookup Page ─────────────────────────────────────────────

export function LookupPage() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [recentLookups, setRecentLookups] = useState<
    Array<{ q: string; results: number; time: string }>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("parts_recent_lookups") || "[]");
    } catch {
      return [];
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const searchMutation = useMutation({
    mutationFn: (q: string) => searchParts(q),
    onSuccess: (data, variables) => {
      setSearchResult(data);
      // Update recent lookups
      const entry = {
        q: variables,
        results: data.total_results,
        time: "just now",
      };
      const updated = [entry, ...recentLookups.filter((r) => r.q !== variables)].slice(0, 15);
      setRecentLookups(updated);
      try {
        localStorage.setItem("parts_recent_lookups", JSON.stringify(updated));
      } catch { /* ignore */ }
    },
  });

  const handleSearch = useCallback(() => {
    const q = query.trim();
    if (q.length >= 2) {
      searchMutation.mutate(q);
    }
  }, [query, searchMutation]);

  const handleClear = () => {
    setQuery("");
    setSearchResult(null);
    setExpanded(null);
    inputRef.current?.focus();
  };

  const hasResults = searchResult && searchResult.results.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div
        className="flex-shrink-0 bg-white"
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <div className="relative flex items-center">
          <Search
            size={20}
            className="absolute left-4 text-[#718096]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
              if (e.key === "Escape") handleClear();
            }}
            placeholder="Search by part number, machine model, description, or symptom..."
            className="w-full rounded-xl text-[15px] outline-none transition-colors duration-150 font-sans"
            style={{
              padding: "14px 90px 14px 48px",
              border: `2px solid ${query ? "#E87722" : "#E2E8F0"}`,
            }}
          />
          <div className="absolute right-3 flex gap-1">
            {query && (
              <button
                onClick={handleClear}
                className="p-1.5 rounded-md border-none bg-[#F3F4F6] cursor-pointer flex"
              >
                <X size={16} className="text-[#718096]" />
              </button>
            )}
          </div>
        </div>

        {/* Query classification indicator */}
        {searchResult && (
          <div className="flex items-center gap-2 mt-2 text-xs text-[#718096]">
            <span className="px-2 py-0.5 rounded bg-[#FFF3E8] text-qep-orange font-semibold">
              {searchResult.query_type.replace("_", " ")}
            </span>
            <span>
              {searchResult.total_results} result{searchResult.total_results !== 1 ? "s" : ""}
              {" · "}
              {searchResult.search_time_ms}ms
            </span>
            {searchResult.machine_identified && (
              <span className="ml-1">
                Machine:{" "}
                <strong className="text-[#2D3748]">
                  {searchResult.machine_identified.manufacturer}{" "}
                  {searchResult.machine_identified.model}
                </strong>
              </span>
            )}
            {searchResult.degraded && (
              <span className="ml-2 px-2 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] font-semibold">
                {searchResult.degraded_reason || "Degraded mode"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Results or Recent */}
      <div className="flex-1 overflow-auto" style={{ padding: "16px 24px" }}>
        {searchMutation.isPending && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {searchMutation.isError && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            Search failed: {(searchMutation.error as Error).message}
          </div>
        )}

        {!searchResult && !searchMutation.isPending && (
          <div>
            {/* Recent Lookups */}
            {recentLookups.length > 0 && (
              <>
                <div className="text-[13px] font-bold text-[#718096] uppercase tracking-wider mb-3">
                  Recent Lookups
                </div>
                {recentLookups.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(r.q);
                      searchMutation.mutate(r.q);
                    }}
                    className="flex items-center w-full px-3.5 py-2.5 rounded-lg border-none bg-white cursor-pointer mb-1 text-left transition-colors duration-100 hover:bg-[#F7F8FA]"
                  >
                    <Search size={14} className="text-[#718096] mr-2.5 flex-shrink-0" />
                    <span className="flex-1 text-sm text-[#2D3748]">{r.q}</span>
                    <span className="text-xs text-[#718096] mr-3">
                      {r.results} result{r.results !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-[#718096]">{r.time}</span>
                  </button>
                ))}
              </>
            )}

            {/* Keyboard shortcuts */}
            <div
              className="mt-8 p-5 rounded-xl bg-white"
              style={{ border: "1px dashed #E2E8F0" }}
            >
              <div className="text-xs font-bold text-[#718096] uppercase tracking-wider mb-2.5">
                Keyboard Shortcuts
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] text-[#4A5568]">
                <div>
                  <Kbd>/</Kbd> <span className="ml-1.5">Focus search</span>
                </div>
                <div>
                  <Kbd>Tab</Kbd> <span className="ml-1.5">Next result</span>
                </div>
                <div>
                  <Kbd>Enter</Kbd> <span className="ml-1.5">Expand result</span>
                </div>
                <div>
                  <Kbd>Esc</Kbd> <span className="ml-1.5">Clear search</span>
                </div>
                <div>
                  <Kbd>Q</Kbd> <span className="ml-1.5">Toggle queue</span>
                </div>
                <div>
                  <Kbd>⌘K</Kbd> <span className="ml-1.5">Search anywhere</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search Results */}
        {hasResults && (
          <div className="flex flex-col gap-2.5">
            {searchResult!.results.map((r) => (
              <div
                key={r.part_id}
                className="bg-white rounded-xl overflow-hidden transition-all duration-150"
                style={{
                  border: `1px solid ${expanded === r.part_id ? "#E87722" : "#E2E8F0"}`,
                  boxShadow:
                    expanded === r.part_id
                      ? "0 0 0 2px #FFF3E8"
                      : "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                {/* Result header */}
                <div
                  onClick={() =>
                    setExpanded(expanded === r.part_id ? null : r.part_id)
                  }
                  className="p-4 cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base font-bold font-mono text-[#2D3748]">
                          {r.part_number}
                        </span>
                        <span className="text-sm text-[#4A5568]">
                          · {r.description}
                        </span>
                      </div>
                      <div className="text-xs text-[#718096]">
                        {r.manufacturer} OEM
                        {r.category ? ` · ${r.category}` : ""}
                      </div>
                    </div>

                    {/* Confidence badge */}
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                      style={{
                        background:
                          r.confidence >= 0.9
                            ? "#D1FAE5"
                            : r.confidence >= 0.8
                              ? "#FEF3C7"
                              : "#F3F4F6",
                      }}
                    >
                      <span
                        className="text-xs font-bold"
                        style={{
                          color:
                            r.confidence >= 0.9
                              ? "#065F46"
                              : r.confidence >= 0.8
                                ? "#92400E"
                                : "#718096",
                        }}
                      >
                        {Math.round(r.confidence * 100)}%
                      </span>
                      <span
                        className="text-[11px]"
                        style={{
                          color:
                            r.confidence >= 0.9
                              ? "#065F46"
                              : r.confidence >= 0.8
                                ? "#92400E"
                                : "#718096",
                        }}
                      >
                        match
                      </span>
                    </div>
                  </div>

                  {/* Cross references */}
                  {r.cross_references.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.cross_references.map((cr, i) => (
                        <CrossRefChip key={i} crossRef={cr} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Expanded content */}
                {expanded === r.part_id && (
                  <div
                    className="p-4 bg-[#FAFBFC]"
                    style={{ borderTop: "1px solid #E2E8F0" }}
                  >
                    {/* Frequently ordered with */}
                    {r.frequently_ordered_with.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[11px] font-bold text-[#718096] uppercase tracking-wider mb-1.5">
                          Also order with this part
                        </div>
                        {r.frequently_ordered_with.map((f, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between px-3 py-2 rounded-md bg-white border border-[#E2E8F0] mb-1"
                          >
                            <div>
                              <span className="font-mono font-semibold text-[13px] text-[#2D3748]">
                                {f.part_number}
                              </span>
                              <span className="text-xs text-[#718096] ml-2">
                                {f.description}
                              </span>
                            </div>
                            <button className="px-2.5 py-1 rounded border border-qep-orange bg-white text-[11px] font-semibold text-qep-orange cursor-pointer hover:bg-[#FFF3E8]">
                              + Add
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      <IntelliDealerBadge partNumber={r.part_number} />
                      <button className="flex items-center gap-1 px-3 py-1.5 rounded-md border-none bg-qep-orange text-white text-xs font-semibold cursor-pointer hover:bg-[#D06A1E]">
                        <Plus size={13} /> Add to Request
                      </button>
                      <button className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-[#E2E8F0] bg-white text-[#4A5568] text-xs font-semibold cursor-pointer hover:bg-[#F7F8FA]">
                        <MessageSquare size={13} /> Ask AI
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Can't find it? */}
            <div className="text-center py-4">
              <button className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-semibold text-[#4A5568] cursor-pointer hover:bg-[#F7F8FA]">
                <MessageSquare size={14} /> Can&apos;t find what you need? Ask the
                AI Assistant
              </button>
            </div>
          </div>
        )}

        {/* KB Evidence (if any) */}
        {searchResult && searchResult.kb_evidence.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] font-bold text-[#718096] uppercase tracking-wider mb-2">
              Related Documentation
            </div>
            {searchResult.kb_evidence.slice(0, 3).map((ev, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-white border border-[#E2E8F0] mb-2"
              >
                <div className="text-xs font-semibold text-[#2D3748] mb-1">
                  {ev.source_title}
                  {ev.page_number ? ` — pg ${ev.page_number}` : ""}
                </div>
                <div className="text-xs text-[#4A5568] leading-relaxed line-clamp-3">
                  {ev.excerpt}
                </div>
                <div className="text-[10px] text-[#718096] mt-1">
                  Confidence: {Math.round(ev.confidence * 100)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
