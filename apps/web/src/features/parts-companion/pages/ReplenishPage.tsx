import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingCart,
  Check,
  X,
  Package,
  Calendar,
  AlertTriangle,
  Rocket,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Sparkles,
  Edit2,
  User,
  Truck,
  Info,
} from "lucide-react";
import {
  approveRows,
  fetchReplenishRows,
  fetchReplenishSummary,
  markOrdered,
  rejectRows,
  updateQty,
  type ReplenishRow,
  type ReplenishSummary,
} from "../lib/replenish-api";

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
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

function fmtCurrency(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}
function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function statusStyle(s: ReplenishRow["status"]) {
  switch (s) {
    case "pending":       return { bg: T.warningBg, fg: T.warning, label: "Pending" };
    case "scheduled":     return { bg: T.infoBg,    fg: T.info,    label: "Scheduled" };
    case "auto_approved": return { bg: T.purpleBg,  fg: T.purple,  label: "Auto-approved" };
    case "approved":      return { bg: T.successBg, fg: T.success, label: "Approved" };
    case "ordered":       return { bg: T.successBg, fg: T.success, label: "Ordered" };
    case "rejected":      return { bg: T.dangerBg,  fg: T.danger,  label: "Rejected" };
    default:              return { bg: T.borderSoft, fg: T.textMuted, label: s };
  }
}

export function ReplenishPage() {
  const queryClient = useQueryClient();
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [poRefModal, setPoRefModal] = useState<{ ids: string[] } | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery<ReplenishSummary>({
    queryKey: ["replenish-summary"],
    queryFn: fetchReplenishSummary,
    refetchInterval: 30000,
  });

  const { data: rows = [], isLoading: rowsLoading } = useQuery<ReplenishRow[]>({
    queryKey: ["replenish-rows"],
    queryFn: () => fetchReplenishRows({}),
    refetchInterval: 30000,
  });

  // Group rows by vendor
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; vendor_name: string; rows: ReplenishRow[] }>();
    for (const r of rows) {
      const key = r.selected_vendor_id ?? "__no_vendor__";
      const label = r.vendor_name ?? "No vendor selected";
      const entry = map.get(key) ?? { key, vendor_name: label, rows: [] };
      entry.rows.push(r);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aTotal = a.rows.reduce((s, r) => s + (r.estimated_total ?? 0), 0);
      const bTotal = b.rows.reduce((s, r) => s + (r.estimated_total ?? 0), 0);
      return bTotal - aTotal;
    });
  }, [rows]);

  const toggleVendor = (key: string) => {
    setExpandedVendors((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelectedRows((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInVendor = (vendorKey: string) => {
    const group = grouped.find((g) => g.key === vendorKey);
    if (!group) return;
    const allIds = group.rows.map((r) => r.id);
    const allSelected = allIds.every((id) => selectedRows.has(id));
    setSelectedRows((p) => {
      const next = new Set(p);
      if (allSelected) allIds.forEach((id) => next.delete(id));
      else allIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const handleApprove = async () => {
    if (selectedRows.size === 0) return;
    try {
      const r = await approveRows(Array.from(selectedRows));
      showToast("success", `Approved ${r.approved_count} draft${r.approved_count === 1 ? "" : "s"}`);
      setSelectedRows(new Set());
      await queryClient.invalidateQueries({ queryKey: ["replenish-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["replenish-rows"] });
    } catch (err) {
      showToast("error", `Failed: ${(err as Error).message}`);
    }
  };

  const handleReject = async () => {
    if (selectedRows.size === 0) return;
    const reason = window.prompt("Rejection reason (optional):") ?? undefined;
    try {
      const r = await rejectRows(Array.from(selectedRows), reason);
      showToast("info", `Rejected ${r.rejected_count} draft${r.rejected_count === 1 ? "" : "s"}`);
      setSelectedRows(new Set());
      await queryClient.invalidateQueries({ queryKey: ["replenish-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["replenish-rows"] });
    } catch (err) {
      showToast("error", `Failed: ${(err as Error).message}`);
    }
  };

  const handleMarkOrdered = () => {
    if (selectedRows.size === 0) return;
    setPoRefModal({ ids: Array.from(selectedRows) });
  };

  const confirmMarkOrdered = async (poRef: string) => {
    if (!poRefModal) return;
    try {
      const r = await markOrdered(poRefModal.ids, poRef);
      showToast("success", `Marked ${r.ordered_count} row${r.ordered_count === 1 ? "" : "s"} ordered · PO ${poRef || "—"}`);
      setSelectedRows(new Set());
      setPoRefModal(null);
      await queryClient.invalidateQueries({ queryKey: ["replenish-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["replenish-rows"] });
      await queryClient.invalidateQueries({ queryKey: ["predictive-plays"] });
    } catch (err) {
      showToast("error", `Failed: ${(err as Error).message}`);
    }
  };

  const handleEditQty = async (row: ReplenishRow) => {
    const next = window.prompt(`New quantity for ${row.part_number} (current ${row.recommended_qty}):`, String(row.recommended_qty));
    if (!next || isNaN(+next) || +next <= 0) return;
    try {
      const r = await updateQty(row.id, +next);
      showToast("success", `Updated to ${r.new_qty} × ${fmtCurrency(row.estimated_unit_cost, 2)} = ${fmtCurrency(r.new_total, 2)}`);
      await queryClient.invalidateQueries({ queryKey: ["replenish-rows"] });
    } catch (err) {
      showToast("error", `Failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="flex-1 overflow-auto px-4 md:px-10 py-8" style={{ background: T.bg, color: T.text }}>
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(232,119,34,0.18) 0%, rgba(59,130,246,0.18) 100%)",
                  boxShadow: "0 0 28px rgba(59,130,246,0.22)",
                }}
              >
                <ShoppingCart size={22} color={T.info} />
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Replenish Queue
              </h1>
            </div>
            <p className="text-sm md:text-base max-w-2xl" style={{ color: T.textMuted }}>
              Draft POs from the auto-replenish engine and predictive plays.
              Group by vendor, review, approve, then mark ordered. Predictive-play
              drafts carry the customer + machine context that created them.
            </p>
          </div>
          {selectedRows.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: T.textMuted }}>
                {selectedRows.size} selected
              </span>
              <button
                onClick={handleReject}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: T.bgElevated, color: T.textMuted, border: `1px solid ${T.border}` }}
              >
                <X size={11} className="inline mr-1" /> Reject
              </button>
              <button
                onClick={handleApprove}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: T.successBg, color: T.success, border: `1px solid ${T.success}` }}
              >
                <Check size={11} className="inline mr-1" /> Approve
              </button>
              <button
                onClick={handleMarkOrdered}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`, color: "#fff" }}
              >
                <ShoppingCart size={11} className="inline mr-1" /> Mark ordered
              </button>
            </div>
          )}
        </header>

        {toast && (
          <div
            className="fixed top-6 left-1/2 -translate-x-1/2 z-40 rounded-xl px-4 py-3 flex items-center gap-2 text-sm shadow-xl"
            style={{
              background: toast.type === "success" ? T.successBg : toast.type === "error" ? T.dangerBg : T.infoBg,
              color: toast.type === "success" ? T.success : toast.type === "error" ? T.danger : T.info,
              border: `1px solid ${toast.type === "success" ? T.success : toast.type === "error" ? T.danger : T.info}`,
              maxWidth: 520,
            }}
          >
            {toast.type === "success" ? <Check size={14} /> : toast.type === "error" ? <X size={14} /> : <Info size={14} />}
            {toast.message}
          </div>
        )}

        {/* KPIs */}
        {summary?.kpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <Kpi icon={Calendar} label="Pending" value={fmtInt(summary.kpis.pending)} tone="warning" />
            <Kpi icon={Calendar} label="Scheduled" value={fmtInt(summary.kpis.scheduled)} tone="info" />
            <Kpi icon={Sparkles} label="Auto-approved" value={fmtInt(summary.kpis.auto_approved)} tone="info" />
            <Kpi icon={Check} label="Approved" value={fmtInt(summary.kpis.approved)} tone="success" />
            <Kpi icon={Rocket} label="From Plays" value={fmtInt(summary.kpis.from_predictive)} tone="info" detail="Predictive-originated" />
            <Kpi icon={TrendingDown} label="Overpay Flags" value={fmtInt(summary.kpis.overpay_flags)} tone={summary.kpis.overpay_flags > 0 ? "danger" : "neutral"} />
            <Kpi icon={DollarSign} label="Draft Value" value={fmtCurrency(summary.kpis.total_draft_value)} tone="success" detail="Across all drafts" />
          </div>
        )}

        {(rowsLoading || summaryLoading) && (
          <LoadingCard />
        )}

        {!rowsLoading && rows.length === 0 && (
          <EmptyCard />
        )}

        {/* Vendor groups */}
        <div className="space-y-4">
          {grouped.map((group) => {
            const isExpanded = expandedVendors.has(group.key);
            const vendorTotal = group.rows.reduce((s, r) => s + (r.estimated_total ?? 0), 0);
            const vendorOverpays = group.rows.filter((r) => r.potential_overpay_flag).length;
            const vendorPlayItems = group.rows.filter((r) => r.source_type === "predictive_play").length;
            const allSelected = group.rows.every((r) => selectedRows.has(r.id));
            const someSelected = group.rows.some((r) => selectedRows.has(r.id));

            return (
              <section
                key={group.key}
                className="rounded-2xl overflow-hidden"
                style={{ background: T.card, border: `1px solid ${T.border}` }}
              >
                <button
                  onClick={() => toggleVendor(group.key)}
                  className="w-full px-5 py-4 flex items-center gap-3 text-left"
                  style={{ borderBottom: isExpanded ? `1px solid ${T.borderSoft}` : "none" }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: T.orangeGlow }}
                  >
                    <Truck size={16} color={T.orange} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-base">{group.vendor_name}</div>
                    <div className="text-xs flex flex-wrap gap-x-3" style={{ color: T.textDim }}>
                      <span>{group.rows.length} item{group.rows.length === 1 ? "" : "s"}</span>
                      {vendorPlayItems > 0 && (
                        <>
                          <span>·</span>
                          <span style={{ color: T.purple }}>{vendorPlayItems} from play{vendorPlayItems === 1 ? "" : "s"}</span>
                        </>
                      )}
                      {vendorOverpays > 0 && (
                        <>
                          <span>·</span>
                          <span style={{ color: T.warning }}>⚠ {vendorOverpays} overpay flag{vendorOverpays === 1 ? "" : "s"}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold" style={{ color: T.success }}>
                      {fmtCurrency(vendorTotal)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide" style={{ color: T.textMuted }}>
                      draft value
                    </div>
                  </div>
                  {isExpanded ? <ChevronDown size={16} color={T.textMuted} /> : <ChevronRight size={16} color={T.textMuted} />}
                </button>

                {isExpanded && (
                  <>
                    <div
                      className="grid grid-cols-[28px_1fr_80px_90px_100px_110px_110px_100px] gap-3 px-5 py-2.5 text-[10px] uppercase tracking-wide font-medium"
                      style={{ background: T.bgElevated, color: T.textMuted, borderBottom: `1px solid ${T.borderSoft}` }}
                    >
                      <div>
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={() => selectAllInVendor(group.key)}
                        />
                      </div>
                      <div>Part</div>
                      <div className="text-right">Qty</div>
                      <div className="text-right">Unit $</div>
                      <div className="text-right">Total</div>
                      <div className="text-right">Schedule</div>
                      <div>Source</div>
                      <div className="text-right">Status</div>
                    </div>

                    {group.rows.map((r) => (
                      <QueueRow
                        key={r.id}
                        row={r}
                        selected={selectedRows.has(r.id)}
                        onToggle={() => toggleRow(r.id)}
                        onEditQty={() => handleEditQty(r)}
                      />
                    ))}
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {poRefModal && (
        <PoReferenceModal
          count={poRefModal.ids.length}
          onCancel={() => setPoRefModal(null)}
          onConfirm={confirmMarkOrdered}
        />
      )}
    </div>
  );
}

// ── QueueRow ───────────────────────────────────────────────

function QueueRow({
  row,
  selected,
  onToggle,
  onEditQty,
}: {
  row: ReplenishRow;
  selected: boolean;
  onToggle: () => void;
  onEditQty: () => void;
}) {
  const style = statusStyle(row.status);
  const isPlay = row.source_type === "predictive_play";
  return (
    <div
      className="grid grid-cols-[28px_1fr_80px_90px_100px_110px_110px_100px] gap-3 px-5 py-3 items-center"
      style={{
        background: selected ? T.infoBg : "transparent",
        borderTop: `1px solid ${T.borderSoft}`,
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </div>

      <div className="min-w-0 cursor-pointer" onClick={onToggle}>
        <div className="font-mono text-sm truncate">{row.part_number}</div>
        <div className="text-xs truncate" style={{ color: T.textDim }}>
          {row.part_description ?? "—"}
        </div>
        {isPlay && (
          <div className="text-[10px] mt-1 inline-flex items-center gap-1" style={{ color: T.purple }}>
            <Rocket size={9} />
            <span className="truncate">
              {row.customer_name} · {row.customer_machine_make} {row.customer_machine_model}
              {row.customer_machine_hours != null && ` (${row.customer_machine_hours}h)`}
            </span>
          </div>
        )}
        {row.potential_overpay_flag && (
          <div className="text-[10px] mt-1 inline-flex items-center gap-1" style={{ color: T.warning }}>
            <AlertTriangle size={9} />
            Overpay — vendor list is lower
          </div>
        )}
      </div>

      <div className="text-right text-sm font-mono flex items-center justify-end gap-1">
        {row.recommended_qty}
        {["pending", "scheduled", "auto_approved"].includes(row.status) && (
          <button onClick={onEditQty} className="opacity-40 hover:opacity-100 transition-opacity">
            <Edit2 size={10} />
          </button>
        )}
      </div>
      <div className="text-right text-sm font-mono">{fmtCurrency(row.estimated_unit_cost, 2)}</div>
      <div className="text-right text-sm font-mono font-semibold">{fmtCurrency(row.estimated_total, 2)}</div>
      <div className="text-right text-xs" style={{ color: T.textDim }}>
        {fmtDate(row.scheduled_for)}
      </div>
      <div className="text-xs flex items-center gap-1.5">
        {row.source_type === "predictive_play" && <Rocket size={10} color={T.purple} />}
        {row.source_type === "rop_triggered" && <Package size={10} color={T.textMuted} />}
        {row.source_type === "manual_entry" && <User size={10} color={T.textMuted} />}
        <span style={{ color: T.textMuted }}>
          {row.source_type === "predictive_play" ? "Play" : row.source_type === "rop_triggered" ? "ROP" : "Manual"}
        </span>
      </div>
      <div className="text-right">
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: style.bg, color: style.fg }}
        >
          {style.label}
        </span>
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────

function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof ShoppingCart;
  label: string;
  value: string;
  detail?: string;
  tone: "neutral" | "success" | "danger" | "warning" | "info";
}) {
  const toneMap = {
    neutral: { bg: T.borderSoft, fg: T.textMuted },
    success: { bg: T.successBg, fg: T.success },
    danger: { bg: T.dangerBg, fg: T.danger },
    warning: { bg: T.warningBg, fg: T.warning },
    info: { bg: T.infoBg, fg: T.info },
  } as const;
  const c = toneMap[tone];
  return (
    <div
      className="rounded-2xl p-3.5"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: c.bg }}>
          <Icon size={11} color={c.fg} />
        </div>
        <div className="text-[9px] uppercase tracking-wide font-medium" style={{ color: T.textMuted }}>
          {label}
        </div>
      </div>
      <div className="text-lg md:text-xl font-bold tracking-tight" style={{ color: c.fg }}>{value}</div>
      {detail && <div className="text-[9px] mt-0.5" style={{ color: T.textDim }}>{detail}</div>}
    </div>
  );
}

function LoadingCard() {
  return (
    <div
      className="rounded-2xl p-16 text-center"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div
        className="w-10 h-10 border-3 rounded-full animate-spin mx-auto mb-3"
        style={{ borderColor: T.border, borderTopColor: T.info }}
      />
      <div className="text-sm" style={{ color: T.textMuted }}>Loading queue…</div>
    </div>
  );
}

function EmptyCard() {
  return (
    <div
      className="rounded-2xl p-10 text-center"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
        style={{ background: T.successBg }}
      >
        <Check size={24} color={T.success} />
      </div>
      <div className="text-lg font-semibold mb-2">Queue is empty</div>
      <div className="text-sm max-w-md mx-auto" style={{ color: T.textMuted }}>
        No draft POs awaiting review. Either the auto-replenish engine hasn't run yet,
        or you've worked through the queue. Predictive-play drafts will appear here
        when sales reps click Queue PO.
      </div>
    </div>
  );
}

function PoReferenceModal({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: (poRef: string) => void;
}) {
  const [poRef, setPoRef] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-2xl p-6 w-full max-w-md"
        style={{ background: T.card, border: `1px solid ${T.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Mark {count} row{count === 1 ? "" : "s"} ordered</h2>
        <p className="text-sm mb-4" style={{ color: T.textMuted }}>
          Enter the actual PO number or reference. Predictive plays behind these rows will be
          marked fulfilled.
        </p>
        <input
          autoFocus
          value={poRef}
          onChange={(e) => setPoRef(e.target.value)}
          placeholder="e.g. PO-2026-00421"
          className="w-full px-3 py-2 rounded-lg outline-none font-mono mb-4"
          style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }}
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: T.bgElevated, color: T.textMuted, border: `1px solid ${T.border}` }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(poRef)}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`, color: "#fff" }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
