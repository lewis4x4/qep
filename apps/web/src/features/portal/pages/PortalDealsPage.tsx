import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BriefcaseBusiness, CalendarDays, FileText } from "lucide-react";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi, type PortalActiveDeal } from "../lib/portal-api";

function formatMoney(value: number | null): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPortalDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusTone(label: string): string {
  if (/accepted|confirmed|completed/i.test(label)) return "bg-emerald-500/10 text-emerald-400";
  if (/declined|closed/i.test(label)) return "bg-red-500/10 text-red-400";
  if (/review|quote/i.test(label)) return "bg-blue-500/10 text-blue-400";
  return "bg-amber-500/10 text-amber-400";
}

export function PortalDealsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "active-deals"],
    queryFn: portalApi.getActiveDeals,
    staleTime: 30_000,
  });

  const deals = (data?.deals ?? []) as PortalActiveDeal[];

  return (
    <PortalLayout>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <BriefcaseBusiness className="h-5 w-5 text-qep-orange" aria-hidden />
          <h1 className="text-xl font-bold text-foreground">Active Deals</h1>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The commercial work your dealership is actively moving forward for your account.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-28 animate-pulse" />)}
        </div>
      )}

      {isError && (
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load active deals.</p>
        </Card>
      )}

      <div className="space-y-3">
        {deals.map((deal) => {
          const eta = formatPortalDate(deal.portal_status.eta);
          const expectedClose = formatPortalDate(deal.expected_close_on);
          const nextFollowUp = formatPortalDate(deal.next_follow_up_at);
          const lastUpdated = formatPortalDate(deal.portal_status.last_updated_at);
          const amount = formatMoney(deal.amount);

          return (
            <Card key={deal.deal_id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(deal.portal_status.label)}`}>
                      {deal.portal_status.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{deal.portal_status.source_label}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground truncate">{deal.deal_name}</p>
                  {amount && (
                    <p className="mt-1 text-xs text-muted-foreground">Value: <span className="text-foreground font-medium">{amount}</span></p>
                  )}
                </div>
                {deal.quote_review_id && (
                  <Button asChild size="sm">
                    <Link to={`/portal/quotes#${deal.quote_review_id}`}>
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      Open quote
                    </Link>
                  </Button>
                )}
              </div>

              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                {eta && (
                  <p><CalendarDays className="mr-1 inline h-3.5 w-3.5" /> ETA: <span className="text-foreground font-medium">{eta}</span></p>
                )}
                {expectedClose && (
                  <p>Expected close: <span className="text-foreground font-medium">{expectedClose}</span></p>
                )}
                {nextFollowUp && (
                  <p>Next update: <span className="text-foreground font-medium">{nextFollowUp}</span></p>
                )}
                {lastUpdated && (
                  <p>Last updated: <span className="text-foreground font-medium">{lastUpdated}</span></p>
                )}
              </div>

              {deal.portal_status.next_action && (
                <div className="mt-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next action</p>
                  <p className="mt-1 text-sm text-foreground">{deal.portal_status.next_action}</p>
                </div>
              )}
            </Card>
          );
        })}

        {!isLoading && deals.length === 0 && (
          <Card className="border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">No active deals to review right now.</p>
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
