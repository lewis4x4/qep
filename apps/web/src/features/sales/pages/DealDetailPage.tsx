/**
 * WAVE phase 5 — Sales-rep Deal Detail page.
 *
 * Mobile-first single-column layout for /sales/deals/:dealId. Built
 * fresh — does NOT reuse the admin chrome from QrmDealDetailPage, since
 * that page is heavy management UX. Reps need: amount, next follow-up,
 * customer contact info (tappable tel:/mailto:), entry into the quote
 * builder, and the activity timeline.
 */

import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Mail,
  Phone,
  ArrowRight,
  Calendar,
  Sparkles,
  PlusCircle,
  AlertCircle,
} from "lucide-react";
import { useSalesDealDetail } from "../hooks/useSalesDealDetail";
import { formatCurrency } from "@/lib/format";
import { MobileKpiGrid } from "../components/MobileKpiGrid";
import { MobileStickyActionBar } from "../components/MobileStickyActionBar";

export function DealDetailPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();

  const dealQuery = useSalesDealDetail(dealId);
  const deal = dealQuery.data ?? null;

  return (
    <div className="flex w-full flex-col gap-4 px-4 pb-28 pt-3" data-testid="deal-detail-page">
      {/* Top bar */}
      <div className="flex items-center gap-2 -mx-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.06] bg-foreground/[0.04] hover:border-white/20 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          {dealQuery.isLoading ? (
            <div className="h-5 w-44 animate-pulse rounded bg-foreground/[0.08]" />
          ) : (
            <h1 className="truncate text-base font-semibold text-foreground">
              {deal?.name ?? "Deal"}
            </h1>
          )}
          {deal?.customer.name && (
            <p className="truncate text-xs text-muted-foreground">
              {deal.customer.name}
            </p>
          )}
        </div>
      </div>

      {dealQuery.isError ? (
        <div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 flex items-center gap-2"
          data-testid="deal-detail-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {dealQuery.error instanceof Error
            ? dealQuery.error.message
            : "We couldn't load this deal."}
        </div>
      ) : !deal && !dealQuery.isLoading ? (
        <div
          className="rounded-2xl border border-white/[0.06] bg-foreground/[0.04] p-6 text-center"
          data-testid="deal-detail-empty"
        >
          <p className="text-sm text-muted-foreground">
            Deal not found, or you don't have access.
          </p>
          <Link
            to="/sales/pipeline"
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-qep-orange"
          >
            Back to pipeline <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <MobileKpiGrid
            items={[
              {
                id: "amount",
                label: "Amount",
                value:
                  deal?.amount != null ? formatCurrency(deal.amount) : "—",
                tone: "orange",
              },
              {
                id: "margin",
                label: "Margin",
                value:
                  deal?.marginPct != null
                    ? `${deal.marginPct.toFixed(1)}%`
                    : "—",
              },
              {
                id: "follow-up",
                label: "Follow-up",
                value: formatRelativeDate(deal?.nextFollowUpAt),
                tone:
                  isOverdue(deal?.nextFollowUpAt) ? "danger" : "default",
                caption: deal?.nextFollowUpAt
                  ? formatExactDate(deal.nextFollowUpAt)
                  : undefined,
              },
              {
                id: "last-touch",
                label: "Last touch",
                value: formatRelativeDate(deal?.lastActivityAt),
              },
            ]}
          />

          {/* Customer card */}
          {deal?.customer && (
            <section
              className="rounded-2xl border border-white/[0.06] bg-foreground/[0.04] p-4"
              data-testid="deal-detail-customer"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Customer
              </p>
              <p className="mt-1 text-base font-semibold text-foreground">
                {deal.customer.name}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {deal.customer.phone && (
                  <a
                    href={`tel:${deal.customer.phone}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-foreground/[0.04] px-3 py-2 text-xs font-semibold text-foreground hover:border-qep-orange/60 hover:text-qep-orange transition-colors"
                    data-testid="deal-detail-tel"
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                    {deal.customer.phone}
                  </a>
                )}
                {deal.customer.email && (
                  <a
                    href={`mailto:${deal.customer.email}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-foreground/[0.04] px-3 py-2 text-xs font-semibold text-foreground hover:border-qep-orange/60 hover:text-qep-orange transition-colors"
                    data-testid="deal-detail-mailto"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    Email
                  </a>
                )}
                {deal.customer.id && (
                  <Link
                    to={`/sales/customers/${deal.customer.id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:border-cyan-400/60 transition-colors"
                  >
                    Open customer <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                )}
              </div>
            </section>
          )}

          {/* Active quote / start new */}
          <section
            className="rounded-2xl border border-qep-orange/20 bg-qep-orange/10 p-4"
            data-testid="deal-detail-quote-card"
          >
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 text-qep-orange shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Start a new quote
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Pre-fills with the customer and deal context from this view.
                </p>
              </div>
            </div>
            <Link
              to={`/sales/quotes/new?crm_deal_id=${encodeURIComponent(dealId ?? "")}`}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-qep-orange px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-qep-orange/30 active:scale-[0.98] transition-all"
            >
              Open Quote Builder
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </section>

          {/* Activity timeline */}
          <section
            className="rounded-2xl border border-white/[0.06] bg-foreground/[0.04] p-4"
            data-testid="deal-detail-activity"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Recent activity
              </p>
              <button
                type="button"
                onClick={() => navigate("/sales/capture")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-qep-orange"
              >
                <PlusCircle className="h-3.5 w-3.5" aria-hidden />
                Log
              </button>
            </div>
            {deal?.activities.length ? (
              <ul className="mt-3 flex flex-col gap-2.5">
                {deal.activities.slice(0, 12).map((activity) => (
                  <li
                    key={activity.id}
                    className="rounded-xl border border-white/[0.04] bg-foreground/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground capitalize">
                        {activity.type.replace(/_/g, " ")}
                      </span>
                      {activity.occurredAt && (
                        <span className="text-[11px] text-muted-foreground">
                          {formatExactDate(activity.occurredAt)}
                        </span>
                      )}
                    </div>
                    {activity.body && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                        {activity.body}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                No activity yet. Tap "Log" to capture a touchpoint.
              </p>
            )}
          </section>
        </>
      )}

      {/* Sticky bottom actions */}
      <MobileStickyActionBar
        secondary={
          <button
            type="button"
            onClick={() => navigate("/sales/capture")}
            className="inline-flex h-12 items-center gap-1.5 rounded-full border border-white/[0.06] bg-foreground/[0.04] px-4 text-sm font-semibold text-foreground hover:border-white/20 transition-colors"
          >
            <Calendar className="h-4 w-4" aria-hidden />
            Log
          </button>
        }
        primary={
          <Link
            to={`/sales/quotes/new?crm_deal_id=${encodeURIComponent(dealId ?? "")}`}
            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-full bg-qep-orange text-sm font-semibold text-white shadow-sm shadow-qep-orange/30 active:scale-[0.98] transition-all"
          >
            Open Quote Builder
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      />

    </div>
  );
}

function formatExactDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = ts - Date.now();
  const absDays = Math.abs(Math.round(diff / 86_400_000));
  if (absDays === 0) return "Today";
  if (diff > 0) return `In ${absDays}d`;
  return `${absDays}d ago`;
}

function isOverdue(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}
