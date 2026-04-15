import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign,
  Plus,
  Check,
  X,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  Gauge,
  AlertCircle,
  Info,
  Tag,
} from "lucide-react";
import {
  applySuggestions,
  createRule,
  dismissSuggestions,
  fetchPricingSummary,
  regenerateSuggestions,
  toggleRule,
  type PricingRule,
  type PricingRuleType,
  type PricingScope,
  type PricingSummary,
} from "../lib/pricing-api";

// Design tokens (same as other Parts Companion pages)
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
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function PricingRulesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [regenerating, setRegenerating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<PricingSummary>({
    queryKey: ["pricing-rules-summary"],
    queryFn: fetchPricingSummary,
    refetchInterval: 45000,
  });

  const allSelected = useMemo(() => {
    if (!data?.top_pending_suggestions?.length) return false;
    return data.top_pending_suggestions.every((s) => selected.has(s.id));
  }, [data, selected]);

  const toggleAll = () => {
    if (!data?.top_pending_suggestions) return;
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(data.top_pending_suggestions.map((s) => s.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    if (selected.size === 0) return;
    const r = await applySuggestions(Array.from(selected));
    setFlashMsg(`Applied ${r.applied_count} price change${r.applied_count === 1 ? "" : "s"}`);
    setSelected(new Set());
    await queryClient.invalidateQueries({ queryKey: ["pricing-rules-summary"] });
  };

  const handleDismiss = async () => {
    if (selected.size === 0) return;
    const r = await dismissSuggestions(Array.from(selected));
    setFlashMsg(`Dismissed ${r.dismissed_count} suggestion${r.dismissed_count === 1 ? "" : "s"}`);
    setSelected(new Set());
    await queryClient.invalidateQueries({ queryKey: ["pricing-rules-summary"] });
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const r = await regenerateSuggestions();
      setFlashMsg(`Regenerated — ${r.suggestions_written} suggestions written in ${r.elapsed_ms.toFixed(0)}ms`);
      await queryClient.invalidateQueries({ queryKey: ["pricing-rules-summary"] });
    } catch (err) {
      setFlashMsg(`Failed: ${(err as Error).message}`);
    } finally {
      setRegenerating(false);
    }
  };

  const handleToggleRule = async (ruleId: string, nextState: boolean) => {
    await toggleRule(ruleId, nextState);
    await queryClient.invalidateQueries({ queryKey: ["pricing-rules-summary"] });
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
                  background: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(232,119,34,0.18) 100%)",
                  boxShadow: "0 0 28px rgba(34,197,94,0.25)",
                }}
              >
                <DollarSign size={22} color={T.success} />
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Pricing Rules
              </h1>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: T.successBg, color: T.success, border: `1px solid ${T.success}` }}
              >
                Margin enforcement
              </span>
            </div>
            <p className="text-sm md:text-base max-w-2xl" style={{ color: T.textMuted }}>
              Define margin targets per vendor, class, or SKU. The system measures drift nightly,
              proposes price changes, and applies them only after your approval.
              Nothing overwrites a price without an audit trail.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium disabled:opacity-60"
              style={{
                background: regenerating ? T.bgElevated : `linear-gradient(135deg, ${T.info} 0%, ${T.purple} 100%)`,
                color: "#fff",
                boxShadow: regenerating ? "none" : "0 6px 16px rgba(59,130,246,0.35)",
              }}
            >
              {regenerating ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  Regenerate suggestions
                </>
              )}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium"
              style={{
                background: `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`,
                color: "#fff",
                boxShadow: `0 6px 16px ${T.orangeDeep}`,
              }}
            >
              <Plus size={14} /> New rule
            </button>
          </div>
        </header>

        {flashMsg && (
          <div
            className="mb-6 p-3 rounded-lg flex items-center gap-2 text-sm"
            style={{ background: T.successBg, color: T.success, border: `1px solid ${T.success}` }}
          >
            <Check size={14} />
            {flashMsg}
          </div>
        )}

        {/* KPIs */}
        {data?.kpis && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-8">
            <Kpi icon={Shield} label="Active Rules" value={fmtInt(data.kpis.active_rules)} tone="info" />
            <Kpi icon={Gauge} label="Pending Review" value={fmtInt(data.kpis.pending_suggestions)} tone="warning" detail="Suggestions awaiting approval" />
            <Kpi icon={DollarSign} label="Revenue Impact" value={fmtCurrency(data.kpis.pending_revenue_impact)} tone={data.kpis.pending_revenue_impact >= 0 ? "success" : "danger"} detail="If all approved" />
            <Kpi icon={Check} label="Applied · 30d" value={fmtInt(data.kpis.applied_last_30d)} tone="neutral" />
            <Kpi icon={AlertCircle} label="Out of Tolerance" value={fmtInt(data.kpis.parts_out_of_tolerance)} tone="warning" detail="Parts drifting from target" />
          </div>
        )}

        {isLoading && <LoadingCard />}

        {error && (
          <div
            className="rounded-2xl p-6 mb-6"
            style={{ background: T.dangerBg, border: `1px solid ${T.danger}` }}
          >
            <div className="text-sm" style={{ color: T.danger }}>
              Failed to load: {(error as Error).message}
            </div>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Rules column */}
            <section className="lg:col-span-1">
              <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: T.textMuted }}>
                Active Rules ({data.active_rules.length})
              </h2>
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: T.card, border: `1px solid ${T.border}` }}
              >
                {data.active_rules.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <div className="text-sm mb-3" style={{ color: T.textMuted }}>
                      No rules yet
                    </div>
                    <button
                      onClick={() => setShowCreate(true)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: T.orangeGlow, color: T.orange, border: `1px solid ${T.orange}` }}
                    >
                      Create first rule
                    </button>
                  </div>
                ) : (
                  data.active_rules.map((rule, i) => (
                    <RuleRow key={rule.id} rule={rule} isFirst={i === 0} onToggle={handleToggleRule} />
                  ))
                )}
              </div>
            </section>

            {/* Pending suggestions — the action surface */}
            <section className="lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
                  Pending suggestions ({data.top_pending_suggestions.length})
                </h2>
                {selected.size > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <span style={{ color: T.textMuted }}>{selected.size} selected</span>
                    <button
                      onClick={handleDismiss}
                      className="px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: T.bgElevated, color: T.textMuted, border: `1px solid ${T.border}` }}
                    >
                      <X size={11} className="inline mr-1" /> Dismiss
                    </button>
                    <button
                      onClick={handleApply}
                      className="px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: T.successBg, color: T.success, border: `1px solid ${T.success}` }}
                    >
                      <Check size={11} className="inline mr-1" /> Apply
                    </button>
                  </div>
                )}
              </div>
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: T.card, border: `1px solid ${T.border}` }}
              >
                {data.top_pending_suggestions.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <div
                      className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
                      style={{ background: T.successBg }}
                    >
                      <Check size={20} color={T.success} />
                    </div>
                    <div className="font-medium mb-1">No drift detected</div>
                    <div className="text-xs" style={{ color: T.textDim }}>
                      Every part is within tolerance of its rule target.
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="grid grid-cols-[24px_1fr_110px_110px_110px_60px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wide font-medium"
                      style={{ background: T.bgElevated, color: T.textMuted, borderBottom: `1px solid ${T.borderSoft}` }}
                    >
                      <div>
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                      </div>
                      <div>Part / Reason</div>
                      <div className="text-right">Current</div>
                      <div className="text-right">Suggested</div>
                      <div className="text-right">Delta</div>
                      <div className="text-right">Margin</div>
                    </div>
                    {data.top_pending_suggestions.map((s) => {
                      const isSelected = selected.has(s.id);
                      const isIncrease = (s.delta_dollars ?? 0) > 0;
                      return (
                        <div
                          key={s.id}
                          className="grid grid-cols-[24px_1fr_110px_110px_110px_60px] gap-3 px-4 py-3 items-center cursor-pointer"
                          onClick={() => toggleOne(s.id)}
                          style={{
                            background: isSelected ? T.infoBg : "transparent",
                            borderTop: `1px solid ${T.borderSoft}`,
                          }}
                        >
                          <div onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleOne(s.id)} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono text-sm truncate">{s.part_number}</div>
                            <div className="text-xs truncate" style={{ color: T.textDim }}>
                              {s.reason}
                            </div>
                          </div>
                          <div className="text-right text-sm font-mono">
                            {fmtCurrency(s.current_sell, 2)}
                          </div>
                          <div className="text-right text-sm font-mono" style={{ color: isIncrease ? T.success : T.warning }}>
                            {fmtCurrency(s.suggested_sell, 2)}
                          </div>
                          <div className="text-right text-sm font-mono" style={{ color: isIncrease ? T.success : T.danger }}>
                            {isIncrease ? <TrendingUp size={11} className="inline" /> : <TrendingDown size={11} className="inline" />}{" "}
                            {fmtCurrency(Math.abs(s.delta_dollars ?? 0), 2)}
                          </div>
                          <div className="text-right text-xs">
                            <div style={{ color: T.textMuted }}>{fmtPct(s.current_margin_pct)}</div>
                            <div style={{ color: T.success }}>→ {fmtPct(s.suggested_margin_pct)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
              {data.top_pending_suggestions.length > 0 && (
                <div className="mt-3 text-xs flex items-center gap-1.5" style={{ color: T.textDim }}>
                  <Info size={11} />
                  Click rows to select, then Apply writes prices to parts_catalog (with audit trail).
                  Dismissed suggestions won't re-surface unless the underlying data changes.
                </div>
              )}
            </section>
          </div>
        )}

        {showCreate && (
          <CreateRuleModal
            onClose={() => setShowCreate(false)}
            onCreated={async () => {
              setShowCreate(false);
              setFlashMsg("Rule created. Click Regenerate suggestions to scan now.");
              await queryClient.invalidateQueries({ queryKey: ["pricing-rules-summary"] });
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── KPI ────────────────────────────────────────────────────

function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof DollarSign;
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

// ── Rule row ───────────────────────────────────────────────

function RuleRow({
  rule,
  isFirst,
  onToggle,
}: {
  rule: PricingRule;
  isFirst: boolean;
  onToggle: (id: string, next: boolean) => Promise<void>;
}) {
  const describeRule = (): string => {
    switch (rule.rule_type) {
      case "min_margin_pct":
        return `Min ${rule.min_margin_pct}% margin`;
      case "target_margin_pct":
        return `Target ${rule.target_margin_pct}% margin`;
      case "markup_multiplier":
        return `Cost × ${rule.markup_multiplier}`;
      case "markup_with_floor":
        return `Cost × ${rule.markup_multiplier} min $${((rule.markup_floor_cents ?? 0) / 100).toFixed(2)}`;
    }
  };

  const describeScope = (): string => {
    if (rule.scope_type === "global") return "All parts";
    const label = {
      vendor: "Vendor",
      class: "Class",
      category: "Category",
      machine_code: "Machine",
      part: "Part",
    }[rule.scope_type];
    return `${label}: ${rule.scope_value}`;
  };

  return (
    <div
      className="px-4 py-3"
      style={{ borderTop: isFirst ? "none" : `1px solid ${T.borderSoft}` }}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{rule.name}</div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: T.textDim }}>
            P{rule.priority} · {describeScope()}
          </div>
        </div>
        <button
          onClick={() => onToggle(rule.id, !rule.is_active)}
          className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide"
          style={{
            background: rule.is_active ? T.successBg : T.borderSoft,
            color: rule.is_active ? T.success : T.textMuted,
          }}
        >
          {rule.is_active ? "Active" : "Off"}
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs mt-2" style={{ color: T.text }}>
        <Target size={11} color={T.orange} />
        <span>{describeRule()}</span>
      </div>
      <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: T.textDim }}>
        <span>±{rule.tolerance_pct}% tolerance</span>
        <span>·</span>
        <span>{rule.auto_apply ? "Auto-applies" : "Preview first"}</span>
      </div>
    </div>
  );
}

// ── Create rule modal ──────────────────────────────────────

function CreateRuleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [scope_type, setScopeType] = useState<PricingScope>("global");
  const [scope_value, setScopeValue] = useState("");
  const [rule_type, setRuleType] = useState<PricingRuleType>("target_margin_pct");
  const [target_margin_pct, setTargetMargin] = useState(40);
  const [min_margin_pct, setMinMargin] = useState(25);
  const [markup_multiplier, setMarkup] = useState(1.4);
  const [markup_floor_cents, setFloor] = useState(500);
  const [tolerance_pct, setTolerance] = useState(1.0);
  const [priority, setPriority] = useState(100);
  const [auto_apply, setAutoApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await createRule({
        name,
        description: null,
        scope_type,
        scope_value: scope_type === "global" ? null : scope_value,
        rule_type,
        min_margin_pct: rule_type === "min_margin_pct" ? min_margin_pct : null,
        target_margin_pct: rule_type === "target_margin_pct" ? target_margin_pct : null,
        markup_multiplier: rule_type === "markup_multiplier" || rule_type === "markup_with_floor" ? markup_multiplier : null,
        markup_floor_cents: rule_type === "markup_with_floor" ? markup_floor_cents : null,
        price_target: "list_price",
        tolerance_pct,
        auto_apply,
        is_active: true,
        priority,
        effective_from: new Date().toISOString().slice(0, 10),
        effective_until: null,
      });
      await onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-6 w-full max-w-md"
        style={{ background: T.card, border: `1px solid ${T.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New pricing rule</h2>
          <button onClick={onClose} style={{ color: T.textMuted }}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Yanmar filters target 40%"
              className="w-full px-3 py-2 rounded-lg outline-none"
              style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Scope">
              <select
                value={scope_type}
                onChange={(e) => setScopeType(e.target.value as PricingScope)}
                className="w-full px-3 py-2 rounded-lg outline-none"
                style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }}
              >
                <option value="global">All parts</option>
                <option value="vendor">Vendor</option>
                <option value="class">Class code</option>
                <option value="category">Category</option>
                <option value="machine_code">Machine code</option>
                <option value="part">Single part</option>
              </select>
            </Field>
            <Field label="Scope value" disabled={scope_type === "global"}>
              <input
                value={scope_value}
                onChange={(e) => setScopeValue(e.target.value)}
                placeholder="e.g. YANMAR"
                disabled={scope_type === "global"}
                className="w-full px-3 py-2 rounded-lg outline-none disabled:opacity-40"
                style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }}
              />
            </Field>
          </div>

          <Field label="Rule type">
            <select
              value={rule_type}
              onChange={(e) => setRuleType(e.target.value as PricingRuleType)}
              className="w-full px-3 py-2 rounded-lg outline-none"
              style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }}
            >
              <option value="target_margin_pct">Target margin %</option>
              <option value="min_margin_pct">Minimum margin %</option>
              <option value="markup_multiplier">Cost × multiplier</option>
              <option value="markup_with_floor">Cost × multiplier, with dollar floor</option>
            </select>
          </Field>

          {rule_type === "target_margin_pct" && (
            <Field label="Target margin %">
              <input type="number" value={target_margin_pct} onChange={(e) => setTargetMargin(+e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }} />
            </Field>
          )}
          {rule_type === "min_margin_pct" && (
            <Field label="Minimum margin %">
              <input type="number" value={min_margin_pct} onChange={(e) => setMinMargin(+e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }} />
            </Field>
          )}
          {(rule_type === "markup_multiplier" || rule_type === "markup_with_floor") && (
            <Field label="Multiplier">
              <input type="number" step="0.05" value={markup_multiplier} onChange={(e) => setMarkup(+e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }} />
            </Field>
          )}
          {rule_type === "markup_with_floor" && (
            <Field label="Floor (cents)">
              <input type="number" value={markup_floor_cents} onChange={(e) => setFloor(+e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }} />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tolerance %">
              <input type="number" step="0.1" value={tolerance_pct} onChange={(e) => setTolerance(+e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }} />
            </Field>
            <Field label="Priority">
              <input type="number" value={priority} onChange={(e) => setPriority(+e.target.value)} className="w-full px-3 py-2 rounded-lg outline-none" style={{ background: T.bgElevated, border: `1px solid ${T.border}`, color: T.text }} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs" style={{ color: T.textMuted }}>
            <input type="checkbox" checked={auto_apply} onChange={(e) => setAutoApply(e.target.checked)} />
            Auto-apply (skip manual review — only recommend for trusted rules)
          </label>

          {err && (
            <div className="text-xs p-2 rounded-lg" style={{ background: T.dangerBg, color: T.danger }}>
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: T.bgElevated, color: T.textMuted, border: `1px solid ${T.border}` }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={busy || !name || (scope_type !== "global" && !scope_value)}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${T.orange} 0%, #D06118 100%)`, color: "#fff" }}
            >
              {busy ? "Creating…" : "Create rule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, disabled = false }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <div className="text-[10px] uppercase tracking-wide font-medium mb-1" style={{ color: T.textMuted }}>
        {label}
      </div>
      {children}
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
        style={{ borderColor: T.border, borderTopColor: T.success }}
      />
      <div className="text-sm" style={{ color: T.textMuted }}>Loading pricing rules…</div>
    </div>
  );
}
