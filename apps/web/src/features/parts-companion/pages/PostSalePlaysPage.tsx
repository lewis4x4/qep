/**
 * PostSalePlaysPage — Slice 3.6.
 *
 * Parts Companion page that shows Claude-generated 30/60/90-day parts
 * maintenance plans for every closed-won deal-on-equipment. Rep reviews,
 * tweaks, marks reviewed/sent/accepted.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, RefreshCw, DollarSign, Package, Send, CheckCircle2,
  ArrowRight, Clock, Calendar, X, Loader2, Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  fetchPlaybookSummary, fetchEligibleDeals, generateBatch, generatePlaybook,
  fetchPlaybook, updatePlaybookStatus,
  type PlaybookSummary, type EligibleDeal, type PlaybookRow, type PlaybookPayload,
} from "../lib/post-sale-api";

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  cardHover: "#182A44",
  border: "#1F3254",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  info: "#3B82F6",
  infoBg: "rgba(59,130,246,0.12)",
  purple: "#A855F7",
  purpleBg: "rgba(168,85,247,0.14)",
} as const;

const STATUS_BADGE: Record<PlaybookRow["status"], { label: string; bg: string; color: string }> = {
  draft:     { label: "Draft",     bg: T.info + "22",    color: T.info },
  reviewed:  { label: "Reviewed",  bg: T.purpleBg,       color: T.purple },
  sent:      { label: "Sent",      bg: T.orangeGlow,     color: T.orange },
  accepted:  { label: "Accepted",  bg: T.successBg,      color: T.success },
  dismissed: { label: "Dismissed", bg: "rgba(239,68,68,0.10)", color: "#EF4444" },
  expired:   { label: "Expired",   bg: "rgba(138,155,180,0.10)", color: T.textMuted },
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export function PostSalePlaysPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summaryQ = useQuery<PlaybookSummary>({
    queryKey: ["parts", "post-sale", "summary"],
    queryFn: fetchPlaybookSummary,
    refetchInterval: 60_000,
  });

  const eligibleQ = useQuery<EligibleDeal[]>({
    queryKey: ["parts", "post-sale", "eligible"],
    queryFn: () => fetchEligibleDeals(15),
    refetchInterval: 120_000,
  });

  const batchMut = useMutation({
    mutationFn: () => generateBatch(5),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts", "post-sale"] });
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["parts", "post-sale"] });

  const counts = summaryQ.data?.counts ?? {};
  const openRevenue = summaryQ.data?.open_revenue_usd ?? 0;
  const recent = summaryQ.data?.recent ?? [];
  const eligible = eligibleQ.data ?? [];

  return (
    <div className="min-h-screen" style={{ background: T.bg, color: T.text }}>
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: T.orange }}>
              Post-Sale Playbooks
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Parts maintenance plans for new & used equipment sold
            </h1>
            <p className="mt-1 text-sm" style={{ color: T.textMuted }}>
              Claude Sonnet 4.6 drafts 30/60/90-day parts plans for every closed-won deal.
              Review, tweak, send to customer.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => batchMut.mutate()}
              disabled={batchMut.isPending || eligible.length === 0}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition disabled:opacity-50"
              style={{
                background: T.orange,
                color: "#fff",
                boxShadow: `0 8px 24px ${T.orangeGlow}`,
              }}
            >
              {batchMut.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              Generate for {Math.min(5, eligible.length)} eligible
            </button>
            {batchMut.isError && (
              <span className="text-[11px]" style={{ color: "#EF4444" }}>
                {(batchMut.error as Error).message}
              </span>
            )}
          </div>
        </header>

        {/* Summary cards */}
        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Open revenue forecast"
            value={fmtUsd(openRevenue)}
            subline={`Across draft/reviewed/sent`}
            icon={DollarSign}
            tone="good"
          />
          <SummaryCard
            label="Drafts awaiting review"
            value={String(counts.draft ?? 0)}
            subline={`${counts.reviewed ?? 0} reviewed · ${counts.sent ?? 0} sent`}
            icon={Package}
          />
          <SummaryCard
            label="Customer accepted"
            value={String(counts.accepted ?? 0)}
            subline="Revenue booked to parts pipeline"
            icon={CheckCircle2}
            tone="good"
          />
          <SummaryCard
            label="Eligible deals (no playbook yet)"
            value={String(eligible.length)}
            subline={eligible.length > 0 ? "Click generate above" : "You're all caught up"}
            icon={Calendar}
            tone={eligible.length > 0 ? "warning" : "neutral"}
          />
        </section>

        {/* Recent */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: T.textMuted }}>
            Recent playbooks
          </h2>
          {summaryQ.isLoading && <p className="text-sm" style={{ color: T.textMuted }}>Loading…</p>}
          {summaryQ.isError && (
            <p className="text-sm" style={{ color: "#EF4444" }}>
              {(summaryQ.error as Error).message}
            </p>
          )}
          {!summaryQ.isLoading && recent.length === 0 && (
            <div
              className="rounded-xl p-6 text-center"
              style={{ background: T.card, border: `1px dashed ${T.border}` }}
            >
              <Wrench className="mx-auto mb-2" size={28} style={{ color: T.textDim }} />
              <p className="text-sm" style={{ color: T.textMuted }}>
                No playbooks yet. Close a deal on equipment, then click
                "Generate" above.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recent.map((p) => (
              <PlaybookCard key={p.id} row={p} onOpen={() => setSelectedId(p.id)} />
            ))}
          </div>
        </section>
      </div>

      {selectedId && (
        <PlaybookDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChange={invalidate}
        />
      )}
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────

type Tone = "neutral" | "good" | "warning" | "critical";

function SummaryCard({
  label, value, subline, icon: Icon, tone = "neutral",
}: {
  label: string; value: string; subline: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  const ring =
    tone === "good" ? "rgba(34,197,94,0.25)" :
    tone === "warning" ? "rgba(245,158,11,0.30)" :
    tone === "critical" ? "rgba(239,68,68,0.35)" :
    T.border;
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: `linear-gradient(180deg, ${T.card}, ${T.bg})`,
        border: `1px solid ${ring}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
          {label}
        </p>
        <Icon size={14} style={{ color: T.orange }} />
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs" style={{ color: T.textDim }}>{subline}</p>
    </div>
  );
}

function PlaybookCard({ row, onOpen }: { row: PlaybookRow; onOpen: () => void }) {
  const badge = STATUS_BADGE[row.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-2xl p-4 transition-all"
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = T.orange)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = T.border)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: T.textMuted }}>
            {row.company_name ?? "(no company)"}
          </p>
          <p className="mt-1 font-semibold" style={{ color: T.text }}>
            {row.year ? `${row.year} ` : ""}
            {row.make ?? "Equipment"} {row.model ?? ""}
          </p>
          <p className="text-xs" style={{ color: T.textDim }}>
            {row.deal_name ?? "(unnamed deal)"} · rep {row.rep_name ?? "unassigned"}
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ background: badge.bg, color: badge.color }}
        >
          {badge.label}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: T.textDim }}>
            Forecast revenue
          </p>
          <p className="text-xl font-semibold tabular-nums" style={{ color: T.orange }}>
            {fmtUsd(row.total_revenue)}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }}>
          Open <ArrowRight size={12} />
        </span>
      </div>
    </button>
  );
}

// ── Detail drawer ─────────────────────────────────────────

function PlaybookDrawer({
  id, onClose, onChange,
}: { id: string; onClose: () => void; onChange: () => void }) {
  const q = useQuery({
    queryKey: ["parts", "post-sale", "detail", id],
    queryFn: () => fetchPlaybook(id),
  });
  const [busy, setBusy] = useState(false);

  async function handleStatus(nextStatus: PlaybookRow["status"]) {
    setBusy(true);
    try {
      await updatePlaybookStatus(id, nextStatus);
      onChange();
      await q.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function handleRegen() {
    if (!q.data) return;
    setBusy(true);
    try {
      await generatePlaybook(q.data.deal_id, q.data.equipment_id ?? "", true);
      onChange();
      await q.refetch();
    } finally {
      setBusy(false);
    }
  }

  const payload = q.data?.payload as PlaybookPayload | undefined;
  const status = (q.data?.status as PlaybookRow["status"]) ?? "draft";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(5,10,20,0.72)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[720px] max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{
          background: `linear-gradient(180deg, ${T.card}, ${T.bg})`,
          border: `1px solid ${T.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
          style={{ background: T.card, borderBottom: `1px solid ${T.border}` }}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: T.orange }}>
              Post-Sale Playbook
            </p>
            <h2 className="text-base font-semibold mt-0.5">
              {payload?.customer_name ?? "Playbook"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ background: STATUS_BADGE[status].bg, color: STATUS_BADGE[status].color }}
            >
              {STATUS_BADGE[status].label}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg"
              style={{ background: T.bgElevated, color: T.textMuted }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {q.isLoading && <p className="text-sm" style={{ color: T.textMuted }}>Loading…</p>}
          {q.isError && (
            <p className="text-sm" style={{ color: "#EF4444" }}>
              {(q.error as Error).message}
            </p>
          )}

          {payload && (
            <>
              {/* Grand total + assumptions */}
              <div
                className="rounded-xl p-4 flex items-end justify-between"
                style={{ background: T.orangeGlow, border: `1px solid rgba(232,119,34,0.35)` }}
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: T.orange }}>
                    Total forecast revenue
                  </p>
                  <p className="text-3xl font-semibold tabular-nums mt-1">
                    {fmtUsd(payload.grand_total_revenue)}
                  </p>
                </div>
                <div className="text-right text-xs" style={{ color: T.textMuted }}>
                  {Object.entries(payload.assumptions ?? {}).slice(0, 3).map(([k, v]) => (
                    <p key={k}>{k}: <span style={{ color: T.text }}>{String(v)}</span></p>
                  ))}
                </div>
              </div>

              {/* Windows */}
              <div className="space-y-3">
                {payload.windows.map((w) => (
                  <div
                    key={w.window}
                    className="rounded-xl"
                    style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
                  >
                    <div
                      className="px-4 py-3 flex items-center justify-between"
                      style={{ borderBottom: `1px solid ${T.border}` }}
                    >
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: T.orange }}>
                          {w.window} · {w.service_description}
                        </p>
                        <p className="text-sm mt-1" style={{ color: T.text }}>{w.narrative}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                        {fmtUsd(w.total_revenue)}
                      </span>
                    </div>
                    <div className="px-4 py-3">
                      {w.parts.length === 0 ? (
                        <p className="text-xs" style={{ color: T.textDim }}>
                          No catalog-grounded parts for this window.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {w.parts.map((p) => (
                            <li key={p.part_number} className="flex items-start justify-between gap-3 text-sm">
                              <div className="min-w-0 flex-1">
                                <p className="font-mono font-semibold" style={{ color: T.orange }}>
                                  {p.part_number}
                                </p>
                                <p style={{ color: T.text }}>{p.description}</p>
                                <p className="text-xs mt-0.5" style={{ color: T.textDim }}>
                                  {p.reason}
                                </p>
                              </div>
                              <div className="text-right whitespace-nowrap">
                                <p className="tabular-nums" style={{ color: T.text }}>
                                  {p.qty}× ${p.unit_price.toFixed(2)}
                                </p>
                                <p className="text-xs tabular-nums" style={{ color: T.textMuted }}>
                                  on hand {p.on_hand} · {Math.round(p.probability * 100)}%
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Status actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                {status === "draft" && (
                  <>
                    <ActionButton label="Mark reviewed" icon={CheckCircle2} onClick={() => handleStatus("reviewed")} busy={busy} />
                    <ActionButton label="Dismiss" icon={X} onClick={() => handleStatus("dismissed")} busy={busy} tone="danger" />
                  </>
                )}
                {status === "reviewed" && (
                  <>
                    <ActionButton label="Mark sent to customer" icon={Send} onClick={() => handleStatus("sent")} busy={busy} tone="primary" />
                    <ActionButton label="Back to draft" icon={Clock} onClick={() => handleStatus("draft")} busy={busy} />
                  </>
                )}
                {status === "sent" && (
                  <>
                    <ActionButton label="Customer accepted" icon={CheckCircle2} onClick={() => handleStatus("accepted")} busy={busy} tone="success" />
                    <ActionButton label="Dismiss" icon={X} onClick={() => handleStatus("dismissed")} busy={busy} tone="danger" />
                  </>
                )}
                <ActionButton label="Regenerate" icon={RefreshCw} onClick={handleRegen} busy={busy} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  label, icon: Icon, onClick, busy, tone,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  busy: boolean;
  tone?: "primary" | "success" | "danger";
}) {
  const bg =
    tone === "primary" ? T.orange
    : tone === "success" ? T.success
    : tone === "danger" ? "rgba(239,68,68,0.9)"
    : T.bgElevated;
  const color = tone ? "#fff" : T.text;
  const border = tone ? "transparent" : T.border;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition disabled:opacity-50"
      style={{ background: bg, color, border: `1px solid ${border}` }}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {label}
    </button>
  );
}
