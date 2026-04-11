import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Clock3,
  PackagePlus,
  Radar,
  Timer,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { supabase } from "@/lib/supabase";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildAccountCommandHref,
  buildAccountFleetIntelligenceHref,
  buildAccountGenomeHref,
  buildAccountOperatingProfileHref,
} from "../lib/account-command";
import { buildFleetIntelligenceBoard } from "../lib/fleet-intelligence";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

function formatDate(value: string | null): string {
  if (!value) return "No prediction";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No prediction";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function replacementWindowLabel(value: "now" | "30d" | "60d" | "90d" | "future" | "none"): string {
  switch (value) {
    case "now":
      return "Now";
    case "30d":
      return "30 days";
    case "60d":
      return "60 days";
    case "90d":
      return "90 days";
    case "future":
      return "Future";
    default:
      return "Unmodeled";
  }
}

function replacementWindowTone(value: "now" | "30d" | "60d" | "90d" | "future" | "none"): string {
  switch (value) {
    case "now":
      return "text-red-400";
    case "30d":
      return "text-amber-400";
    case "60d":
    case "90d":
      return "text-qep-orange";
    default:
      return "text-muted-foreground";
  }
}

export function FleetIntelligencePage() {
  const { accountId } = useParams<{ accountId: string }>();

  const accountQuery = useQuery({
    queryKey: ["fleet-intelligence", accountId, "account"],
    queryFn: () => fetchAccount360(accountId!),
    enabled: Boolean(accountId),
    staleTime: 30_000,
  });

  const profileQuery = useQuery({
    queryKey: ["fleet-intelligence", accountId, "profile"],
    enabled: Boolean(accountQuery.data?.profile?.id),
    queryFn: () =>
      fetchCustomerProfile({
        customerProfileId: accountQuery.data?.profile?.id,
        includeFleet: true,
      }),
    staleTime: 30_000,
  });

  const equipmentQuery = useQuery({
    queryKey: ["fleet-intelligence", accountId, "equipment"],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_equipment")
        .select("id, metadata")
        .eq("company_id", accountId!)
        .eq("ownership", "customer_owned")
        .is("deleted_at", null)
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => {
        const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
        const attachments = Array.isArray(metadata.attachments) ? metadata.attachments.filter((item) => item != null) : [];
        return {
          equipmentId: row.id,
          attachmentCount: attachments.length,
        };
      });
    },
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
          <p className="text-sm text-muted-foreground">This fleet intelligence surface isn&apos;t available right now.</p>
        </Card>
      </div>
    );
  }

  const account = accountQuery.data;
  const board = buildFleetIntelligenceBoard({
    fleet: account.fleet,
    service: account.service,
    predictions: profileQuery.data?.fleet ?? [],
    equipmentMetadata: equipmentQuery.data ?? [],
  });

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
            <Link to={buildAccountGenomeHref(accountId)}>Customer Genome</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountOperatingProfileHref(accountId)}>Operating Profile</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/companies/${accountId}/fleet-radar`}>Legacy Fleet Radar</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Fleet Intelligence`}
        subtitle="Owned machines, age, hours, attachment gaps, and replacement windows in one account-level fleet surface."
      />
      <QrmSubNav />

      {profileQuery.isError || equipmentQuery.isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : equipmentQuery.error instanceof Error
              ? equipmentQuery.error.message
              : "Fleet intelligence is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryCard
              icon={Radar}
              label="Owned Machines"
              value={String(board.summary.ownedMachines)}
              detail="Account-owned equipment on file."
            />
            <SummaryCard
              icon={Clock3}
              label="Average Age"
              value={board.summary.avgAgeYears != null ? `${board.summary.avgAgeYears.toFixed(1)}y` : "—"}
              detail="Average machine age across the owned fleet."
            />
            <SummaryCard
              icon={PackagePlus}
              label="Attachment Gaps"
              value={String(board.summary.attachmentGaps)}
              detail="Machines without registered attachments."
              tone={board.summary.attachmentGaps > 0 ? "warn" : "default"}
            />
            <SummaryCard
              icon={Timer}
              label="Replacement Windows"
              value={String(board.summary.replacementWindowMachines)}
              detail="Machines entering 0-90 day replacement windows."
              tone={board.summary.replacementWindowMachines > 0 ? "warn" : "default"}
            />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Fleet queue</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ranked by replacement window first, then confidence, hours, and age so the riskiest units surface first.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={buildAccountFleetIntelligenceHref(accountId)}>Refresh queue</Link>
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {profileQuery.isLoading || equipmentQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading fleet signals…</p>
              ) : board.machines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No owned machines are on file for this account yet.</p>
              ) : (
                board.machines.map((machine) => (
                  <div key={machine.equipmentId} className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{machine.label}</p>
                          <span className={`text-[11px] font-medium ${replacementWindowTone(machine.replacementWindow)}`}>
                            {replacementWindowLabel(machine.replacementWindow)}
                          </span>
                          {machine.replacementConfidence != null ? (
                            <span className="text-[11px] text-muted-foreground">
                              {Math.round(machine.replacementConfidence * 100)}% confidence
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {machine.serialNumber ? `S/N ${machine.serialNumber}` : "Serial unknown"}
                          {machine.ageYears != null ? ` · ${machine.ageYears} years old` : ""}
                          {machine.engineHours != null ? ` · ${Math.round(machine.engineHours).toLocaleString()}h` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {machine.attachmentCount} attachment{machine.attachmentCount === 1 ? "" : "s"}
                          {machine.hasAttachmentGap ? " · attachment gap" : ""}
                          {machine.serviceCount > 0 ? ` · ${machine.serviceCount} service touch${machine.serviceCount === 1 ? "" : "es"}` : ""}
                          {machine.openServiceCount > 0 ? ` · ${machine.openServiceCount} open service` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Replacement date: {formatDate(machine.predictedReplacementDate)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/equipment/${machine.equipmentId}`}>
                            Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={buildAccountCommandHref(accountId)}>
                            Account <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-400" : "text-qep-orange"}`} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
