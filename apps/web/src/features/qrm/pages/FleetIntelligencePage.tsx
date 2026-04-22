import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Clock3, PackagePlus, Radar, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { fetchAccount360 } from "../lib/account-360-api";
import { fetchCustomerProfile } from "@/features/dge/lib/dge-api";
import { buildAccountCommandHref, buildAccountFleetIntelligenceHref, buildAccountGenomeHref, buildAccountOperatingProfileHref } from "../lib/account-command";
import { QrmSubNav } from "../components/QrmSubNav";

function replacementWindowTone(value: "now" | "30d" | "60d" | "90d" | "future" | "none"): string {
  switch (value) {
    case "now":
      return "text-red-400";
    case "30d":
      return "text-amber-400";
    case "60d":
      return "text-qep-orange";
    case "90d":
      return "text-emerald-400";
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
        const metadata = (row.metadata && typeof row.metadata === "object"
          ? row.metadata
          : {}) as Record<string, unknown>;
        const attachments = Array.isArray(metadata.attachments)
          ? metadata.attachments.filter((item) => item != null)
          : [];
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
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (accountQuery.isError || !accountQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">This fleet intelligence surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  const account = accountQuery.data;
  const board = {
    fleet: equipmentQuery.data ?? [],
    serviceJobs: account.service ?? [],
  };

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
            <Link to={buildAccountFleetIntelligenceHref(accountId)}>Refresh intelligence</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountGenomeHref(accountId)}>Customer Genome</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={buildAccountOperatingProfileHref(accountId)}>Operating Profile</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={`${account.company.name} — Fleet Intelligence`}
        subtitle="Owned machines, age, hours, attachment gaps, and replacement windows in one account-level fleet surface."
      />
      <QrmSubNav />

      {profileQuery.isLoading || equipmentQuery.isLoading ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center text-sm text-muted-foreground">Loading fleet intelligence…</DeckSurface>
      ) : profileQuery.isError || equipmentQuery.isError ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : equipmentQuery.error instanceof Error
              ? equipmentQuery.error.message
                : "Fleet intelligence is unavailable right now."}
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <PackagePlus className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Owned Machines</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.fleet.length)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Account-owned equipment on file.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Average Age</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">N/A</p>
              <p className="mt-1 text-xs text-muted-foreground">No service hours are tracked in the fleet table.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Service Jobs</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.serviceJobs.length)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Active service jobs associated with this account.</p>
            </DeckSurface>
            <DeckSurface className={`p-4 ${board.fleet.length > 0 ? "" : "border-qep-warm/40"}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`h-4 w-4 ${board.fleet.length > 0 ? "text-qep-warm" : "text-qep-orange"}`} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Attachment Gaps</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.fleet.filter(m => m.attachmentCount > 0).length)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Machines without registered attachments in the system.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Replacement Windows</p>
              </div>
              <div className="mt-3 space-y-3">
                {board.fleet.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No fleet data available to assess replacement windows.</p>
                ) : (
                  board.fleet.map((machine) => (
                    <div key={machine.equipmentId} className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">
                              {machine.label ?? `S/N ${machine.make} ${machine.model}`}
                            </p>
                            {machine.attachmentCount > 0 ? (
                              <span className={`text-[11px] font-medium text-qep-warm`}>
                                Attachment gap
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 space-y-1">
                            {machine.serialNumber ? (
                              <p className="text-xs text-muted-foreground">
                                S/N {machine.serialNumber}
                              </p>
                            ) : null}
                            {machine.ageYears != null ? (
                              <p className="text-xs text-muted-foreground">
                                {machine.ageYears} years old
                              </p>
                            ) : null}
                            {machine.engineHours != null ? (
                              <p className="text-xs text-muted-foreground">
                                {Math.round(machine.engineHours).toLocaleString()}h
                              </p>
                            ) : null}
                            <div className="mt-3">
                              {machine.serviceCount > 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {machine.serviceCount} service touch{machine.serviceCount === 1 ? "" : "es"}
                                </p>
                              ) : null}
                              {machine.openServiceCount > 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {machine.openServiceCount} open service
                                </p>
                              ) : null}
                            </div>
                            {machine.predictedReplacementDate ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Replacement: {new Date(machine.predictedReplacementDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/equipment/${machine.equipmentId}`}>
                            Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))
                )}
            </div>
          </DeckSurface>
          </div>
        </>
      )}
    </div>
  );
}
