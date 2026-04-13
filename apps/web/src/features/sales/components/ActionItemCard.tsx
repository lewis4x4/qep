import { useNavigate } from "react-router-dom";
import { Clock, PhoneCall, Mail } from "lucide-react";
import type { PriorityAction, RepPipelineDeal } from "../lib/types";

/* ── Severity classification ─────────────────────────── */
interface SeverityConfig {
  stripe: string;
  tagBg: string;
  tagText: string;
  urgencyText: string;
  label: string;
}

function classify(type: string): SeverityConfig {
  switch (type) {
    case "follow_up_overdue":
      return {
        stripe: "bg-red-500",
        tagBg: "bg-red-500/15",
        tagText: "text-red-400",
        urgencyText: "text-red-400",
        label: "Overdue Follow-up",
      };
    case "closing_soon":
      return {
        stripe: "bg-amber-500",
        tagBg: "bg-amber-500/15",
        tagText: "text-amber-400",
        urgencyText: "text-amber-400",
        label: "Closing Soon",
      };
    case "going_cold":
    case "cooling":
      return {
        stripe: "bg-red-500",
        tagBg: "bg-red-500/15",
        tagText: "text-red-400",
        urgencyText: "text-red-400",
        label: "Re-engagement",
      };
    default:
      return {
        stripe: "bg-amber-500",
        tagBg: "bg-amber-500/15",
        tagText: "text-amber-400",
        urgencyText: "text-amber-400",
        label: type
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      };
  }
}

/* ── Urgency badge text ──────────────────────────────── */
function getUrgencyText(
  type: string,
  deal?: RepPipelineDeal | null,
): string {
  if (type === "follow_up_overdue" && deal?.next_follow_up_at) {
    const days = Math.floor(
      (Date.now() - new Date(deal.next_follow_up_at).getTime()) / 86_400_000,
    );
    if (days > 0) return `${days}d overdue`;
  }
  if (type === "closing_soon" && deal?.expected_close_on) {
    const days = Math.ceil(
      (new Date(deal.expected_close_on).getTime() - Date.now()) / 86_400_000,
    );
    if (days >= 0) return `Closes in ${days}d`;
  }
  if (deal?.days_since_activity != null && deal.days_since_activity > 0) {
    return `${deal.days_since_activity}d silent`;
  }
  return "";
}

/* ── CTA label ───────────────────────────────────────── */
function getCtaLabel(deal?: RepPipelineDeal | null): {
  label: string;
  icon: "phone" | "mail";
} {
  const firstName = deal?.primary_contact_name?.split(" ")[0];
  if (deal?.primary_contact_phone && firstName)
    return { label: `Call ${firstName}`, icon: "phone" };
  if (firstName) return { label: `Email ${firstName}`, icon: "mail" };
  return { label: "Follow up", icon: "phone" };
}

/* ── Currency format ─────────────────────────────────── */
function formatMoney(amount: number | null | undefined): string {
  if (amount == null) return "";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

/* ── Component ───────────────────────────────────────── */
export function ActionItemCard({
  action,
  deal,
}: {
  action: PriorityAction;
  deal?: RepPipelineDeal | null;
}) {
  const navigate = useNavigate();
  const sev = classify(action.type);
  const urgency = getUrgencyText(action.type, deal);
  const cta = getCtaLabel(deal);
  const money = formatMoney(deal?.amount);

  return (
    <button
      onClick={() => {
        if (deal?.company_id) navigate(`/sales/customers/${deal.company_id}`);
        else if (action.deal_id) navigate("/sales/pipeline");
      }}
      className="w-full text-left relative bg-[hsl(var(--card))] rounded-xl border border-white/[0.06] overflow-hidden transition-all duration-200 hover:border-white/20 hover:shadow-lg hover:shadow-black/20"
    >
      {/* Left severity stripe */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${sev.stripe}`} />

      <div className="pl-5 pr-4 py-4">
        {/* Header: tag + urgency + money */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded ${sev.tagBg} ${sev.tagText} text-[10px] font-semibold uppercase tracking-wide`}
            >
              {sev.label}
            </span>
            {urgency && (
              <span
                className={`inline-flex items-center gap-1 ${sev.urgencyText} text-[11px] font-medium`}
              >
                <Clock className="w-2.5 h-2.5" />
                {urgency}
              </span>
            )}
          </div>
          {money && (
            <span className="text-sm font-bold text-foreground shrink-0">
              {money}
            </span>
          )}
        </div>

        {/* Customer + equipment */}
        <p className="text-base font-bold text-foreground mt-2">
          {action.customer_name ?? "Priority"}
        </p>
        {deal?.deal_name && (
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {deal.deal_name}
          </p>
        )}

        {/* AI note */}
        {action.summary && (
          <div className="bg-foreground/[0.04] rounded-lg px-3 py-2 mt-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {action.summary}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div
          className="flex items-center gap-2 mt-3"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 bg-qep-orange text-white text-sm font-semibold rounded-lg active:scale-[0.98] transition-transform cursor-pointer">
            {cta.icon === "phone" ? (
              <PhoneCall className="w-3.5 h-3.5" />
            ) : (
              <Mail className="w-3.5 h-3.5" />
            )}
            {cta.label}
          </span>
          <span className="px-4 py-2.5 bg-foreground/[0.06] text-muted-foreground text-sm font-medium rounded-lg cursor-pointer active:scale-[0.98] transition-transform">
            Snooze
          </span>
        </div>
      </div>
    </button>
  );
}
