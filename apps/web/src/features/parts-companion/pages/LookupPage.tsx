import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Search,
  X,
  CheckCircle2,
  Plus,
  MessageSquare,
  Copy,
  Mic,
  Flame,
  History,
  Cpu,
  Keyboard,
  ArrowUpRight,
  Sparkles,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { searchParts } from "../lib/companion-api";
import { IntelliDealerBadge } from "../components/IntelliDealerBadge";
import type { SearchResponse, PartSearchResult, CrossReference } from "../lib/types";

// ── Design Tokens ──────────────────────────────────────────

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  cardHover: "#182A44",
  border: "#1F3254",
  borderSoft: "#18263F",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  orangeDeep: "rgba(232,119,34,0.35)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  danger: "#EF4444",
  dangerBg: "rgba(239,68,68,0.12)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  info: "#3B82F6",
  infoBg: "rgba(59,130,246,0.12)",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
} as const;

// ── Kbd helper ─────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-px rounded border border-[#1F3254] bg-[#0F1D31] text-[11px] font-semibold font-mono text-[#8A9BB4] min-w-[20px]">
      {children}
    </kbd>
  );
}

// ── Copyable PN Component ──────────────────────────────────

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText?.(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold font-mono cursor-pointer transition-all duration-150"
      style={{
        border: `1px solid ${copied ? T.success : T.border}`,
        background: copied ? T.successBg : T.bgElevated,
        color: copied ? T.success : T.text,
      }}
    >
      {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : text}
    </button>
  );
}

// ── Cross Reference Chip ────────────────────────────────────

function CrossRefChip({ crossRef }: { crossRef: CrossReference }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
      style={{
        background: crossRef.verified ? T.purpleBg : T.warningBg,
        color: crossRef.verified ? T.purple : T.warning,
        border: `1px solid ${crossRef.verified ? "rgba(168,85,247,0.25)" : "rgba(245,158,11,0.25)"}`,
      }}
    >
      {crossRef.source}:{" "}
      <span className="font-mono font-semibold">{crossRef.part_number}</span>
      {crossRef.verified && <CheckCircle2 size={10} />}
    </span>
  );
}

// ── Quick search chips ─────────────────────────────────────

const QUICK_SEARCHES = [
  "the thing in the chipper drum",
  "oil filter for 2021 Yanmar",
  "cutting edge for loader",
  "Barko 495",
  "Bandit knife",
  "ASV RT-75",
  "Peterson 5710C",
  "Hydraulic filter",
  "Track roller",
];

// ── Mock hot-this-month data ───────────────────────────────

const HOT_PARTS = [
  { rank: 1, pn: "BK-HYD-4951", desc: "Hydraulic Pump Seal Kit", velocity: 247, trend: 18 },
  { rank: 2, pn: "BN-KNF-6300", desc: "Chipper Knife Set (4pc)", velocity: 189, trend: 12 },
  { rank: 3, pn: "ASV-TRK-2040", desc: "Track Roller Assembly", velocity: 156, trend: -3 },
  { rank: 4, pn: "PT-CYL-5710", desc: "Grapple Cylinder Rebuild", velocity: 134, trend: 24 },
  { rank: 5, pn: "FLT-HYD-0022", desc: "Return Line Filter Element", velocity: 121, trend: 7 },
];

// ── Mock symptom-to-part data ──────────────────────────────

const SYMPTOM_PARTS = [
  { symptom: "Boom drift under load", pn: "BK-SLV-4400", desc: "Spool Valve Sleeve", confidence: 94 },
  { symptom: "Track tension loss", pn: "ASV-TNS-3001", desc: "Tension Spring Assembly", confidence: 91 },
  { symptom: "Chipper stall at feed", pn: "BN-CLT-6200", desc: "Clutch Pack Assembly", confidence: 88 },
];

// ── Lookup Page ─────────────────────────────────────────────

export function LookupPage() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentLookups, setRecentLookups] = useState<
    Array<{ q: string; results: number; time: string; topPn?: string }>
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

  // Global "/" shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const searchMutation = useMutation({
    mutationFn: (q: string) => searchParts(q),
    onSuccess: (data, variables) => {
      setSearchResult(data);
      const entry = {
        q: variables,
        results: data.total_results,
        time: "just now",
        topPn: data.results[0]?.part_number,
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
    <div className="flex flex-col h-full overflow-hidden" style={{ background: T.bg }}>
      {/* ── Hero / Search Section ─────────────────────────── */}
      <div
        className="flex-shrink-0 relative"
        style={{
          background: `linear-gradient(180deg, ${T.orangeDeep} 0%, ${T.orangeGlow} 30%, transparent 100%)`,
          padding: "32px 24px 20px",
        }}
      >
        {/* Title Row */}
        <div className="flex items-center gap-3 mb-5">
          <Search size={22} style={{ color: T.orange }} />
          <h1
            className="font-extrabold tracking-tight"
            style={{ fontSize: 22, color: T.text, margin: 0 }}
          >
            Parts Lookup
          </h1>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold"
            style={{ background: T.purpleBg, color: T.purple, border: `1px solid rgba(168,85,247,0.25)` }}
          >
            <Sparkles size={11} /> AI
          </span>
        </div>

        {/* Search Input */}
        <div className="relative flex items-center">
          <Search
            size={18}
            className="absolute left-4"
            style={{ color: T.textMuted }}
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
              if (e.key === "Escape") handleClear();
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search by part number, machine model, description, or symptom..."
            className="w-full rounded-xl outline-none transition-all duration-150 font-sans"
            style={{
              fontSize: 16,
              padding: "14px 110px 14px 46px",
              background: T.card,
              border: `2px solid ${searchFocused || query ? T.orange : T.border}`,
              color: T.text,
            }}
          />
          <div className="absolute right-3 flex items-center gap-1.5">
            {query && (
              <button
                onClick={handleClear}
                className="p-1.5 rounded-md border-none cursor-pointer flex"
                style={{ background: T.bgElevated }}
              >
                <X size={16} style={{ color: T.textMuted }} />
              </button>
            )}
            <button
              className="p-1.5 rounded-md border-none cursor-pointer flex"
              style={{ background: T.bgElevated }}
              title="Voice search"
            >
              <Mic size={16} style={{ color: T.textMuted }} />
            </button>
            <Kbd>/</Kbd>
          </div>
        </div>

        {/* Quick Search Chips */}
        <div className="flex flex-wrap gap-2 mt-3">
          {QUICK_SEARCHES.map((chip) => (
            <button
              key={chip}
              onClick={() => {
                setQuery(chip);
                searchMutation.mutate(chip);
              }}
              className="px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all duration-150"
              style={{
                background: T.bgElevated,
                border: `1px solid ${T.border}`,
                color: T.textMuted,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = T.orange;
                e.currentTarget.style.color = T.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.color = T.textMuted;
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Query classification indicator */}
        {searchResult && (
          <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: T.textMuted }}>
            <span
              className="px-2 py-0.5 rounded font-semibold"
              style={{ background: T.orangeGlow, color: T.orange }}
            >
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
                <strong style={{ color: T.text }}>
                  {searchResult.machine_identified.manufacturer}{" "}
                  {searchResult.machine_identified.model}
                </strong>
              </span>
            )}
            {searchResult.degraded && (
              <span
                className="ml-2 px-2 py-0.5 rounded font-semibold"
                style={{ background: T.warningBg, color: T.warning }}
              >
                {searchResult.degraded_reason || "Degraded mode"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Main Content ──────────────────────────────────── */}
      <div className="flex-1 overflow-auto" style={{ padding: "16px 24px" }}>
        {/* Loading */}
        {searchMutation.isPending && (
          <div className="flex items-center justify-center py-16">
            <div
              className="w-8 h-8 rounded-full animate-spin"
              style={{ border: `3px solid ${T.border}`, borderTopColor: T.orange }}
            />
          </div>
        )}

        {/* Error */}
        {searchMutation.isError && (
          <div
            className="p-4 rounded-lg text-sm"
            style={{ background: T.dangerBg, border: `1px solid rgba(239,68,68,0.25)`, color: T.danger }}
          >
            Search failed: {(searchMutation.error as Error).message}
          </div>
        )}

        {/* ── Dashboard (no results) ──────────────────────── */}
        {!searchResult && !searchMutation.isPending && (
          <div className="flex flex-col gap-5">
            {/* Two-column grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Hot This Month */}
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: T.card, border: `1px solid ${T.border}` }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: `1px solid ${T.borderSoft}` }}
                >
                  <div className="flex items-center gap-2">
                    <Flame size={16} style={{ color: T.orange }} />
                    <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: T.text }}>
                      Hot This Month
                    </span>
                  </div>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                    style={{ background: T.orangeGlow, color: T.orange }}
                  >
                    Live Velocity
                  </span>
                </div>
                <div className="p-2">
                  {HOT_PARTS.map((p) => (
                    <div
                      key={p.rank}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-100"
                      style={{ cursor: "default" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = T.cardHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Rank badge */}
                      <span
                        className="flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold"
                        style={{
                          background: p.rank === 1 ? T.orangeGlow : T.bgElevated,
                          color: p.rank === 1 ? T.orange : T.textMuted,
                          border: `1px solid ${p.rank === 1 ? "rgba(232,119,34,0.3)" : T.borderSoft}`,
                        }}
                      >
                        {p.rank}
                      </span>
                      {/* PN + desc */}
                      <div className="flex-1 min-w-0">
                        <Copyable text={p.pn} />
                        <div className="text-xs mt-0.5 truncate" style={{ color: T.textMuted }}>
                          {p.desc}
                        </div>
                      </div>
                      {/* Velocity */}
                      <span className="text-sm font-bold font-mono" style={{ color: T.text }}>
                        {p.velocity}
                      </span>
                      {/* Trend */}
                      <span
                        className="flex items-center gap-0.5 text-xs font-semibold"
                        style={{ color: p.trend >= 0 ? T.success : T.danger }}
                      >
                        {p.trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {p.trend >= 0 ? "+" : ""}{p.trend}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Searches */}
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: T.card, border: `1px solid ${T.border}` }}
              >
                <div
                  className="flex items-center gap-2 px-4 py-3"
                  style={{ borderBottom: `1px solid ${T.borderSoft}` }}
                >
                  <History size={16} style={{ color: T.info }} />
                  <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: T.text }}>
                    Recent Searches
                  </span>
                </div>
                <div className="p-2">
                  {recentLookups.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm" style={{ color: T.textDim }}>
                      No recent searches yet
                    </div>
                  )}
                  {recentLookups.slice(0, 6).map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQuery(r.q);
                        searchMutation.mutate(r.q);
                      }}
                      className="flex items-center w-full px-3 py-2.5 rounded-lg border-none cursor-pointer text-left transition-colors duration-100"
                      style={{ background: "transparent" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = T.cardHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <Search size={14} className="flex-shrink-0 mr-2.5" style={{ color: T.textDim }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold" style={{ color: T.text }}>
                          {r.q}
                        </span>
                        {r.topPn && (
                          <span className="text-xs font-mono ml-2" style={{ color: T.textDim }}>
                            {r.topPn}
                          </span>
                        )}
                      </div>
                      <span className="text-xs mr-2" style={{ color: T.textDim }}>
                        {r.time}
                      </span>
                      <ArrowUpRight size={14} style={{ color: T.textDim }} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Symptom to Part (Iron) */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: T.card, border: `1px solid ${T.border}` }}
            >
              <div
                className="flex items-center gap-2 px-4 py-3"
                style={{ borderBottom: `1px solid ${T.borderSoft}` }}
              >
                <Cpu size={16} style={{ color: T.purple }} />
                <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: T.text }}>
                  Symptom &rarr; Part (Iron)
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4">
                {SYMPTOM_PARTS.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg p-3"
                    style={{ background: T.bg, border: `1px solid ${T.borderSoft}` }}
                  >
                    <div className="text-xs mb-2" style={{ color: T.textMuted }}>
                      {s.symptom}
                    </div>
                    <div className="mb-1">
                      <Copyable text={s.pn} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: T.textDim }}>
                        {s.desc}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                        style={{ background: T.successBg, color: T.success }}
                      >
                        {s.confidence}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Keyboard Shortcuts */}
            <div
              className="flex items-center gap-4 px-4 py-3 rounded-xl flex-wrap"
              style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
            >
              <div className="flex items-center gap-2 mr-2">
                <Keyboard size={14} style={{ color: T.textDim }} />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.textDim }}>
                  Shortcuts
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                <Kbd>/</Kbd> <span>Focus search</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                <Kbd>Tab</Kbd> <span>Next result</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                <Kbd>Enter</Kbd> <span>Expand</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                <Kbd>Esc</Kbd> <span>Clear</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                <Kbd>Q</Kbd> <span>Queue</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                <Kbd>&#8984;K</Kbd> <span>Search anywhere</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Search Results ──────────────────────────────── */}
        {hasResults && (
          <div className="flex flex-col gap-2.5">
            {searchResult!.results.map((r: PartSearchResult) => (
              <div
                key={r.part_id}
                className="rounded-xl overflow-hidden transition-all duration-150"
                style={{
                  background: T.card,
                  border: `1px solid ${expanded === r.part_id ? T.orange : T.border}`,
                  boxShadow:
                    expanded === r.part_id
                      ? `0 0 0 2px ${T.orangeGlow}`
                      : "none",
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
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-base font-bold font-mono" style={{ color: T.text }}>
                          {r.part_number}
                        </span>
                        <span className="text-sm" style={{ color: T.textMuted }}>
                          · {r.description}
                        </span>
                        {(r.match_type === "semantic" || r.match_type === "hybrid") && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                            style={{
                              background: "rgba(168,85,247,0.14)",
                              color: "#A855F7",
                              border: "1px solid rgba(168,85,247,0.5)",
                            }}
                            title={`Matched by ${r.match_type} (AI-powered)`}
                          >
                            🧠 Smart match
                          </span>
                        )}
                        {r.match_type === "exact" && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: T.successBg,
                              color: T.success,
                              border: `1px solid ${T.success}`,
                            }}
                            title="Exact part number match"
                          >
                            ⌕ Exact
                          </span>
                        )}
                      </div>
                      <div className="text-xs mb-1.5" style={{ color: T.textDim }}>
                        {r.manufacturer} OEM
                        {r.category ? ` · ${r.category}` : ""}
                      </div>
                      {/* Confidence bar */}
                      <div
                        className="rounded-full overflow-hidden"
                        style={{
                          height: 3,
                          width: 120,
                          background: T.borderSoft,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.max(4, Math.min(100, r.confidence * 100))}%`,
                            background:
                              r.confidence >= 0.85
                                ? T.success
                                : r.confidence >= 0.7
                                  ? T.orange
                                  : T.warning,
                            transition: "width 200ms ease-out",
                          }}
                        />
                      </div>
                    </div>

                    {/* Confidence badge */}
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                      style={{
                        background:
                          r.confidence >= 0.9
                            ? T.successBg
                            : r.confidence >= 0.8
                              ? T.warningBg
                              : T.bgElevated,
                      }}
                    >
                      <span
                        className="text-xs font-bold"
                        style={{
                          color:
                            r.confidence >= 0.9
                              ? T.success
                              : r.confidence >= 0.8
                                ? T.warning
                                : T.textMuted,
                        }}
                      >
                        {Math.round(r.confidence * 100)}%
                      </span>
                      <span
                        className="text-[11px]"
                        style={{
                          color:
                            r.confidence >= 0.9
                              ? T.success
                              : r.confidence >= 0.8
                                ? T.warning
                                : T.textMuted,
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
                    className="p-4"
                    style={{ background: T.bg, borderTop: `1px solid ${T.border}` }}
                  >
                    {/* Frequently ordered with */}
                    {r.frequently_ordered_with.length > 0 && (
                      <div className="mb-3">
                        <div
                          className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
                          style={{ color: T.textDim }}
                        >
                          Also order with this part
                        </div>
                        {r.frequently_ordered_with.map((f, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between px-3 py-2 rounded-md mb-1"
                            style={{ background: T.card, border: `1px solid ${T.borderSoft}` }}
                          >
                            <div>
                              <span className="font-mono font-semibold text-[13px]" style={{ color: T.text }}>
                                {f.part_number}
                              </span>
                              <span className="text-xs ml-2" style={{ color: T.textMuted }}>
                                {f.description}
                              </span>
                            </div>
                            <button
                              className="px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors"
                              style={{
                                border: `1px solid ${T.orange}`,
                                background: "transparent",
                                color: T.orange,
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = T.orangeGlow)}
                              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                            >
                              + Add
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      <IntelliDealerBadge partNumber={r.part_number} />
                      <button
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md border-none text-white text-xs font-semibold cursor-pointer transition-colors"
                        style={{ background: T.orange }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#D06A1E")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = T.orange)}
                      >
                        <Plus size={13} /> Add to Request
                      </button>
                      <button
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors"
                        style={{ border: `1px solid ${T.border}`, background: T.card, color: T.textMuted }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = T.cardHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = T.card)}
                      >
                        <MessageSquare size={13} /> Ask AI
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Can't find it? */}
            <div className="text-center py-4">
              <button
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors"
                style={{ border: `1px solid ${T.border}`, background: T.card, color: T.textMuted }}
                onMouseEnter={(e) => (e.currentTarget.style.background = T.cardHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = T.card)}
              >
                <MessageSquare size={14} /> Can&apos;t find what you need? Ask the AI Assistant
              </button>
            </div>
          </div>
        )}

        {/* KB Evidence (if any) */}
        {searchResult && searchResult.kb_evidence.length > 0 && (
          <div className="mt-4">
            <div
              className="text-[11px] font-bold uppercase tracking-wider mb-2"
              style={{ color: T.textDim }}
            >
              Related Documentation
            </div>
            {searchResult.kb_evidence.slice(0, 3).map((ev, i) => (
              <div
                key={i}
                className="p-3 rounded-lg mb-2"
                style={{ background: T.card, border: `1px solid ${T.border}` }}
              >
                <div className="text-xs font-semibold mb-1" style={{ color: T.text }}>
                  {ev.source_title}
                  {ev.page_number ? ` -- pg ${ev.page_number}` : ""}
                </div>
                <div
                  className="text-xs leading-relaxed line-clamp-3"
                  style={{ color: T.textMuted }}
                >
                  {ev.excerpt}
                </div>
                <div className="text-[10px] mt-1" style={{ color: T.textDim }}>
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
