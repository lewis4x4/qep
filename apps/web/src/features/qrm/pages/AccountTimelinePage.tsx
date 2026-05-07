import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { QrmAccountActivitySection } from "../components/QrmAccountActivitySection";
import { QrmAccountDetailMenu } from "../components/QrmAccountDetailMenu";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface } from "../components/command-deck";
import { fetchAccount360 } from "../lib/account-360-api";
import { buildAccountCommandHref } from "../lib/account-command";

export function AccountTimelinePage() {
  const { accountId } = useParams<{ accountId: string }>();
  const { profile, user } = useAuth();

  const accountQuery = useQuery({
    queryKey: ["account-timeline", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  if (!accountId) {
    return <Navigate to="/qrm/companies" replace />;
  }

  if (accountQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">This account timeline surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  const accountName = accountQuery.data.company.name;
  const locationLabel = [accountQuery.data.company.city, accountQuery.data.company.state]
    .filter(Boolean)
    .join(", ") || "Account timeline";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Button asChild variant="outline" className="min-h-[44px] w-fit gap-2">
          <Link to={buildAccountCommandHref(accountId)}>
            <ArrowLeft className="h-4 w-4" />
            Back to account
          </Link>
        </Button>
        <QrmAccountDetailMenu accountId={accountId} />
      </div>

      <QrmPageHeader
        title={`${accountName} — Timeline`}
        subtitle={`Full activity history and lifecycle context for ${locationLabel}.`}
        crumb={{ surface: "GRAPH", lens: "TIMELINE", count: accountId.slice(0, 8) }}
      />
      <QrmSubNav />

      <QrmAccountActivitySection
        accountId={accountId}
        accountName={accountName}
        currentUserId={profile?.id ?? user?.id ?? null}
        queryKey={["account-timeline", accountId, "activities"]}
        title="Account activity timeline"
        description="All logged calls, notes, meetings, tasks, and communications tied to this account."
      />
    </div>
  );
}
