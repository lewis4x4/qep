/**
 * SupplierHealthPage — Slice 3.5.
 *
 * Per-vendor health scorecard: price creep YoY, fill rate 90d,
 * file freshness, composite health tier (green/yellow/red).
 */
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, ShieldAlert, Clock, Truck,
  CheckCircle2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  fetchSupplierHealthSummary,
  type SupplierHealthSummary, type SupplierHealthRow, type HealthTier,
} from "../lib/supplier-health-api";

const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  border: "#1F3254",
  orange: "#E87722",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.12)",
  danger: "#EF4444",
  dangerBg: "rgba(239,68,68,0.12)",
} as const;

const TIER_STYLE: Record<HealthTier, { label: string; bg: string; color: string; ring: string }> = {
  green:  { label: "Healthy",    bg: T.successBg, color: T.success, ring: "rgba(34,197,94,0.30)" },
  yellow: { label: "Watch",      bg: T.warningBg, color: T.warning, ring: "rgba(245,158,11,0.30)" },
  red:    { label: "Intervene",  bg: T.dangerBg,  color: T.danger,  ring: "rgba(239,68,68,0.40)" },
};

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(digits)}%`;
}

function fmtHours(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 24) return `${Math.round(n)}h`;
  return `${Math.round(n / 24)}d`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SupplierHealthPage() {
  const q = useQuery<SupplierHealthSummary>({
    queryKey: ["parts", "supplier-health"],
    queryFn: fetchSupplierHealthSummary,
    refetchInterval: 120_000,
  });

  const counts = q.data?.counts ?? { green: 0, yellow: 0, red: 0, total: 0 };
  const rows = q.data?.rows ?? [];
  const red = q.data?.red_vendors ?? [];
  const creep = q.data?.top_price_creep ?? [];
  const fill = q.data?.lowest_fill_rate ?? [];

  return (
    <div className="min-h-screen" style={{ background: T.bg, color: T.text }}>
      <div className="mx-auto w-full max-w-[1300px] px-4 py-6 sm:px-6">
        <header className="mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: T.orange }}>
            Supplier Health
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Price creep, fill rate, file freshness — per vendor
          </h1>
          <p className="mt-1 text-sm" style={{ color: T.textMuted }}>
            Weighted YoY price change from parts_vendor_prices · 90-day replenish fill rate from parts_auto_replenish_queue · tier auto-derived.
          </p>
        </header>

        {/* Tier counts */}
        <section className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <TierCard label="Healthy"   value={counts.green}  tier="green"  icon={CheckCircle2} />
          <TierCard label="Watch"     value={counts.yellow} tier="yellow" icon={Clock} />
          <TierCard label="Intervene" value={counts.red}    tier="red"    icon={ShieldAlert} />
          <div
            className="rounded-2xl p-4"
            style={{
              background: `linear-gradient(180deg, ${T.card}, ${T.bg})`,
              border: `1px solid ${T.border}`,
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
              Total vendors
            </p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{counts.total}</p>
            <p className="mt-1 text-xs" style={{ color: T.textDim }}>Scorecard scope</p>
          </div>
        </section>

        {/* Red flags panel — only if any */}
        {(red.length > 0 || creep.length > 0 || fill.length > 0) && (
          <section className="mb-6 grid gap-4 lg:grid-cols-3">
            <SignalPanel
              title="Intervene now"
              subtitle="Red-tier vendors"
              items={red.map((r) => ({
                name: r.vendor_name,
                primary: r.price_change_pct_yoy != null
                  ? `${fmtPct(r.price_change_pct_yoy)} price YoY`
                  : r.fill_rate_pct_90d != null
                  ? `${r.fill_rate_pct_90d}% fill`
                  : `${r.days_since_last_price_file ?? "?"}d since file`,
                secondary: null,
              }))}
              icon={ShieldAlert}
              tone="red"
            />
            <SignalPanel
              title="Top price creep"
              subtitle="Weighted YoY increase"
              items={creep.map((r) => ({
                name: r.vendor_name,
                primary: fmtPct(r.price_change_pct_yoy),
                secondary: r.parts_up_more_than_5pct != null
                  ? `${r.parts_up_more_than_5pct}/${r.parts_compared} parts up >5%`
                  : null,
              }))}
              icon={TrendingUp}
              tone="yellow"
            />
            <SignalPanel
              title="Lowest fill rate"
              subtitle="90-day replenish"
              items={fill.map((r) => ({
                name: r.vendor_name,
                primary: r.fill_rate_pct_90d != null ? `${r.fill_rate_pct_90d}%` : "—",
                secondary: `${r.replenish_items_ordered ?? 0}/${r.replenish_items_90d ?? 0} ordered`,
              }))}
              icon={TrendingDown}
              tone="yellow"
            />
          </section>
        )}

        {/* Full table */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: T.textMuted }}>
            All vendors
          </h2>

          {q.isLoading && <p className="text-sm" style={{ color: T.textMuted }}>Loading…</p>}
          {q.isError && (
            <p className="text-sm" style={{ color: T.danger }}>
              {(q.error as Error).message}
            </p>
          )}
          {!q.isLoading && rows.length === 0 && (
            <div
              className="rounded-xl p-6 text-center"
              style={{ background: T.card, border: `1px dashed ${T.border}` }}
            >
              <Truck className="mx-auto mb-2" size={28} style={{ color: T.textDim }} />
              <p className="text-sm" style={{ color: T.textMuted }}>
                No vendors in the workspace yet. Import vendor contacts to populate.
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <div
              className="rounded-2xl overflow-x-auto"
              style={{ background: T.card, border: `1px solid ${T.border}` }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: T.textDim }}>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Vendor</th>
                    <th className="text-left px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Health</th>
                    <th className="text-right px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Price YoY</th>
                    <th className="text-right px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Fill 90d</th>
                    <th className="text-right px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Lead Time</th>
                    <th className="text-right px-2 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Parts</th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em]">Last File</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <VendorRow key={r.vendor_id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TierCard({
  label, value, tier, icon: Icon,
}: {
  label: string; value: number; tier: HealthTier;
  icon: LucideIcon;
}) {
  const style = TIER_STYLE[tier];
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: `linear-gradient(180deg, ${T.card}, ${T.bg})`,
        border: `1px solid ${style.ring}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
          {label}
        </p>
        <span style={{ color: style.color }}>
          <Icon size={14} style={{ color: style.color }} />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums" style={{ color: style.color }}>
        {value}
      </p>
      <p className="mt-1 text-xs" style={{ color: T.textDim }}>{tier} tier</p>
    </div>
  );
}

function SignalPanel({
  title, subtitle, items, icon: Icon, tone,
}: {
  title: string;
  subtitle: string;
  items: Array<{ name: string; primary: string; secondary: string | null }>;
  icon: LucideIcon;
  tone: "red" | "yellow";
}) {
  const color = tone === "red" ? T.danger : T.warning;
  const ring = tone === "red" ? "rgba(239,68,68,0.35)" : "rgba(245,158,11,0.30)";
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: T.card,
        border: `1px solid ${ring}`,
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: T.textMuted }}>
            {subtitle}
          </p>
          <p className="text-sm font-semibold" style={{ color: T.text }}>{title}</p>
        </div>
        <span style={{ color }}>
          <Icon size={16} style={{ color }} />
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: T.textDim }}>Nothing flagged.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, idx) => (
            <li
              key={`${it.name}-${idx}`}
              className="flex items-start justify-between gap-3 rounded-lg p-2"
              style={{ background: T.bgElevated, border: `1px solid ${T.border}` }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: T.text }}>{it.name}</p>
                {it.secondary && (
                  <p className="text-[11px] mt-0.5" style={{ color: T.textDim }}>{it.secondary}</p>
                )}
              </div>
              <p className="text-sm font-semibold tabular-nums whitespace-nowrap" style={{ color }}>
                {it.primary}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VendorRow({ row }: { row: SupplierHealthRow }) {
  const tier = TIER_STYLE[row.health_tier];
  return (
    <tr style={{ borderTop: `1px solid ${T.border}` }}>
      <td className="px-4 py-3">
        <p className="font-medium">{row.vendor_name}</p>
        {row.supplier_type && (
          <p className="text-[11px]" style={{ color: T.textDim }}>{row.supplier_type}</p>
        )}
      </td>
      <td className="px-2 py-3">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ background: tier.bg, color: tier.color }}
        >
          {tier.label}
        </span>
      </td>
      <td
        className="px-2 py-3 text-right tabular-nums"
        style={{
          color:
            row.price_change_pct_yoy == null ? T.textDim
            : row.price_change_pct_yoy >= 5 ? T.danger
            : row.price_change_pct_yoy >= 2 ? T.warning
            : T.text,
        }}
      >
        {fmtPct(row.price_change_pct_yoy)}
        {row.parts_compared != null && row.parts_compared > 0 && (
          <span className="text-[10px] ml-1" style={{ color: T.textDim }}>
            ({row.parts_compared})
          </span>
        )}
      </td>
      <td
        className="px-2 py-3 text-right tabular-nums"
        style={{
          color:
            row.fill_rate_pct_90d == null ? T.textDim
            : row.fill_rate_pct_90d <= 60 ? T.danger
            : row.fill_rate_pct_90d <= 80 ? T.warning
            : T.success,
        }}
      >
        {row.fill_rate_pct_90d != null ? `${row.fill_rate_pct_90d}%` : "—"}
      </td>
      <td className="px-2 py-3 text-right tabular-nums" style={{ color: T.textMuted }}>
        {fmtHours(row.avg_lead_time_hours)}
      </td>
      <td className="px-2 py-3 text-right tabular-nums" style={{ color: T.textMuted }}>
        {row.catalog_parts.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right" style={{ color: T.textMuted }}>
        {fmtDate(row.last_price_file_at)}
        {row.days_since_last_price_file != null && row.days_since_last_price_file > 60 && (
          <span
            className="ml-1 text-[10px] font-semibold"
            style={{
              color: row.days_since_last_price_file > 120 ? T.danger : T.warning,
            }}
          >
            ({row.days_since_last_price_file}d)
          </span>
        )}
      </td>
    </tr>
  );
}
