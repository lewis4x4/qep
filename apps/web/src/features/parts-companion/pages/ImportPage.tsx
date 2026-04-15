import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ArrowRight,
  Info,
  Layers,
  Package,
  Users,
  Building2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  cancelImportRun,
  commitImportRun,
  fetchDashboardStats,
  startImportPreview,
  uploadImportFile,
  type DashboardStats,
  type ImportFileType,
  type ImportStatus,
  type PreviewStats,
} from "../lib/import-api";
import { supabase } from "../../../lib/supabase";

// ── Design tokens (match QueuePage) ────────────────────────

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

// ── helpers ────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fileTypeLabel(t: ImportFileType): string {
  return {
    partmast: "DMS PARTMAST Export",
    vendor_price: "Vendor Price Catalog",
    vendor_contacts: "Vendor Contacts Workbook",
    unknown: "Unknown",
  }[t];
}

function fileTypeIcon(t: ImportFileType) {
  return {
    partmast: Package,
    vendor_price: Layers,
    vendor_contacts: Users,
    unknown: FileSpreadsheet,
  }[t];
}

function statusColor(s: ImportStatus): string {
  return {
    pending: T.textMuted,
    parsing: T.info,
    previewing: T.warning,
    awaiting_conflicts: T.warning,
    committing: T.info,
    committed: T.success,
    failed: T.danger,
    rolled_back: T.danger,
    cancelled: T.textDim,
  }[s];
}

// ── component ──────────────────────────────────────────────

type Phase = "idle" | "uploading" | "previewing" | "preview_ready" | "committing" | "done" | "error";

interface PreviewState {
  run_id: string;
  file_type: ImportFileType;
  file_name: string;
  file_size: number;
  status: ImportStatus;
  stats: PreviewStats;
}

export function ImportPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [fileTypeHint, setFileTypeHint] = useState<ImportFileType | undefined>();
  const [dragOver, setDragOver] = useState(false);

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["parts-import-dashboard"],
    queryFn: fetchDashboardStats,
    refetchInterval: phase === "committing" ? 2000 : 15000,
  });

  const onFileSelected = useCallback(async (file: File) => {
    setErrorMsg(null);
    setPhase("uploading");
    try {
      const upload = await uploadImportFile(file);
      setPhase("previewing");
      const result = await startImportPreview({
        storage_path: upload.storage_path,
        source_file_name: upload.source_file_name,
        file_type_hint: fileTypeHint,
      });
      setPreview({
        run_id: result.run_id,
        file_type: result.file_type,
        file_name: upload.source_file_name,
        file_size: upload.size_bytes,
        status: result.status,
        stats: result.stats,
      });
      setPhase("preview_ready");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setPhase("error");
    }
  }, [fileTypeHint]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void onFileSelected(file);
  }, [onFileSelected]);

  const onCommit = useCallback(async () => {
    if (!preview) return;
    setPhase("committing");
    try {
      const result = await commitImportRun(preview.run_id);
      setPreview((p) => p ? { ...p, status: result.status } : null);
      setPhase("done");
      queryClient.invalidateQueries({ queryKey: ["parts-import-dashboard"] });
    } catch (err) {
      setErrorMsg((err as Error).message);
      setPhase("error");
    }
  }, [preview, queryClient]);

  const onCancel = useCallback(async () => {
    if (!preview) return;
    await cancelImportRun(preview.run_id).catch(() => {});
    setPreview(null);
    setPhase("idle");
  }, [preview]);

  const resetFlow = useCallback(() => {
    setPreview(null);
    setPhase("idle");
    setErrorMsg(null);
    setFileTypeHint(undefined);
  }, []);

  return (
    <div
      className="flex-1 overflow-auto px-6 md:px-10 py-8"
      style={{ background: T.bg, color: T.text }}
    >
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: T.orangeGlow, boxShadow: `0 0 24px ${T.orangeGlow}` }}
            >
              <Upload size={20} color={T.orange} />
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Parts Intelligence Import
            </h1>
          </div>
          <p style={{ color: T.textMuted }} className="text-sm md:text-base max-w-2xl">
            Ingest DMS PARTMAST exports, vendor price catalogs, and vendor contact
            workbooks. Nothing is overwritten silently — conflicts with manual edits
            land in a review queue.
          </p>
        </header>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
            <StatCard
              icon={Package}
              label="Parts in Catalog"
              value={formatInt(stats.total_parts)}
              detail={stats.branches.length > 0 ? `${stats.branches.length} branch${stats.branches.length === 1 ? "" : "es"}` : ""}
            />
            <StatCard
              icon={Layers}
              label="Vendor Prices Tracked"
              value={formatInt(stats.total_vendor_prices)}
            />
            <StatCard
              icon={AlertTriangle}
              label="Unresolved Conflicts"
              value={formatInt(stats.unresolved_conflicts)}
              tone={stats.high_priority_conflicts > 0 ? "warning" : "neutral"}
              detail={stats.high_priority_conflicts > 0 ? `${stats.high_priority_conflicts} high priority` : "all clear"}
              link={stats.unresolved_conflicts > 0 ? "/parts/companion/import/conflicts" : undefined}
            />
            <StatCard
              icon={Clock}
              label="Last PARTMAST Import"
              value={relativeTime(stats.last_partmast_import)}
              detail={stats.last_partmast_import ? new Date(stats.last_partmast_import).toLocaleDateString() : "Never"}
            />
          </div>
        )}

        {/* Upload zone */}
        {(phase === "idle" || phase === "error") && (
          <section
            className="rounded-2xl p-6 md:p-10 mb-8"
            style={{
              background: T.card,
              border: `1px solid ${dragOver ? T.orange : T.border}`,
              boxShadow: dragOver ? `0 0 0 4px ${T.orangeGlow}` : "none",
              transition: "border-color 150ms, box-shadow 150ms",
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="text-center py-8">
              <div
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
                style={{ background: T.orangeGlow }}
              >
                <Upload size={28} color={T.orange} />
              </div>
              <h2 className="text-xl md:text-2xl font-semibold mb-2">
                Drop a file to begin
              </h2>
              <p className="text-sm mb-6" style={{ color: T.textMuted }}>
                Accepts .xlsx · PARTMAST export, vendor price catalog, or vendor contacts
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFileSelected(f);
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all"
                style={{
                  background: `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`,
                  color: "#fff",
                  boxShadow: `0 6px 16px ${T.orangeDeep}`,
                }}
              >
                <Upload size={16} />
                Select file
              </button>

              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                <HintChip
                  label="Auto-detect"
                  selected={fileTypeHint === undefined}
                  onClick={() => setFileTypeHint(undefined)}
                />
                <HintChip
                  label="PARTMAST"
                  selected={fileTypeHint === "partmast"}
                  onClick={() => setFileTypeHint("partmast")}
                />
                <HintChip
                  label="Vendor Price"
                  selected={fileTypeHint === "vendor_price"}
                  onClick={() => setFileTypeHint("vendor_price")}
                />
                <HintChip
                  label="Vendor Contacts"
                  selected={fileTypeHint === "vendor_contacts"}
                  onClick={() => setFileTypeHint("vendor_contacts")}
                />
              </div>
            </div>

            {errorMsg && (
              <div
                className="mt-4 p-3 rounded-lg flex items-start gap-2"
                style={{ background: T.dangerBg, border: `1px solid ${T.danger}` }}
              >
                <XCircle size={16} color={T.danger} className="mt-0.5 flex-shrink-0" />
                <div className="text-sm" style={{ color: T.danger }}>{errorMsg}</div>
              </div>
            )}
          </section>
        )}

        {/* Uploading / previewing */}
        {(phase === "uploading" || phase === "previewing") && (
          <section
            className="rounded-2xl p-8 mb-8 text-center"
            style={{ background: T.card, border: `1px solid ${T.border}` }}
          >
            <div
              className="w-10 h-10 border-3 rounded-full animate-spin mx-auto mb-4"
              style={{
                borderColor: T.border,
                borderTopColor: T.orange,
              }}
            />
            <div className="text-lg font-medium mb-1">
              {phase === "uploading" ? "Uploading file…" : "Analyzing import…"}
            </div>
            <div className="text-sm" style={{ color: T.textMuted }}>
              {phase === "uploading"
                ? "Staging your file in secure storage"
                : "Comparing against current catalog · detecting conflicts · building preview"}
            </div>
          </section>
        )}

        {/* Preview */}
        {(phase === "preview_ready" || phase === "committing" || phase === "done") && preview && (
          <PreviewPanel
            preview={preview}
            phase={phase}
            onCommit={onCommit}
            onCancel={onCancel}
            onReset={resetFlow}
          />
        )}

        {/* Recent runs */}
        {stats && stats.recent_runs.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-3">Recent imports</h2>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: T.card, border: `1px solid ${T.border}` }}
            >
              {stats.recent_runs.map((r, idx) => {
                const Icon = fileTypeIcon(r.file_type);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 px-4 md:px-5 py-3.5"
                    style={{
                      borderTop: idx === 0 ? "none" : `1px solid ${T.borderSoft}`,
                    }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: T.bgElevated }}
                    >
                      <Icon size={16} color={T.textMuted} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.file_name}</div>
                      <div className="text-xs flex flex-wrap gap-x-3" style={{ color: T.textDim }}>
                        <span>{fileTypeLabel(r.file_type)}</span>
                        <span>·</span>
                        <span>{formatInt(r.row_count)} rows</span>
                        {r.rows_conflicted > 0 && (
                          <>
                            <span>·</span>
                            <span style={{ color: T.warning }}>{r.rows_conflicted} conflicts</span>
                          </>
                        )}
                        <span>·</span>
                        <span>{relativeTime(r.started_at)}</span>
                      </div>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── subcomponents ──────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
  link,
}: {
  icon: typeof Package;
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "warning";
  link?: string;
}) {
  const toneBg = tone === "warning" ? T.warningBg : T.orangeGlow;
  const toneFg = tone === "warning" ? T.warning : T.orange;
  const inner = (
    <div
      className="rounded-2xl p-4 md:p-5 transition-all"
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: toneBg }}
        >
          <Icon size={14} color={toneFg} />
        </div>
        <div className="text-xs uppercase tracking-wide font-medium" style={{ color: T.textMuted }}>
          {label}
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {detail && (
        <div className="text-xs mt-1" style={{ color: T.textDim }}>
          {detail}
        </div>
      )}
    </div>
  );
  if (link) {
    return <Link to={link} className="block hover:scale-[1.01] transition-transform">{inner}</Link>;
  }
  return inner;
}

function HintChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
      style={{
        background: selected ? T.orangeGlow : T.bgElevated,
        color: selected ? T.orange : T.textMuted,
        border: `1px solid ${selected ? T.orange : T.border}`,
      }}
    >
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: ImportStatus }) {
  const color = statusColor(status);
  const bg =
    status === "committed" ? T.successBg :
    status === "failed" || status === "rolled_back" ? T.dangerBg :
    status === "awaiting_conflicts" ? T.warningBg :
    T.infoBg;
  return (
    <div
      className="text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {status.replace(/_/g, " ")}
    </div>
  );
}

function PreviewPanel({
  preview,
  phase,
  onCommit,
  onCancel,
  onReset,
}: {
  preview: PreviewState;
  phase: Phase;
  onCommit: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const { stats, file_type, file_name, file_size, status } = preview;
  const Icon = fileTypeIcon(file_type);
  const hasConflicts = stats.rows_conflicted > 0;
  const hasErrors = stats.rows_errored > 0;

  return (
    <section
      className="rounded-2xl p-6 md:p-7 mb-8"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: T.orangeGlow }}
        >
          <Icon size={22} color={T.orange} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg md:text-xl font-semibold truncate">{file_name}</h2>
            <StatusPill status={status} />
          </div>
          <div className="text-xs mt-1" style={{ color: T.textMuted }}>
            {fileTypeLabel(file_type)} · {formatFileSize(file_size)} · {formatInt(stats.rows_scanned)} rows scanned
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-6">
        <DiffStat label="Insert" value={stats.rows_to_insert} color={T.success} bg={T.successBg} />
        <DiffStat label="Update" value={stats.rows_to_update} color={T.info} bg={T.infoBg} />
        <DiffStat label="Unchanged" value={stats.rows_unchanged} color={T.textMuted} bg={T.borderSoft} />
        <DiffStat label="Conflicts" value={stats.rows_conflicted} color={T.warning} bg={T.warningBg} emphasized={hasConflicts} />
        <DiffStat label="Errors" value={stats.rows_errored} color={T.danger} bg={T.dangerBg} emphasized={hasErrors} />
      </div>

      {/* Sample inserts */}
      {stats.sample_inserts.length > 0 && (
        <SampleSection title={`Sample of ${stats.rows_to_insert} new rows`} rows={stats.sample_inserts} />
      )}

      {/* Sample updates */}
      {stats.sample_updates.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold mb-2" style={{ color: T.textMuted }}>
            Sample of changed rows
          </h3>
          <div className="space-y-2">
            {stats.sample_updates.slice(0, 4).map((u, i) => (
              <div
                key={i}
                className="rounded-lg p-3 text-xs"
                style={{ background: T.bgElevated, border: `1px solid ${T.borderSoft}` }}
              >
                <div className="font-mono mb-1" style={{ color: T.text }}>{u.key}</div>
                <div className="flex flex-wrap gap-2">
                  {u.changed_fields.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 rounded"
                      style={{ background: T.infoBg, color: T.info }}
                    >
                      {f}: {JSON.stringify(u.before[f])} → {JSON.stringify(u.after[f])}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conflicts banner */}
      {hasConflicts && (
        <div
          className="mt-5 p-4 rounded-xl flex items-start gap-3"
          style={{ background: T.warningBg, border: `1px solid ${T.warning}` }}
        >
          <AlertTriangle size={18} color={T.warning} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium" style={{ color: T.warning }}>
              {stats.rows_conflicted} conflicts need review before commit
            </div>
            <div className="text-xs mt-0.5" style={{ color: T.textMuted }}>
              A parts manager has manually edited fields that this import would change.
            </div>
          </div>
          <Link
            to={`/parts/companion/import/conflicts/${preview.run_id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap"
            style={{ background: T.warning, color: "#1a1200" }}
          >
            Review
            <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* Errors */}
      {hasErrors && stats.errors.length > 0 && (
        <div
          className="mt-4 p-3 rounded-xl"
          style={{ background: T.dangerBg, border: `1px solid ${T.danger}` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={14} color={T.danger} />
            <div className="text-sm font-medium" style={{ color: T.danger }}>
              {stats.rows_errored} error{stats.rows_errored === 1 ? "" : "s"}
            </div>
          </div>
          <div className="space-y-0.5 text-xs" style={{ color: T.textMuted }}>
            {stats.errors.slice(0, 5).map((e, i) => (
              <div key={i}>
                row {e.row}{e.part_number ? ` · ${e.part_number}` : ""}: {e.reason}
              </div>
            ))}
            {stats.errors.length > 5 && <div>…and {stats.errors.length - 5} more</div>}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-6 items-center justify-between">
        <div className="text-xs flex items-center gap-1.5" style={{ color: T.textDim }}>
          <Info size={12} />
          Commit inserts + updates in batched transactions. Rollback available from history.
        </div>
        <div className="flex gap-2">
          {phase === "done" ? (
            <button
              onClick={onReset}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: T.orangeGlow, color: T.orange, border: `1px solid ${T.orange}` }}
            >
              Import another file
            </button>
          ) : (
            <>
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: T.bgElevated, color: T.textMuted, border: `1px solid ${T.border}` }}
              >
                Cancel
              </button>
              <button
                onClick={onCommit}
                disabled={phase === "committing" || status === "awaiting_conflicts"}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{
                  background: phase === "committing" ? T.bgElevated : `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`,
                  color: "#fff",
                  boxShadow: phase === "committing" ? "none" : `0 4px 12px ${T.orangeDeep}`,
                }}
              >
                {phase === "committing" ? (
                  <>
                    <div
                      className="w-3.5 h-3.5 border-2 rounded-full animate-spin"
                      style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }}
                    />
                    Committing…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    {status === "awaiting_conflicts" ? "Resolve conflicts first" : "Commit import"}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function DiffStat({
  label,
  value,
  color,
  bg,
  emphasized = false,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: bg,
        border: `1px solid ${emphasized ? color : "transparent"}`,
      }}
    >
      <div className="text-2xl font-bold" style={{ color }}>{formatInt(value)}</div>
      <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: T.textMuted }}>
        {label}
      </div>
    </div>
  );
}

function SampleSection({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2" style={{ color: T.textMuted }}>{title}</h3>
      <div
        className="rounded-xl overflow-x-auto"
        style={{ background: T.bgElevated, border: `1px solid ${T.borderSoft}` }}
      >
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: T.borderSoft }}>
              {Object.keys(rows[0] ?? {}).map((k) => (
                <th
                  key={k}
                  className="text-left px-3 py-2 font-medium"
                  style={{ color: T.textMuted }}
                >
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                style={{ borderTop: `1px solid ${T.borderSoft}` }}
              >
                {Object.values(row).map((v, j) => (
                  <td key={j} className="px-3 py-2 font-mono" style={{ color: T.text }}>
                    {v == null ? "—" : String(v).slice(0, 60)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
