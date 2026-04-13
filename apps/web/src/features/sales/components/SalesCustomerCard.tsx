import { useNavigate } from "react-router-dom";
import {
  Phone,
  Mail,
  Clock,
  Target,
  MapPin,
  Zap,
  Star,
  Truck,
} from "lucide-react";
import type { RepCustomer } from "../lib/types";

/* ── Heat color mapping ─────────────────────────────────── */
function getHeatAccent(score: number): {
  stripe: string;
  heat: "hot" | "warm" | "cold";
  scoreBg: string;
  scoreBorder: string;
  scoreText: string;
  dotColor: string;
  heatBg: string;
} {
  if (score >= 70) {
    return {
      stripe: "bg-red-500",
      heat: "hot",
      scoreBg: "bg-red-500/10",
      scoreBorder: "border-red-500/25",
      scoreText: "text-red-400",
      dotColor: "bg-red-500",
      heatBg: "bg-red-500/10",
    };
  }
  if (score >= 40) {
    return {
      stripe: "bg-amber-400",
      heat: "warm",
      scoreBg: "bg-amber-500/10",
      scoreBorder: "border-amber-500/25",
      scoreText: "text-amber-400",
      dotColor: "bg-amber-400",
      heatBg: "bg-amber-500/10",
    };
  }
  return {
    stripe: "bg-blue-400",
    heat: "cold",
    scoreBg: "bg-blue-500/10",
    scoreBorder: "border-blue-500/25",
    scoreText: "text-blue-400",
    dotColor: "bg-blue-400",
    heatBg: "bg-blue-500/10",
  };
}

/* ── Avatar ─────────────────────────────────────────────── */
function CustomerAvatar({
  name,
  size = 42,
}: {
  name: string;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className="rounded-xl bg-gradient-to-br from-qep-orange/80 to-qep-orange flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        className="text-white font-extrabold"
        style={{ fontSize: size * 0.35 }}
      >
        {initials}
      </span>
    </div>
  );
}

/* ── Money formatting ───────────────────────────────────── */
function formatMoney(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

/* ── Component ──────────────────────────────────────────── */
export function SalesCustomerCard({
  customer,
  rank,
  showRank = false,
}: {
  customer: RepCustomer;
  rank?: number;
  showRank?: boolean;
}) {
  const navigate = useNavigate();
  const accent = getHeatAccent(customer.opportunity_score);

  return (
    <button
      onClick={() => navigate(`/sales/customers/${customer.customer_id}`)}
      className="w-full text-left p-0 border-none bg-transparent cursor-pointer"
    >
      <div className="relative rounded-2xl bg-[hsl(var(--card))] border border-white/[0.06] overflow-hidden transition-all duration-150 hover:border-white/20 hover:shadow-lg hover:shadow-black/20">
        {/* Priority rank badge (top 3) */}
        {showRank && rank != null && rank < 3 && (
          <div
            className={`absolute top-0 left-0 z-[2] flex items-center gap-1 px-2.5 py-1 rounded-br-[10px] text-[10px] font-extrabold uppercase tracking-[0.08em] ${
              rank === 0
                ? "bg-qep-orange text-white"
                : "bg-foreground/[0.06] text-muted-foreground"
            }`}
          >
            {rank === 0 && <Star className="w-[10px] h-[10px]" fill="white" />}
            #{rank + 1}
          </div>
        )}

        {/* Left heat stripe */}
        <div className={`absolute top-0 left-0 w-1 h-full ${accent.stripe}`} />

        {/* Opportunity score ribbon */}
        <div
          className={`absolute top-3 right-3 z-[2] flex items-center gap-1 px-2.5 py-1 rounded-full border ${accent.scoreBg} ${accent.scoreBorder}`}
        >
          <Target className={`w-[11px] h-[11px] ${accent.scoreText}`} />
          <span
            className={`text-xs font-extrabold tracking-[-0.01em] ${accent.scoreText}`}
          >
            {customer.opportunity_score}
          </span>
          <span
            className={`text-[9px] font-bold opacity-70 -ml-0.5 ${accent.scoreText}`}
          >
            /100
          </span>
        </div>

        <div className="px-3.5 pt-3.5 pb-0">
          {/* Header: avatar + name */}
          <div
            className={`flex items-start gap-3 mb-3 pr-[72px] ${
              showRank && rank != null && rank < 3 ? "pl-9" : ""
            }`}
          >
            <CustomerAvatar name={customer.company_name} />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-extrabold text-foreground leading-tight tracking-[-0.01em]">
                {customer.company_name}
              </p>
              {customer.primary_contact_name && (
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                  {customer.primary_contact_name}
                </p>
              )}
              <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-muted-foreground/60 font-medium">
                {customer.city && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-[10px] h-[10px]" />
                    {customer.city}, {customer.state}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="mx-3.5 grid grid-cols-4 gap-0 py-2.5 bg-foreground/[0.03] rounded-xl">
          <StatCell
            value={formatMoney(customer.open_deals > 0 ? undefined : 0)}
            label="Active"
            accent
            fallback={`${customer.open_deals}`}
          />
          <StatCell
            value={`${customer.active_quotes}`}
            label="Quotes"
            divider
          />
          <StatCell
            value={
              customer.days_since_contact != null
                ? `${customer.days_since_contact}d`
                : "--"
            }
            label="Last"
            divider
          />
          <StatCell
            value={`${customer.opportunity_score}`}
            label="Score"
            divider
            scoreAccent={accent.scoreText}
          />
        </div>

        {/* Heat badge row */}
        <div className="px-3.5 pt-3 pb-0 flex items-center gap-3">
          <div
            className={`flex items-center gap-1.5 px-2 py-[3px] rounded-[10px] ${accent.heatBg}`}
          >
            <span className={`w-2 h-2 rounded-full ${accent.dotColor}`} />
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.04em] ${accent.scoreText}`}
            >
              {accent.heat}
            </span>
          </div>
          {customer.open_deals > 0 && (
            <span className="text-[10px] font-bold text-qep-orange uppercase tracking-[0.04em] flex items-center gap-1">
              <Zap className="w-[10px] h-[10px]" />
              {customer.open_deals} active{" "}
              {customer.open_deals === 1 ? "deal" : "deals"}
            </span>
          )}
        </div>

        {/* Footer: last contact + call/email */}
        <div className="flex border-t border-white/[0.06] bg-foreground/[0.02] mt-3">
          <div className="flex-1 flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] text-muted-foreground/60 font-semibold">
            <Clock className="w-[11px] h-[11px]" />
            Last contact:{" "}
            {customer.days_since_contact != null
              ? `${customer.days_since_contact}d ago`
              : customer.last_interaction ?? "N/A"}
          </div>
          {customer.primary_contact_phone && (
            <a
              href={`tel:${customer.primary_contact_phone}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 px-3.5 border-l border-white/[0.06] text-qep-orange text-[11px] font-bold hover:bg-foreground/[0.04] transition-colors"
            >
              <Phone className="w-3 h-3" />
              Call
            </a>
          )}
          {customer.primary_contact_email && (
            <a
              href={`mailto:${customer.primary_contact_email}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 px-3.5 border-l border-white/[0.06] text-foreground text-[11px] font-bold hover:bg-foreground/[0.04] transition-colors"
            >
              <Mail className="w-3 h-3 text-muted-foreground" />
              Email
            </a>
          )}
        </div>
      </div>
    </button>
  );
}

/* ── Stat cell ──────────────────────────────────────────── */
function StatCell({
  value,
  label,
  accent,
  divider,
  fallback,
  scoreAccent,
}: {
  value: string;
  label: string;
  accent?: boolean;
  divider?: boolean;
  fallback?: string;
  scoreAccent?: string;
}) {
  const displayValue = fallback ?? value;
  return (
    <div
      className={`text-center px-1 ${
        divider ? "border-l border-white/[0.06]" : ""
      }`}
    >
      <p
        className={`text-sm font-extrabold tracking-[-0.01em] ${
          scoreAccent
            ? scoreAccent
            : accent
              ? "text-qep-orange"
              : "text-foreground"
        }`}
      >
        {displayValue}
      </p>
      <p className="text-[9px] text-muted-foreground/50 uppercase tracking-[0.06em] font-bold mt-0.5">
        {label}
      </p>
    </div>
  );
}
