import { useParams, useNavigate, Navigate } from "react-router-dom";
import {
  ChevronLeft,
  PhoneCall,
  Mail,
  FileText,
  Edit3,
  Flame,
  Clock,
  Target,
  MapPin,
  ExternalLink,
} from "lucide-react";
import { useCustomerDetail } from "../hooks/useCustomerDetail";
import { EquipmentFleet } from "../components/EquipmentFleet";
import { InteractionTimeline } from "../components/InteractionTimeline";
import type { RepPipelineDeal } from "../lib/types";

/* ── Avatar ─────────────────────────────────────────────── */
function CustomerAvatar({
  name,
  size = 52,
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

/* ── Heat accent mapping ────────────────────────────────── */
function getScoreAccent(score: number) {
  if (score >= 70) {
    return {
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      text: "text-red-400",
      icon: "text-red-400",
    };
  }
  if (score >= 40) {
    return {
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      text: "text-amber-400",
      icon: "text-amber-400",
    };
  }
  return {
    bg: "bg-foreground/[0.04]",
    border: "border-white/[0.06]",
    text: "text-muted-foreground",
    icon: "text-muted-foreground/60",
  };
}

/* ── Stage tag color ────────────────────────────────────── */
function getStageTagColor(stage: string): string {
  const s = stage.toLowerCase();
  if (s.includes("closing") || s.includes("close")) return "text-emerald-400 bg-emerald-500/15";
  if (s.includes("negotiat")) return "text-qep-orange bg-qep-orange/15";
  if (s.includes("quot")) return "text-amber-400 bg-amber-500/15";
  return "text-blue-400 bg-blue-500/15";
}

/* ── Money formatting ───────────────────────────────────── */
function formatMoney(amount: number | null | undefined): string {
  if (amount == null) return "";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

/* ── Page component ─────────────────────────────────────── */
export function CustomerDetailPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const safeId = companyId ?? "";
  const navigate = useNavigate();
  const { customer, equipment, deals, activities, quotes, isLoading } =
    useCustomerDetail(safeId);

  if (!companyId) {
    return <Navigate to="/sales/customers" replace />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12 px-4">
        <p className="text-muted-foreground">Customer not found.</p>
        <button
          onClick={() => navigate("/sales/customers")}
          className="mt-4 text-qep-orange text-sm font-medium"
        >
          Back to customers
        </button>
      </div>
    );
  }

  const scoreAccent = getScoreAccent(customer.opportunity_score);
  const primaryDeal = deals.length > 0 ? deals[0] : null;

  return (
    <div className="pb-20 max-w-lg mx-auto">
      {/* Header */}
      <div
        className="px-4 pt-3 pb-4 border-b border-white/[0.06]"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
        }}
      >
        {/* Back button */}
        <button
          onClick={() => navigate("/sales/customers")}
          className="flex items-center gap-1 text-qep-orange text-[13px] font-semibold mb-3 p-1 -ml-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Customers
        </button>

        {/* Avatar + Name + Score */}
        <div className="flex items-start gap-3 mb-3">
          <CustomerAvatar name={customer.company_name} />
          <div className="flex-1 min-w-0">
            <p className="text-[19px] font-extrabold text-foreground tracking-[-0.01em]">
              {customer.company_name}
            </p>
            {customer.primary_contact_name && (
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {customer.primary_contact_name}
              </p>
            )}
            {customer.city && (
              <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground/60">
                <MapPin className="w-[11px] h-[11px]" />
                {customer.city}, {customer.state}
              </div>
            )}
          </div>

          {/* Opportunity score badge */}
          <div
            className={`flex items-center gap-1 px-2.5 py-1 rounded-xl border ${scoreAccent.bg} ${scoreAccent.border}`}
          >
            <Target className={`w-3 h-3 ${scoreAccent.icon}`} />
            <span
              className={`text-[13px] font-extrabold ${scoreAccent.text}`}
            >
              {customer.opportunity_score}
            </span>
          </div>
        </div>

        {/* Action row */}
        <div className="grid grid-cols-4 gap-1.5">
          {[
            {
              icon: <PhoneCall className="w-4 h-4" />,
              label: "Call",
              primary: true,
              href: customer.primary_contact_phone
                ? `tel:${customer.primary_contact_phone}`
                : undefined,
            },
            {
              icon: <Mail className="w-4 h-4" />,
              label: "Email",
              href: customer.primary_contact_email
                ? `mailto:${customer.primary_contact_email}`
                : undefined,
            },
            {
              icon: <FileText className="w-4 h-4" />,
              label: "Quote",
            },
            {
              icon: <Edit3 className="w-4 h-4" />,
              label: "Log",
            },
          ].map((action, i) =>
            action.href ? (
              <a
                key={i}
                href={action.href}
                className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-[10px] text-[11px] font-bold transition-colors ${
                  action.primary
                    ? "bg-qep-orange text-white"
                    : "bg-[hsl(var(--card))] border border-white/[0.06] text-foreground hover:border-white/20"
                }`}
              >
                {action.icon}
                {action.label}
              </a>
            ) : (
              <button
                key={i}
                className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-[10px] text-[11px] font-bold transition-colors ${
                  action.primary
                    ? "bg-qep-orange text-white"
                    : "bg-[hsl(var(--card))] border border-white/[0.06] text-foreground hover:border-white/20"
                }`}
              >
                {action.icon}
                {action.label}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pt-4 space-y-5">
        {/* Equipment Fleet — THE LEAD SECTION */}
        <EquipmentFleet equipment={equipment} />

        {/* Active Deal */}
        {primaryDeal && (
          <ActiveDealCard deal={primaryDeal} />
        )}

        {/* Additional deals */}
        {deals.length > 1 && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.1em]">
                Other Deals
              </span>
              <span className="text-[11px] text-muted-foreground/50">
                ({deals.length - 1})
              </span>
            </div>
            <div className="space-y-2">
              {deals.slice(1).map((deal) => (
                <div
                  key={deal.deal_id}
                  className="bg-[hsl(var(--card))] rounded-[14px] border border-white/[0.06] px-3.5 py-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {deal.deal_name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {deal.stage}
                        {deal.days_since_activity != null &&
                          ` · ${deal.days_since_activity}d since activity`}
                      </p>
                    </div>
                    {deal.amount != null && (
                      <span className="text-sm font-bold text-foreground">
                        {formatMoney(deal.amount)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Active Quotes */}
        {quotes.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.1em]">
                Active Quotes
              </span>
              <span className="text-[11px] text-muted-foreground/50">
                ({quotes.length})
              </span>
            </div>
            <div className="space-y-2">
              {quotes.map(
                (quote: {
                  id: string;
                  title: string | null;
                  status: string;
                  created_at: string;
                }) => (
                  <div
                    key={quote.id}
                    className="bg-[hsl(var(--card))] rounded-[14px] border border-white/[0.06] px-3.5 py-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {quote.title ?? "Untitled Quote"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {quote.status} ·{" "}
                        {new Date(quote.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ),
              )}
            </div>
          </section>
        )}

        {/* Recent Activity Timeline */}
        <InteractionTimeline activities={activities} />

        {/* Link to Iron Manager */}
        <div className="pt-2 pb-4">
          <button
            onClick={() => navigate(`/qrm/companies/${companyId}`)}
            className="w-full py-3 rounded-[10px] border border-white/[0.06] bg-transparent text-muted-foreground text-xs font-semibold flex items-center justify-center gap-1.5 hover:border-white/20 transition-colors"
          >
            View full history in Iron Manager
            <ExternalLink className="w-[13px] h-[13px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Active Deal Card ───────────────────────────────────── */
function ActiveDealCard({ deal }: { deal: RepPipelineDeal }) {
  const stageTag = getStageTagColor(deal.stage);
  const money = formatMoney(deal.amount);
  const closesInDays = deal.expected_close_on
    ? Math.ceil(
        (new Date(deal.expected_close_on).getTime() - Date.now()) / 86_400_000,
      )
    : null;

  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2">
        <Flame className="w-3.5 h-3.5 text-qep-orange" />
        <span className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.1em]">
          Active Deal
        </span>
      </div>
      <div className="bg-[hsl(var(--card))] rounded-[14px] border border-qep-orange/20 p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded ${stageTag}`}
          >
            {deal.stage}
          </span>
          {money && (
            <span className="text-base font-black text-foreground">
              {money}
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-foreground">{deal.deal_name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {closesInDays != null && closesInDays >= 0
            ? `Closes in ${closesInDays} days`
            : deal.days_since_activity != null
              ? `${deal.days_since_activity}d since activity`
              : ""}
          {deal.expected_close_on &&
            ` · Expected: ${new Date(deal.expected_close_on).toLocaleDateString()}`}
        </p>
      </div>
    </section>
  );
}
