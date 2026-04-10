import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Brain, CalendarDays, Dna, MapPinned } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomerInsightCard } from "@/features/dge/components/CustomerInsightCard";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountGenomeHref,
  buildAccountOperatingProfileHref,
  buildAccountTimelineHref,
} from "../lib/account-command";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function monthLabel(month: number | null | undefined): string | null {
  if (!month || month < 1 || month > 12) return null;
  return new Date(2000, month - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

export function CustomerGenomePage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["customer-genome", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const genomeQuery = useQuery({
    queryKey: ["customer-genome", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: true,
      }),
    staleTime: 30_000,
  });

  if (!accountId) {
    return <Navigate to="/qrm/companies" replace />;
  }

  if (accountQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="h-32 animate-pulse border-border bg-muted/40" />
        <Card className="h-80 animate-pulse border-border bg-muted/40" />
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <Card className="border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">This customer genome surface isn&apos;t available right now.</p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const genome = genomeQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to={buildAccountCommandHref(accountId)}>
            <ArrowLeft className="h-4 w-4" />
            Back to account
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountTimelineHref(accountId)}>Timeline</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountCommandHref(accountId)}>Account Command</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountOperatingProfileHref(accountId)}>Operating Profile</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/companies/${accountId}`}>Legacy detail</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Customer Genome`}
        subtitle="Multi-dimensional customer profile built from the live customer DNA model."
      />
      <QrmSubNav />

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <CustomerInsightCard
            data={genome ?? null}
            loading={genomeQuery.isLoading}
            error={genomeQuery.error instanceof Error ? genomeQuery.error.message : null}
            onRefresh={async () => {
              await genomeQuery.refetch();
            }}
          />

          {genome && (
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Dna className="h-4 w-4 text-qep-orange" />
                <h2 className="text-sm font-semibold text-foreground">Genome facets</h2>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <GenomeStat icon={Dna} label="Industry" value={genome.industry ?? "Unknown"} />
                <GenomeStat icon={MapPinned} label="Region" value={genome.region ?? "Unknown"} />
                <GenomeStat
                  icon={CalendarDays}
                  label="Budget Cycle"
                  value={monthLabel(genome.budget_cycle_month) ?? "Unknown"}
                />
                <GenomeStat
                  icon={CalendarDays}
                  label="Fiscal Year End"
                  value={monthLabel(genome.fiscal_year_end_month) ?? "Unknown"}
                />
              </div>
              {genome.budget_cycle_notes && (
                <p className="mt-4 text-sm text-muted-foreground">{genome.budget_cycle_notes}</p>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-qep-orange" />
              <h2 className="text-sm font-semibold text-foreground">Profile context</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <GenomeLine label="Account" value={account.company.name} />
              <GenomeLine label="Health score" value={account.health?.current_score != null ? String(Math.round(account.health.current_score)) : "Not scored"} />
              <GenomeLine label="Fleet" value={String(account.fleet.length)} />
              <GenomeLine label="Open quotes" value={String(account.open_quotes.length)} />
              <GenomeLine label="Service jobs" value={String(account.service.length)} />
              <GenomeLine label="Parts orders" value={String(account.parts.order_count)} />
            </div>
          </Card>

          {genome?.notes && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-foreground">Notes</h2>
              <p className="mt-3 text-sm text-muted-foreground">{genome.notes}</p>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next step</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Customer Genome is the profile layer. The command center remains the operating layer.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountCommandHref(accountId)}>
                  Open account command <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical route</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use Customer Genome for profile truth, then shift back to account command for active operating work.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to={buildAccountGenomeHref(accountId)}>Refresh genome</Link>
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Next 7B surface</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open Customer Operating Profile to see how this account actually buys and works in the field.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountOperatingProfileHref(accountId)}>
                  Operating profile <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function GenomeStat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-base font-medium text-foreground">{value}</p>
    </div>
  );
}

function GenomeLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
