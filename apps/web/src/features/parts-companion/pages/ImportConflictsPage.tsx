import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ArrowRight,
  ArrowLeft,
  Zap,
  User as UserIcon,
  Building2,
  Clock,
  ChevronRight,
  ChevronLeft,
  Edit3,
  Layers3,
  Keyboard,
  X,
  CheckCircle2,
} from "lucide-react";
import {
  fetchImportRun,
  fetchRunConflicts,
  resolveBulkConflicts,
  resolveConflict,
  commitImportRun,
  type ImportConflict,
  type ImportRun,
} from "../lib/import-api";

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

type Mode = "quick" | "audit";

function prettyValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function priorityStyle(p: "high" | "normal" | "low"): { bg: string; fg: string } {
  if (p === "high") return { bg: T.dangerBg, fg: T.danger };
  if (p === "normal") return { bg: T.warningBg, fg: T.warning };
  return { bg: T.infoBg, fg: T.info };
}

export function ImportConflictsPage() {
  const { runId } = useParams<{ runId?: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("quick");
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<"all" | "unresolved" | "high">("unresolved");
  const [customValue, setCustomValue] = useState<string>("");

  const { data: run } = useQuery<ImportRun>({
    queryKey: ["import-run", runId],
    queryFn: () => fetchImportRun(runId!),
    enabled: !!runId,
    refetchInterval: 10000,
  });

  const { data: conflicts = [], refetch } = useQuery<ImportConflict[]>({
    queryKey: ["import-conflicts", runId],
    queryFn: () => fetchRunConflicts(runId!),
    enabled: !!runId,
  });

  const filtered = useMemo(() => {
    let list = conflicts;
    if (filter === "unresolved") list = list.filter((c) => !c.resolution);
    else if (filter === "high") list = list.filter((c) => c.priority === "high");
    return list;
  }, [conflicts, filter]);

  const current = filtered[cursor];

  // Clamp cursor when list shrinks
  useEffect(() => {
    if (cursor >= filtered.length && filtered.length > 0) {
      setCursor(filtered.length - 1);
    } else if (filtered.length === 0) {
      setCursor(0);
    }
  }, [filtered.length, cursor]);

  // Reset custom field on conflict change
  useEffect(() => {
    setCustomValue(current ? prettyValue(current.incoming_value) : "");
  }, [current?.id]);

  const advance = useCallback(() => {
    if (cursor < filtered.length - 1) setCursor(cursor + 1);
  }, [cursor, filtered.length]);

  const retreat = useCallback(() => {
    if (cursor > 0) setCursor(cursor - 1);
  }, [cursor]);

  const handleResolve = useCallback(
    async (resolution: "keep_current" | "take_incoming" | "custom") => {
      if (!current) return;
      await resolveConflict({
        conflict_id: current.id,
        resolution,
        resolution_value: resolution === "custom" ? tryParseValue(customValue) : undefined,
      });
      await refetch();
      advance();
    },
    [current, customValue, refetch, advance],
  );

  const handleBulkTakeIncoming = useCallback(async (fieldNames: string[]) => {
    if (!runId || fieldNames.length === 0) return;
    const n = await resolveBulkConflicts({
      run_id: runId,
      field_names: fieldNames,
      resolution: "take_incoming",
    });
    await refetch();
    return n;
  }, [runId, refetch]);

  const handleBulkKeepCurrent = useCallback(async (fieldNames: string[]) => {
    if (!runId || fieldNames.length === 0) return;
    const n = await resolveBulkConflicts({
      run_id: runId,
      field_names: fieldNames,
      resolution: "keep_current",
    });
    await refetch();
    return n;
  }, [runId, refetch]);

  const handleCommit = useCallback(async () => {
    if (!runId) return;
    await commitImportRun(runId);
    queryClient.invalidateQueries({ queryKey: ["parts-import-dashboard"] });
    navigate("/parts/companion/import");
  }, [runId, queryClient, navigate]);

  // Keyboard shortcuts in quick mode
  useEffect(() => {
    if (mode !== "quick" || !current) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); void handleResolve("keep_current"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); void handleResolve("take_incoming"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (document.getElementById("custom-field") as HTMLInputElement | null)?.focus(); }
      else if (e.key === "j" || e.key === "J") { e.preventDefault(); advance(); }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); retreat(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, current?.id, handleResolve, advance, retreat]);

  const unresolvedCount = conflicts.filter((c) => !c.resolution).length;
  const highPriorityUnresolved = conflicts.filter((c) => !c.resolution && c.priority === "high").length;

  // Group for bulk actions
  const fieldsWithUnresolved = useMemo(() => {
    const map = new Map<string, { count: number; priority: "high" | "normal" | "low" }>();
    for (const c of conflicts) {
      if (c.resolution) continue;
      const existing = map.get(c.field_name);
      if (existing) existing.count++;
      else map.set(c.field_name, { count: 1, priority: c.priority });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [conflicts]);

  return (
    <div className="flex-1 overflow-auto px-4 md:px-10 py-8" style={{ background: T.bg, color: T.text }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="flex items-start gap-4 mb-6">
          <Link
            to="/parts/companion/import"
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
          >
            <ArrowLeft size={16} color={T.textMuted} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold truncate">Reconcile import conflicts</h1>
              {run && (
                <div
                  className="text-xs px-2.5 py-1 rounded-full whitespace-nowrap"
                  style={{ background: T.warningBg, color: T.warning }}
                >
                  {unresolvedCount} unresolved
                </div>
              )}
            </div>
            <div className="text-xs mt-1 truncate" style={{ color: T.textMuted }}>
              {run?.source_file_name} · {run?.file_type} · started {run?.started_at ? relativeTime(run.started_at) : ""}
            </div>
          </div>

          {/* Mode toggle */}
          <div
            className="flex rounded-lg p-0.5 flex-shrink-0"
            style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
          >
            <button
              onClick={() => setMode("quick")}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5"
              style={{
                background: mode === "quick" ? T.orangeGlow : "transparent",
                color: mode === "quick" ? T.orange : T.textMuted,
              }}
            >
              <Zap size={12} />
              Quick
            </button>
            <button
              onClick={() => setMode("audit")}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5"
              style={{
                background: mode === "audit" ? T.orangeGlow : "transparent",
                color: mode === "audit" ? T.orange : T.textMuted,
              }}
            >
              <Layers3 size={12} />
              Audit
            </button>
          </div>
        </header>

        {/* Filter pills */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <FilterPill active={filter === "unresolved"} onClick={() => { setFilter("unresolved"); setCursor(0); }} label={`Unresolved (${unresolvedCount})`} />
          <FilterPill active={filter === "high"} onClick={() => { setFilter("high"); setCursor(0); }} label={`High priority (${highPriorityUnresolved})`} tone="danger" />
          <FilterPill active={filter === "all"} onClick={() => { setFilter("all"); setCursor(0); }} label={`All (${conflicts.length})`} />
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <section
            className="rounded-2xl p-10 text-center"
            style={{ background: T.card, border: `1px solid ${T.border}` }}
          >
            <div
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
              style={{ background: T.successBg }}
            >
              <CheckCircle2 size={24} color={T.success} />
            </div>
            <h2 className="text-xl font-semibold mb-2">All clear</h2>
            <p className="text-sm mb-6" style={{ color: T.textMuted }}>
              No conflicts match this filter. {unresolvedCount === 0 ? "You can commit the import." : ""}
            </p>
            {unresolvedCount === 0 && run && run.status === "awaiting_conflicts" && (
              <button
                onClick={handleCommit}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium"
                style={{
                  background: `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`,
                  color: "#fff",
                  boxShadow: `0 6px 16px ${T.orangeDeep}`,
                }}
              >
                <CheckCircle2 size={16} />
                Commit import
              </button>
            )}
          </section>
        )}

        {/* Quick mode */}
        {mode === "quick" && current && (
          <QuickReview
            conflict={current}
            cursor={cursor}
            total={filtered.length}
            onKeepCurrent={() => handleResolve("keep_current")}
            onTakeIncoming={() => handleResolve("take_incoming")}
            onCustom={(v) => { setCustomValue(v); void handleResolve("custom"); }}
            customValue={customValue}
            setCustomValue={setCustomValue}
            onPrev={retreat}
            onNext={advance}
          />
        )}

        {/* Audit mode */}
        {mode === "audit" && filtered.length > 0 && (
          <AuditTable
            conflicts={filtered}
            onResolve={async (id, resolution) => {
              await resolveConflict({ conflict_id: id, resolution });
              await refetch();
            }}
          />
        )}

        {/* Bulk actions */}
        {fieldsWithUnresolved.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold mb-3" style={{ color: T.textMuted }}>
              Bulk actions by field
            </h2>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: T.card, border: `1px solid ${T.border}` }}
            >
              {fieldsWithUnresolved.map(([field, meta], idx) => {
                const style = priorityStyle(meta.priority);
                return (
                  <div
                    key={field}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ borderTop: idx === 0 ? "none" : `1px solid ${T.borderSoft}` }}
                  >
                    <div
                      className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                      style={{ background: style.bg, color: style.fg }}
                    >
                      {meta.priority}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{field}</div>
                      <div className="text-xs" style={{ color: T.textDim }}>
                        {meta.count} unresolved
                      </div>
                    </div>
                    <button
                      onClick={() => handleBulkKeepCurrent([field])}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: T.bgElevated, color: T.textMuted, border: `1px solid ${T.border}` }}
                    >
                      Keep all current
                    </button>
                    <button
                      onClick={() => handleBulkTakeIncoming([field])}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: T.orangeGlow, color: T.orange, border: `1px solid ${T.orange}` }}
                    >
                      Take all incoming
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Commit bar */}
        {run && run.status === "awaiting_conflicts" && unresolvedCount === 0 && filtered.length === 0 && (
          <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-2xl px-5 py-3 flex items-center gap-3 shadow-xl"
            style={{ background: T.card, border: `1px solid ${T.success}`, boxShadow: `0 8px 24px rgba(34,197,94,0.35)` }}
          >
            <CheckCircle2 size={18} color={T.success} />
            <span className="text-sm">All conflicts resolved.</span>
            <button
              onClick={handleCommit}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium"
              style={{
                background: `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`,
                color: "#fff",
              }}
            >
              Commit now <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── quick review ───────────────────────────────────────────

function QuickReview({
  conflict,
  cursor,
  total,
  onKeepCurrent,
  onTakeIncoming,
  onCustom,
  customValue,
  setCustomValue,
  onPrev,
  onNext,
}: {
  conflict: ImportConflict;
  cursor: number;
  total: number;
  onKeepCurrent: () => void;
  onTakeIncoming: () => void;
  onCustom: (v: string) => void;
  customValue: string;
  setCustomValue: (v: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const style = priorityStyle(conflict.priority);

  return (
    <section
      className="rounded-2xl p-6 md:p-8"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      {/* Progress */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: style.bg, color: style.fg }}
          >
            {conflict.priority} priority
          </div>
          <div className="text-xs" style={{ color: T.textMuted }}>
            {cursor + 1} of {total}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onPrev}
            disabled={cursor === 0}
            className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30"
            style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={onNext}
            disabled={cursor >= total - 1}
            className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-30"
            style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Part header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <div
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: T.textMuted }}
          >
            {conflict.field_label ?? conflict.field_name}
          </div>
        </div>
        <div className="text-2xl font-mono font-semibold">{conflict.part_number}</div>
      </div>

      {/* Side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {/* Current */}
        <button
          onClick={onKeepCurrent}
          className="text-left rounded-xl p-5 transition-all hover:scale-[1.01] focus:outline-none"
          style={{
            background: T.bgElevated,
            border: `2px solid ${T.border}`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <UserIcon size={14} color={T.info} />
            <div className="text-xs uppercase tracking-wide font-medium" style={{ color: T.info }}>
              Your value
            </div>
          </div>
          <div className="text-xl font-mono break-words mb-3" style={{ color: T.text }}>
            {prettyValue(conflict.current_value)}
          </div>
          <div className="space-y-1 text-xs" style={{ color: T.textDim }}>
            {conflict.current_set_by && (
              <div className="flex items-center gap-1.5">
                <UserIcon size={10} />
                Set by operator
              </div>
            )}
            {conflict.current_set_at && (
              <div className="flex items-center gap-1.5">
                <Clock size={10} />
                {relativeTime(conflict.current_set_at)}
              </div>
            )}
          </div>
          <div
            className="mt-4 text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md"
            style={{ background: T.infoBg, color: T.info }}
          >
            ← Keep this
          </div>
        </button>

        {/* Incoming */}
        <button
          onClick={onTakeIncoming}
          className="text-left rounded-xl p-5 transition-all hover:scale-[1.01] focus:outline-none"
          style={{
            background: T.bgElevated,
            border: `2px solid ${T.border}`,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={14} color={T.orange} />
            <div className="text-xs uppercase tracking-wide font-medium" style={{ color: T.orange }}>
              DMS says
            </div>
          </div>
          <div className="text-xl font-mono break-words mb-3" style={{ color: T.text }}>
            {prettyValue(conflict.incoming_value)}
          </div>
          <div className="space-y-1 text-xs" style={{ color: T.textDim }}>
            {conflict.incoming_source && (
              <div className="flex items-center gap-1.5">
                <Layers3 size={10} />
                {conflict.incoming_source}
              </div>
            )}
          </div>
          <div
            className="mt-4 text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md"
            style={{ background: T.orangeGlow, color: T.orange }}
          >
            Take this →
          </div>
        </button>
      </div>

      {/* Custom input */}
      <div
        className="rounded-xl p-4 mb-5"
        style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Edit3 size={14} color={T.purple} />
          <div className="text-xs uppercase tracking-wide font-medium" style={{ color: T.purple }}>
            Or enter a new value
          </div>
        </div>
        <div className="flex gap-2">
          <input
            id="custom-field"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            className="flex-1 rounded-lg px-3 py-2 text-sm font-mono outline-none"
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              color: T.text,
            }}
          />
          <button
            onClick={() => onCustom(customValue)}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: T.purpleBg, color: T.purple, border: `1px solid ${T.purple}` }}
          >
            Use
          </button>
        </div>
      </div>

      {/* Keyboard legend */}
      <div
        className="text-xs flex items-center gap-3 flex-wrap"
        style={{ color: T.textDim }}
      >
        <Keyboard size={12} />
        <span>← keep current</span>
        <span>→ take incoming</span>
        <span>↑ edit custom</span>
        <span>j / k navigate</span>
      </div>
    </section>
  );
}

// ── audit mode (table) ─────────────────────────────────────

function AuditTable({
  conflicts,
  onResolve,
}: {
  conflicts: ImportConflict[];
  onResolve: (id: string, resolution: "keep_current" | "take_incoming") => Promise<void>;
}) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div
        className="grid grid-cols-[140px_100px_1fr_1fr_200px] gap-3 px-4 py-3 text-xs font-medium uppercase tracking-wide"
        style={{ background: T.bgElevated, color: T.textMuted, borderBottom: `1px solid ${T.borderSoft}` }}
      >
        <div>Part</div>
        <div>Field</div>
        <div>Current</div>
        <div>Incoming</div>
        <div className="text-right">Action</div>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        {conflicts.map((c, i) => (
          <div
            key={c.id}
            className="grid grid-cols-[140px_100px_1fr_1fr_200px] gap-3 px-4 py-3 text-sm items-center"
            style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderSoft}` }}
          >
            <div className="font-mono text-xs truncate">{c.part_number}</div>
            <div className="text-xs" style={{ color: T.textMuted }}>{c.field_name}</div>
            <div className="font-mono text-xs truncate" style={{ color: T.info }}>
              {prettyValue(c.current_value)}
            </div>
            <div className="font-mono text-xs truncate" style={{ color: T.orange }}>
              {prettyValue(c.incoming_value)}
            </div>
            <div className="flex gap-1.5 justify-end">
              {c.resolution ? (
                <div
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: T.successBg, color: T.success }}
                >
                  {c.resolution.replace("_", " ")}
                </div>
              ) : (
                <>
                  <button
                    onClick={() => void onResolve(c.id, "keep_current")}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: T.bgElevated, color: T.info, border: `1px solid ${T.border}` }}
                  >
                    Keep
                  </button>
                  <button
                    onClick={() => void onResolve(c.id, "take_incoming")}
                    className="text-xs px-2 py-1 rounded"
                    style={{ background: T.orangeGlow, color: T.orange, border: `1px solid ${T.orange}` }}
                  >
                    Take
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: "neutral" | "danger";
}) {
  const activeBg = tone === "danger" ? T.dangerBg : T.orangeGlow;
  const activeFg = tone === "danger" ? T.danger : T.orange;
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
      style={{
        background: active ? activeBg : T.bgElevated,
        color: active ? activeFg : T.textMuted,
        border: `1px solid ${active ? activeFg : T.border}`,
      }}
    >
      {label}
    </button>
  );
}

function tryParseValue(raw: string): unknown {
  if (raw === "" || raw === "—") return null;
  // Try number first
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && String(asNum) === raw.trim()) return asNum;
  // Try JSON
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
