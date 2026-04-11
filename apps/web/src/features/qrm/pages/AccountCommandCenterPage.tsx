import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, GitMerge } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AskIronAdvisorButton } from "@/components/primitives";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { QrmActivityTimeline } from "../components/QrmActivityTimeline";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountFleetIntelligenceHref,
  buildAccountGenomeHref,
  buildAccountOperatingProfileHref,
  buildAccountRentalConversionHref,
  buildAccountRelationshipMapHref,
  buildAccountTimelineHref,
  buildAccountWhiteSpaceHref,
} from "../lib/account-command";
import {
  AccountARTab,
  AccountCommercialTab,
  AccountFleetTab,
  AccountNextBestActions,
  AccountPartsTab,
  AccountQuotesTab,
  AccountServiceTab,
} from "../components/Account360Tabs";
import { HealthScorePill } from "../../nervous-system/components/HealthScorePill";
import { HealthScoreDrawer } from "../../nervous-system/components/HealthScoreDrawer";
import { ARCreditBlockBanner } from "../components/ARCreditBlockBanner";
import { CustomerPartsIntelCard } from "../../parts/components/CustomerPartsIntelCard";
import { listCompanyActivities } from "../lib/qrm-api";

export function AccountCommandCenterPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [tab, setTab] = useState<"commercial" | "fleet" | "quotes" | "service" | "parts" | "ar" | "lifecycle">("commercial");
  const [healthDrawerOpen, setHealthDrawerOpen] = useState(false);

  const account360Query = useQuery({
    queryKey: ["account-command", accountId],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const activitiesQuery = useQuery({
    queryKey: ["account-command", accountId, "activities"],
    queryFn: () => listCompanyActivities(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  if (!accountId) {
    return <Navigate to="/qrm/companies" replace />;
  }

  if (account360Query.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="h-32 animate-pulse border-border bg-muted/40" />
        <Card className="h-80 animate-pulse border-border bg-muted/40" />
      </div>
    );
  }

  if (account360Query.isError || !account360Query.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            This account command surface isn&apos;t available right now.
          </p>
        </Card>
      </div>
    );
  }

  const data = account360Query.data;
  const locationLabel = [data.company.city, data.company.state].filter(Boolean).join(", ") || "Account command";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/qrm/companies">
            <ArrowLeft className="h-4 w-4" />
            Back to companies
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/companies/${accountId}`}>Legacy detail</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountTimelineHref(accountId)}>Timeline</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountGenomeHref(accountId)}>Customer Genome</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountOperatingProfileHref(accountId)}>Operating Profile</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountFleetIntelligenceHref(accountId)}>Fleet Intelligence</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountRelationshipMapHref(accountId)}>Relationship Map</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountWhiteSpaceHref(accountId)}>White-Space Map</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountRentalConversionHref(accountId)}>Rental Conversion</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/companies/${accountId}/fleet-radar`}>Fleet Radar</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/admin/duplicates">
              <GitMerge className="mr-2 h-4 w-4" />
              Review Duplicates
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <QrmPageHeader title={data.company.name} subtitle={locationLabel} />
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

          <Card className="p-4">
            <div role="tablist" className="flex flex-wrap gap-1 border-b border-border pb-2">
              {[
                { key: "commercial", label: "Commercial" },
                { key: "fleet", label: `Fleet (${data.fleet.length})` },
                { key: "quotes", label: `Quotes (${data.open_quotes.length})` },
                { key: "service", label: `Service (${data.service.length})` },
                { key: "parts", label: "Parts" },
                { key: "ar", label: `AR (${data.invoices.length})` },
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
                    className={`rounded-md px-3 py-2 text-xs font-medium transition ${
                      isActive
                        ? "bg-qep-orange/10 text-qep-orange"
                        : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              {tab === "commercial" && <AccountCommercialTab data={data} companyId={accountId} />}
              {tab === "fleet" && <AccountFleetTab fleet={data.fleet} companyId={accountId} />}
              {tab === "quotes" && <AccountQuotesTab quotes={data.open_quotes} />}
              {tab === "service" && <AccountServiceTab service={data.service} />}
              {tab === "parts" && <AccountPartsTab parts={data.parts} />}
              {tab === "ar" && <AccountARTab invoices={data.invoices} arBlock={data.ar_block} />}
              {tab === "lifecycle" && (
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Customer lifecycle</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Open the lifecycle view for milestone history, churn markers, and won-back events.
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to={buildAccountTimelineHref(accountId)}>
                        Open timeline <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <CustomerPartsIntelCard companyId={accountId} />

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Recent account activity</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The last touches tied to this account across calls, notes, meetings, and messages.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={`/qrm/companies/${accountId}`}>Open detail</Link>
              </Button>
            </div>
            <div className="mt-4">
              <QrmActivityTimeline
                activities={(activitiesQuery.data ?? []).slice(0, 8)}
                onLogActivity={() => {}}
                entityLabel="account"
                showEntityLabel={false}
              />
            </div>
          </Card>
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
