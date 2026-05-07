import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AskIronAdvisorButton } from "@/components/primitives";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { QrmAccountActivitySection } from "../components/QrmAccountActivitySection";
import { QrmAccountDetailMenu } from "../components/QrmAccountDetailMenu";
import { fetchAccount360, type Account360Response } from "../lib/account-360-api";
import { buildAccountTimelineHref } from "../lib/account-command";
import {
  AccountARTab,
  AccountCommercialTab,
  AccountFleetTab,
  AccountIntelliDealerTab,
  AccountNextBestActions,
  AccountPartsTab,
  AccountQuotesTab,
  AccountServiceTab,
} from "../components/Account360Tabs";
import { HealthScorePill } from "../../nervous-system/components/HealthScorePill";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { ARCreditBlockBanner } from "../components/ARCreditBlockBanner";
import { CustomerPartsIntelCard } from "../../parts/components/CustomerPartsIntelCard";
import { DeckSurface } from "../components/command-deck";
import { useAuth } from "@/hooks/useAuth";
import type { QrmActivityEmptyStateCue } from "../components/QrmActivityTimeline";

const compactNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function daysSince(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function buildAccountActivityEmptyStateCue(data: Account360Response, timelineHref: string): QrmActivityEmptyStateCue {
  const accountName = data.company.name;
  const lastTouchDays = daysSince(data.profile?.last_interaction_at);
  const headline = lastTouchDays == null
    ? `No activity recorded yet for ${accountName}.`
    : `No logged touch in ${lastTouchDays} days for ${accountName}.`;

  if (data.ar_block?.status === "active") {
    const aging = data.ar_block.current_max_aging_days;
    return {
      headline,
      suggestion: `Iron cue from Account-360: AR is actively blocked${aging != null ? ` at ${aging} aging days` : ""}; start with a service-safe call before quoting, rental, or parts promises.`,
      primaryLabel: "Start AR-safe call",
      primaryActivityType: "call",
      seeTimelineHref: timelineHref,
    };
  }

  const expiringQuote = [...data.open_quotes]
    .filter((quote) => quote.expires_at)
    .sort((left, right) => new Date(left.expires_at ?? 0).getTime() - new Date(right.expires_at ?? 0).getTime())[0];
  if (expiringQuote) {
    return {
      headline,
      suggestion: `Iron cue from Account-360: an open quote${expiringQuote.deal_name ? ` for ${expiringQuote.deal_name}` : ""} is closest to expiration; call to confirm scope, timing, and decision blockers.`,
      primaryLabel: "Start quote call",
      primaryActivityType: "call",
      seeTimelineHref: timelineHref,
    };
  }

  const highHourFleet = [...data.fleet]
    .filter((unit) => typeof unit.engine_hours === "number")
    .sort((left, right) => (right.engine_hours ?? 0) - (left.engine_hours ?? 0))[0];
  if (highHourFleet && (highHourFleet.engine_hours ?? 0) >= 2_500) {
    return {
      headline,
      suggestion: `Iron cue from visible fleet data: ${highHourFleet.name} shows ${compactNumber.format(highHourFleet.engine_hours ?? 0)} engine hours; log a fleet-health call before this becomes reactive service work.`,
      primaryLabel: "Start fleet call",
      primaryActivityType: "call",
      seeTimelineHref: timelineHref,
    };
  }

  const scheduledService = data.service.find((job) => job.scheduled_start_at || job.customer_problem_summary);
  if (scheduledService) {
    return {
      headline,
      suggestion: `Iron cue from service context: capture the customer expectation around ${scheduledService.customer_problem_summary ?? "the next scheduled service step"} so Sales, Parts, and Service share one account memory.`,
      primaryLabel: "Add service note",
      primaryActivityType: "note",
      seeTimelineHref: timelineHref,
    };
  }

  return {
    headline,
    suggestion: "QEP cue: start with a quick call or note that captures current fleet, parts, rental, or service intent. No AI action will run until an operator records real context.",
    primaryLabel: "Start first touch",
    primaryActivityType: "call",
    seeTimelineHref: timelineHref,
  };
}

export function AccountCommandCenterPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const { profile, user } = useAuth();
  const [tab, setTab] = useState<"commercial" | "fleet" | "quotes" | "service" | "parts" | "ar" | "intellidealer" | "lifecycle">("commercial");
  const [healthDrawerOpen, setHealthDrawerOpen] = useState(false);

  const account360Query = useQuery({
    queryKey: ["account-command", accountId],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });


  if (!accountId) {
    return <Navigate to="/qrm/companies" replace />;
  }

  if (account360Query.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (account360Query.isError || !account360Query.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This account command surface isn&apos;t available right now.
          </p>
        </DeckSurface>
      </div>
    );
  }

  const data = account360Query.data;
  const locationLabel = [data.company.city, data.company.state].filter(Boolean).join(", ") || "Account command";
  const accountTimelineHref = buildAccountTimelineHref(accountId);
  const activityEmptyStateCue = buildAccountActivityEmptyStateCue(data, accountTimelineHref);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/qrm/companies">
            <ArrowLeft className="h-4 w-4" />
            Back to companies
          </Link>
        </Button>
        <QrmAccountDetailMenu accountId={accountId} />
      </div>

      <div className="flex items-start justify-between gap-3">
        <QrmPageHeader
          title={data.company.name}
          subtitle={locationLabel}
          crumb={{ surface: "GRAPH", lens: "COMMAND", count: accountId?.slice(0, 8) }}
        />
        <div className="flex items-center gap-2">
          <HealthScorePill
            score={data.health?.current_score != null ? Number(data.health.current_score) : null}
            delta7d={data.health?.delta_7d != null ? Number(data.health.delta_7d) : null}
            size="md"
            onClick={() => setHealthDrawerOpen(true)}
          />
          <AskIronAdvisorButton contextType="company" contextId={accountId} variant="inline" />
        </div>
      </div>

      <QrmSubNav />

      {data.ar_block && (
        <ARCreditBlockBanner
          block={data.ar_block}
          onOverridden={() => account360Query.refetch()}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <AccountNextBestActions data={data} />

          <DeckSurface>
            <div className="border-b border-qep-deck-rule/60 pb-2">
              <div role="tablist" className="flex flex-wrap gap-1">
                {[
                  { key: "commercial", label: "Commercial" },
                  { key: "fleet", label: `Fleet (${data.fleet.length})` },
                  { key: "quotes", label: `Quotes (${data.open_quotes.length})` },
                  { key: "service", label: `Service (${data.service.length})` },
                  { key: "parts", label: "Parts" },
                  { key: "ar", label: `AR (${data.invoices.length})` },
                  { key: "intellidealer", label: "IntelliDealer" },
                  { key: "lifecycle", label: "Lifecycle" },
                ].map((item) => {
                  const isActive = item.key === tab;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setTab(item.key as typeof tab)}
                      className={`rounded-sm px-3 py-2 text-xs font-medium transition-colors ${
                        isActive
                          ? "bg-qep-orange/10 text-qep-orange"
                          : "text-muted-foreground hover:bg-qep-deck-elevated/30 hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              {tab === "commercial" && <AccountCommercialTab data={data} companyId={accountId} />}
              {tab === "fleet" && <AccountFleetTab fleet={data.fleet} companyId={accountId} />}
              {tab === "quotes" && <AccountQuotesTab quotes={data.open_quotes} />}
              {tab === "service" && <AccountServiceTab service={data.service} />}
              {tab === "parts" && <AccountPartsTab parts={data.parts} />}
              {tab === "ar" && <AccountARTab invoices={data.invoices} arBlock={data.ar_block} />}
              {tab === "intellidealer" && <AccountIntelliDealerTab companyId={accountId} />}
              {tab === "lifecycle" && (
                <DeckSurface className="border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Customer lifecycle</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Open the lifecycle view for milestone history, churn markers, and won-back events.
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/qrm/companies/${accountId}/lifecycle`}>
                        Open lifecycle <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </DeckSurface>
              )}
            </div>
          </DeckSurface>
        </div>

        <div className="space-y-3">
          <CustomerPartsIntelCard companyId={accountId} />

          <QrmAccountActivitySection
            accountId={accountId}
            accountName={data.company.name}
            currentUserId={profile?.id ?? user?.id ?? null}
            queryKey={["account-command", accountId, "activities"]}
            limit={8}
            title="Recent account activity"
            description="The last touches tied to this account across calls, notes, meetings, and messages."
            emptyStateCue={activityEmptyStateCue}
          />
        </div>
      </div>

      <HealthScoreDrawer
        customerProfileId={(data.profile?.id as string | undefined) ?? null}
        open={healthDrawerOpen}
        onOpenChange={setHealthDrawerOpen}
      />
    </div>
  );
}
