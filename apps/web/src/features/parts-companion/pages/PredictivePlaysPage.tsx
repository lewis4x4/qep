import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Rocket,
  Sparkles,
  Zap,
  Clock,
  Target,
  User as UserIcon,
  Truck,
  Package,
  ArrowRight,
  Check,
  X,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Timer,
  Flame,
} from "lucide-react";
import {
  actionPlay,
  fetchPredictivePlays,
  runAiPredictions,
  runPredictivePrediction,
  type PredictivePlay,
  type PredictivePlaysSummary,
} from "../lib/intelligence-api";

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

function formatInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function windowBadge(w: PredictivePlay["projection_window"]): { label: string; color: string; bg: string } {
  switch (w) {
    case "7d":  return { label: "within 7 days", color: T.danger, bg: T.dangerBg };
    case "14d": return { label: "within 2 weeks", color: T.warning, bg: T.warningBg };
    case "30d": return { label: "within 30 days", color: T.warning, bg: T.warningBg };
    case "60d": return { label: "within 60 days", color: T.info, bg: T.infoBg };
    default:    return { label: "within 90 days", color: T.textMuted, bg: T.borderSoft };
  }
}

function signalLabel(s: PredictivePlay["signal_type"]): string {
  return {
    hours_based_interval: "Service interval",
    date_based_schedule: "Scheduled date",
    common_wear_pattern: "Wear pattern",
    yoy_demand_spike: "Demand spike",
    manual_curation: "Curated",
    ai_inferred: "AI inferred",
  }[s];
}

export function PredictivePlaysPage() {
  const queryClient = useQueryClient();
  const [recomputing, setRecomputing] = useState(false);
  const [filter, setFilter] = useState<"all" | "7d" | "needs_order" | "pre_positioned">("all");
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "info" | "error"; message: string } | null>(null);

  const { data, isLoading, error } = useQuery<PredictivePlaysSummary>({
    queryKey: ["predictive-plays"],
    queryFn: fetchPredictivePlays,
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    const plays = data?.plays ?? [];
    if (filter === "all") return plays;
    if (filter === "7d") return plays.filter((p) => p.days_until_due <= 7);
    if (filter === "needs_order") {
      return plays.filter((p) => p.recommended_order_qty > (p.current_on_hand_across_branches ?? 0));
    }
    if (filter === "pre_positioned") {
      return plays.filter((p) => (p.current_on_hand_across_branches ?? 0) >= p.recommended_order_qty);
    }
    return plays;
  }, [data?.plays, filter]);

  const groupedByCustomer = useMemo(() => {
    const map = new Map<string, PredictivePlay[]>();
    for (const p of filtered) {
      const key = p.customer_name ?? "Unknown customer";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const [aiRunning, setAiRunning] = useState(false);

  const handleRecompute = async () => {
    setRecomputing(true);
    setRecomputeMsg(null);
    try {
      const r = await runPredictivePrediction(90);
      setRecomputeMsg(`Wrote ${r.plays_written} plays across ${r.machines_scanned} machines in ${r.elapsed_ms.toFixed(0)}ms`);
      await queryClient.invalidateQueries({ queryKey: ["predictive-plays"] });
    } catch (err) {
      setRecomputeMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setRecomputing(false);
    }
  };

  const handleAiPredict = async () => {
    setAiRunning(true);
    setRecomputeMsg("🧠 Asking Claude…");
    try {
      const r = await runAiPredictions(10);
      const cost = (r.cost_cents / 100).toFixed(3);
      setRecomputeMsg(
        `🧠 Claude wrote ${r.plays_written} AI-inferred plays across ${r.machines_processed} machines · ${r.plays_grounded}/${r.plays_proposed} grounded · $${cost} · ${(r.elapsed_ms / 1000).toFixed(1)}s`,
      );
      await queryClient.invalidateQueries({ queryKey: ["predictive-plays"] });
    } catch (err) {
      setRecomputeMsg(`AI prediction failed: ${(err as Error).message}`);
    } finally {
      setAiRunning(false);
    }
  };

  const handleAction = async (playId: string, action: "actioned" | "dismissed" | "fulfilled") => {
    try {
      const result = await actionPlay(playId, action);
      if (action === "actioned") {
        if (result.queue_action === "created") {
          setToast({ type: "success", message: "PO drafted — parts manager will see it in the replenish queue." });
        } else if (result.queue_action === "reused_existing") {
          setToast({ type: "info", message: "Existing draft PO reused — nothing duplicated." });
        } else {
          setToast({ type: "info", message: "Play marked actioned. No PO drafted (no recommended quantity)." });
        }
      } else if (action === "dismissed") {
        setToast({ type: "info", message: "Play dismissed." });
      }
      await queryClient.invalidateQueries({ queryKey: ["predictive-plays"] });
      setTimeout(() => setToast(null), 4500);
    } catch (err) {
      setToast({ type: "error", message: `Failed: ${(err as Error).message}` });
    }
  };

  return (
    <div className="flex-1 overflow-auto px-4 md:px-10 py-8" style={{ background: T.bg, color: T.text }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #E87722 0%, #A855F7 100%)",
                  boxShadow: "0 0 32px rgba(168,85,247,0.35)",
                }}
              >
                <Rocket size={22} color="#fff" />
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Predictive Plays
              </h1>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium uppercase tracking-wide"
                style={{
                  background: "linear-gradient(135deg, rgba(232,119,34,0.2) 0%, rgba(168,85,247,0.2) 100%)",
                  color: T.orange,
                  border: `1px solid ${T.orange}`,
                }}
              >
                Moonshot
              </span>
            </div>
            <p className="text-sm md:text-base max-w-2xl" style={{ color: T.textMuted }}>
              Every customer machine, projected forward. Every part they'll need, pre-positioned before they ask.
              Every order timed to the right vendor's ordering day. This is genuinely impossible without the full stack we just built.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleAiPredict}
              disabled={aiRunning || recomputing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium disabled:opacity-60"
              style={{
                background: aiRunning
                  ? T.bgElevated
                  : "linear-gradient(135deg, #7c3aed 0%, #c026d3 100%)",
                color: "#fff",
                boxShadow: aiRunning ? "none" : "0 6px 16px rgba(124,58,237,0.4)",
              }}
              title="Ask Claude to reason over each customer's machine + order history and propose AI-inferred parts plays"
            >
              {aiRunning ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Claude is thinking…
                </>
              ) : (
                <>
                  🧠
                  Ask Claude
                </>
              )}
            </button>
            <button
              onClick={handleRecompute}
              disabled={recomputing || aiRunning}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium disabled:opacity-60"
              style={{
                background: recomputing
                  ? T.bgElevated
                  : "linear-gradient(135deg, #E87722 0%, #A855F7 100%)",
                color: "#fff",
                boxShadow: recomputing ? "none" : "0 6px 16px rgba(168,85,247,0.35)",
              }}
            >
              {recomputing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Predicting…
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Run predictions
                </>
              )}
            </button>
          </div>
        </header>

        {recomputeMsg && (
          <div
            className="mb-6 p-3 rounded-lg flex items-center gap-2 text-sm"
            style={{ background: T.purpleBg, color: T.purple, border: `1px solid ${T.purple}` }}
          >
            <Sparkles size={14} />
            {recomputeMsg}
          </div>
        )}

        {/* Action toast — sticky top banner */}
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
            {toast.type === "success" ? <Check size={14} /> : toast.type === "error" ? <X size={14} /> : <Sparkles size={14} />}
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">
              <X size={12} />
            </button>
          </div>
        )}

        {/* KPIs */}
        {data?.kpis && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-8">
            <KpiCard
              icon={Target}
              label="Open Plays"
              value={formatInt(data.kpis.open_plays)}
              tone="info"
            />
            <KpiCard
              icon={Timer}
              label="Due in 7 days"
              value={formatInt(data.kpis.plays_due_7d)}
              tone="danger"
              detail="Action this week"
            />
            <KpiCard
              icon={Package}
              label="Needs Order"
              value={formatInt(data.kpis.plays_needing_order)}
              tone="warning"
              detail="Not yet on hand"
            />
            <KpiCard
              icon={DollarSign}
              label="Revenue at Play"
              value={formatCurrency(data.kpis.projected_revenue_90d)}
              tone="success"
              detail="Next 90 days"
            />
            <KpiCard
              icon={UserIcon}
              label="Customers"
              value={formatInt(data.kpis.customers_touched)}
              tone="neutral"
              detail="With active plays"
            />
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 mb-5 flex-wrap">
          <FilterPill label={`All (${data?.plays.length ?? 0})`} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterPill label="Due in 7 days" active={filter === "7d"} onClick={() => setFilter("7d")} tone="danger" />
          <FilterPill label="Needs order" active={filter === "needs_order"} onClick={() => setFilter("needs_order")} tone="warning" />
          <FilterPill label="Pre-positioned" active={filter === "pre_positioned"} onClick={() => setFilter("pre_positioned")} tone="success" />
        </div>

        {isLoading && (
          <LoadingCard />
        )}

        {error && (
          <div
            className="rounded-2xl p-6"
            style={{ background: T.dangerBg, border: `1px solid ${T.danger}` }}
          >
            <div className="text-sm" style={{ color: T.danger }}>
              Failed to load: {(error as Error).message}. Click "Run predictions" to populate plays.
            </div>
          </div>
        )}

        {data && filtered.length === 0 && !isLoading && (
          <EmptyCard
            title="No plays match this filter"
            subtitle={
              data.plays.length === 0
                ? "Run predictions to generate plays. Needs customer_fleet rows with current_hours and linked machine_profiles."
                : "Try a different filter."
            }
            showRunButton={data.plays.length === 0}
            onRun={handleRecompute}
            recomputing={recomputing}
          />
        )}

        {groupedByCustomer.length > 0 && (
          <div className="space-y-6">
            {groupedByCustomer.map(([customer, plays]) => (
              <CustomerGroup
                key={customer}
                customer={customer}
                plays={plays}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Target;
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
      className="rounded-2xl p-4"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: c.bg }}
        >
          <Icon size={13} color={c.fg} />
        </div>
        <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: T.textMuted }}>
          {label}
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: c.fg }}>
        {value}
      </div>
      {detail && (
        <div className="text-[10px] mt-1" style={{ color: T.textDim }}>
          {detail}
        </div>
      )}
    </div>
  );
}

// ── Customer Group ─────────────────────────────────────────

function CustomerGroup({
  customer,
  plays,
  onAction,
}: {
  customer: string;
  plays: PredictivePlay[];
  onAction: (id: string, action: "actioned" | "dismissed" | "fulfilled") => Promise<void>;
}) {
  const totalRevenue = plays.reduce((sum, p) => sum + ((p.projected_revenue ?? 0) * p.recommended_order_qty), 0);
  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <header
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: `1px solid ${T.borderSoft}` }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: T.purpleBg }}
        >
          <UserIcon size={18} color={T.purple} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{customer}</div>
          <div className="text-xs" style={{ color: T.textMuted }}>
            {plays.length} play{plays.length === 1 ? "" : "s"} · {formatCurrency(totalRevenue)} projected
          </div>
        </div>
      </header>
      <div>
        {plays.map((p, i) => (
          <PlayRow key={p.id} play={p} isFirst={i === 0} onAction={onAction} />
        ))}
      </div>
    </section>
  );
}

function PlayRow({
  play,
  isFirst,
  onAction,
}: {
  play: PredictivePlay;
  isFirst: boolean;
  onAction: (id: string, action: "actioned" | "dismissed" | "fulfilled") => Promise<void>;
}) {
  const win = windowBadge(play.projection_window);
  const onHand = play.current_on_hand_across_branches ?? 0;
  const shortBy = Math.max(0, play.recommended_order_qty - onHand);
  const prePositioned = shortBy === 0;

  return (
    <div
      className="px-5 py-4"
      style={{ borderTop: isFirst ? "none" : `1px solid ${T.borderSoft}` }}
    >
      <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
        {/* Machine + Part */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Truck size={12} color={T.textMuted} />
            <span className="text-xs font-medium" style={{ color: T.textMuted }}>
              {play.machine_make ?? "—"} {play.machine_model ?? ""}
              {play.machine_hours != null && (
                <span style={{ color: T.textDim }}> · {formatInt(play.machine_hours)} hrs</span>
              )}
            </span>
            <span
              className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{ background: win.bg, color: win.color }}
            >
              {win.label}
            </span>
            {play.signal_type === "ai_inferred" && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                style={{
                  background: "linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(192,38,211,0.2) 100%)",
                  color: "#c026d3",
                  border: "1px solid rgba(192,38,211,0.5)",
                }}
                title="This play was inferred by Claude based on usage patterns, seasonality, and order history"
              >
                🧠 Claude
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-mono text-base font-semibold">{play.part_number}</span>
            <span className="text-sm" style={{ color: T.textDim }}>
              {play.part_description ?? ""}
            </span>
          </div>
          <div className="text-xs mb-2" style={{ color: T.textMuted }}>
            <Zap size={10} className="inline mr-1" color={T.info} />
            {play.reason}
          </div>

          {/* Recommendation line — the star of the show */}
          <div
            className="text-sm font-medium leading-relaxed"
            style={{ color: T.text }}
          >
            {prePositioned ? (
              <>
                <Check size={14} className="inline mr-1.5 -mt-0.5" color={T.success} />
                <span style={{ color: T.success }}>
                  Pre-positioned — {formatInt(onHand)} on hand covers {formatInt(play.recommended_order_qty)} needed.
                </span>
              </>
            ) : (
              <>
                <Sparkles size={14} className="inline mr-1.5 -mt-0.5" color={T.orange} />
                Pre-position{" "}
                <span className="font-bold" style={{ color: T.orange }}>
                  {formatInt(shortBy)} more
                </span>
                {" "}(you have {formatInt(onHand)}, need {formatInt(play.recommended_order_qty)})
                {play.suggested_order_by && (
                  <>
                    {" "}— order by{" "}
                    <span className="font-bold">
                      {formatDate(play.suggested_order_by)}
                    </span>
                    {play.suggested_vendor_name && (
                      <> ({play.suggested_vendor_name})</>
                    )}
                  </>
                )}
                .
              </>
            )}
          </div>
        </div>

        {/* Right column — revenue + actions */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {play.projected_revenue != null && play.projected_revenue > 0 && (
            <div className="text-right">
              <div className="text-base font-bold" style={{ color: T.success }}>
                {formatCurrency(play.projected_revenue * play.recommended_order_qty)}
              </div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: T.textDim }}>
                projected revenue
              </div>
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => onAction(play.id, "actioned")}
              className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5"
              style={{ background: T.orangeGlow, color: T.orange, border: `1px solid ${T.orange}` }}
              title="Draft a PO in the replenish queue and mark this play handled"
            >
              <Check size={11} /> Queue PO
            </button>
            <button
              onClick={() => onAction(play.id, "dismissed")}
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.textMuted }}
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
          <div className="flex items-center gap-1 text-[10px]" style={{ color: T.textDim }}>
            <TrendingUp size={10} />
            {Math.round(play.probability * 100)}% confidence · {signalLabel(play.signal_type)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Generic helpers ────────────────────────────────────────

function FilterPill({
  label,
  active,
  onClick,
  tone = "neutral",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "neutral" | "danger" | "warning" | "success";
}) {
  const toneMap = {
    neutral: { activeBg: T.orangeGlow, activeFg: T.orange },
    danger: { activeBg: T.dangerBg, activeFg: T.danger },
    warning: { activeBg: T.warningBg, activeFg: T.warning },
    success: { activeBg: T.successBg, activeFg: T.success },
  } as const;
  const c = toneMap[tone];
  return (
    <button
      onClick={onClick}
      className="px-3.5 py-1.5 rounded-full text-xs font-medium transition-all"
      style={{
        background: active ? c.activeBg : T.bgElevated,
        color: active ? c.activeFg : T.textMuted,
        border: `1px solid ${active ? c.activeFg : T.border}`,
      }}
    >
      {label}
    </button>
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
        style={{ borderColor: T.border, borderTopColor: T.purple }}
      />
      <div className="text-sm" style={{ color: T.textMuted }}>
        Loading predictive plays…
      </div>
    </div>
  );
}

function EmptyCard({
  title,
  subtitle,
  showRunButton,
  onRun,
  recomputing,
}: {
  title: string;
  subtitle: string;
  showRunButton: boolean;
  onRun: () => void;
  recomputing: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-10 text-center"
      style={{ background: T.card, border: `1px solid ${T.border}` }}
    >
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
        style={{ background: T.purpleBg }}
      >
        <Flame size={24} color={T.purple} />
      </div>
      <div className="text-lg font-semibold mb-2">{title}</div>
      <div className="text-sm mb-6 max-w-md mx-auto" style={{ color: T.textMuted }}>
        {subtitle}
      </div>
      {showRunButton && (
        <button
          onClick={onRun}
          disabled={recomputing}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium"
          style={{
            background: "linear-gradient(135deg, #E87722 0%, #A855F7 100%)",
            color: "#fff",
            boxShadow: "0 6px 16px rgba(168,85,247,0.35)",
          }}
        >
          {recomputing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Run predictions
        </button>
      )}
    </div>
  );
}
