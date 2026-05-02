import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Building2, Clock3, Truck, Wrench } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useBranchBySlug } from "@/hooks/useBranches";
import { DeckSurface } from "../components/command-deck";
import { QrmPageHeader } from "../components/QrmPageHeader";
import {
  normalizeBranchIntakeRows,
  normalizeBranchInvoiceRows,
  normalizeBranchOpenDealRows,
  normalizeBranchServiceJobRows,
  normalizeBranchTrafficRows,
  summarizeBranchCommand,
  type BranchInvoiceRow,
  type BranchIntakeRow,
  type BranchOpenDealRow,
  type BranchServiceJobRow,
  type BranchTrafficRow,
} from "../lib/branch-command";
import { supabase } from "@/lib/supabase";
import { buildAccountCommandHref } from "../lib/account-command";

export function BranchCommandCenterPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const branchQuery = useBranchBySlug(branchId ?? null);

  const [trafficQuery, intakeQuery, serviceQuery, invoiceQuery, openDealsQuery] = useQueries({
    queries: [
      {
        queryKey: ["branch-command", branchId, "traffic"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchTrafficRow[]> => {
          const { data, error } = await supabase
            .from("traffic_tickets")
            .select("id, ticket_type, status, from_location, to_location")
            .order("shipping_date", { ascending: false })
            .limit(200);
          if (error) throw new Error(error.message);
          return normalizeBranchTrafficRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-command", branchId, "intake"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchIntakeRow[]> => {
          const { data, error } = await supabase
            .from("equipment_intake")
            .select("id, current_stage, pdi_completed, photo_ready, ship_to_branch")
            .limit(200);
          if (error) throw new Error(error.message);
          return normalizeBranchIntakeRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-command", branchId, "service-jobs"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchServiceJobRow[]> => {
          const { data, error } = await supabase
            .from("service_jobs")
            .select("id, customer_id, current_stage, invoice_total")
            .eq("branch_id", branchId!)
            .is("deleted_at", null)
            .limit(200);
          if (error) throw new Error(error.message);
          return normalizeBranchServiceJobRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-command", branchId, "invoices"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchInvoiceRow[]> => {
          const { data, error } = await supabase
            .from("customer_invoices")
            .select("id, total, amount_paid, balance_due, status")
            .eq("branch_id", branchId!)
            .limit(200);
          if (error) throw new Error(error.message);
          return normalizeBranchInvoiceRows(data);
        },
        staleTime: 60_000,
      },
      {
        queryKey: ["branch-command", branchId, "open-deals"],
        enabled: Boolean(branchId),
        queryFn: async (): Promise<BranchOpenDealRow[]> => {
          const { data, error } = await supabase
            .from("crm_deals")
            .select("id, company_id, name, amount")
            .is("deleted_at", null)
            .is("closed_at", null)
            .limit(400);
          if (error) throw new Error(error.message);
          return normalizeBranchOpenDealRows(data);
        },
        staleTime: 60_000,
      },
    ],
  });

  const summary = useMemo(() => {
    if (!branchQuery.data) return null;
    return summarizeBranchCommand({
      slug: branchQuery.data.slug,
      displayName: branchQuery.data.display_name,
      trafficTickets: trafficQuery.data ?? [],
      intake: intakeQuery.data ?? [],
      serviceJobs: serviceQuery.data ?? [],
      invoices: invoiceQuery.data ?? [],
      openDeals: openDealsQuery.data ?? [],
    });
  }, [branchQuery.data, intakeQuery.data, invoiceQuery.data, openDealsQuery.data, serviceQuery.data, trafficQuery.data]);

  const companyIds = useMemo(
    () =>
      [...new Set((serviceQuery.data ?? []).map((row) => row.customer_id).filter((value): value is string => Boolean(value)))],
    [serviceQuery.data],
  );

  const companyMapQuery = useQuery({
    queryKey: ["branch-command", branchId, "companies", companyIds.join(",")],
    enabled: companyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_companies")
        .select("id, name")
        .in("id", companyIds);
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((row) => [row.id, row.name]));
    },
    staleTime: 60_000,
  });

  if (!branchId) {
    return <Navigate to="/admin/branches" replace />;
  }

  if (branchQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
        <DeckSurface className="h-80 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      </div>
    );
  }

  if (branchQuery.isError || !branchQuery.data || !summary) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">This branch command surface isn&apos;t available right now.</p>
        </DeckSurface>
      </div>
    );
  }

  const branch = branchQuery.data;
  const activeServiceCompanies = (serviceQuery.data ?? [])
    .filter((row) => row.current_stage !== "paid_closed")
    .slice(0, 8);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" className="min-h-[44px] gap-2">
          <Link to="/admin/branches">
            <ArrowLeft className="h-4 w-4" />
            Back to branches
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to={`/qrm/branches/${branchId}/chief`}>AI Branch Chief</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/service/dashboard">Service Dashboard</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/ops/intake">Intake</Link>
          </Button>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link to="/ops/traffic">Traffic</Link>
          </Button>
        </div>
      </div>

      <QrmPageHeader
        title={branch.display_name}
        subtitle={[branch.city, branch.state_province].filter(Boolean).join(", ") || branch.slug}
      />

      <div className="grid gap-4 md:grid-cols-5">
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Revenue</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">${Math.round(summary.branchRevenue).toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted-foreground">Branch-linked invoices</p>
        </DeckSurface>
        <DeckSurface className={`p-4 ${summary.readinessBlocked > 0 ? "border-qep-warm/40" : ""}`}>
          <div className="flex items-center gap-2">
            <Clock3 className={`h-4 w-4 ${summary.readinessBlocked > 0 ? "text-qep-warm" : "text-qep-orange"}`} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Readiness</p>
          </div>
          <p className={`mt-3 text-3xl font-semibold ${summary.readinessBlocked > 0 ? "text-qep-warm" : "text-foreground"}`}>{summary.readinessBlocked}</p>
          <p className="mt-1 text-xs text-muted-foreground">Blocked intake units</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Logistics</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">{summary.logisticsOpen}</p>
          <p className="mt-1 text-xs text-muted-foreground">Open branch traffic moves</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rental moves</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">{summary.rentalMoves}</p>
          <p className="mt-1 text-xs text-muted-foreground">Active rental/re-rent traffic</p>
        </DeckSurface>
        <DeckSurface className="p-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-qep-orange" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Service-linked sales</p>
          </div>
          <p className="mt-3 text-3xl font-semibold text-foreground">${Math.round(summary.serviceLinkedSalesValue).toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted-foreground">{summary.serviceLinkedSalesCount} open deals tied to branch service customers</p>
        </DeckSurface>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DeckSurface className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Branch operating posture</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Uses branch-linked invoice, intake, logistics, and service tables that exist today. Sales pressure is limited to service-linked opportunities until sales deals carry a direct branch key.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Open AR balance</p>
              <p className="mt-2 text-xl font-semibold text-foreground">${Math.round(summary.openArBalance).toLocaleString()}</p>
            </div>
            <div className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Service invoice value</p>
              <p className="mt-2 text-xl font-semibold text-foreground">${Math.round(summary.serviceInvoiceValue).toLocaleString()}</p>
            </div>
            <div className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Units in prep</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{summary.readinessInPrep}</p>
            </div>
            <div className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Active service jobs</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{summary.activeServiceJobs}</p>
            </div>
          </div>
        </DeckSurface>

        <DeckSurface className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Branch identity</h2>
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-muted-foreground">{branch.address_line1 ?? "Address not configured"}</p>
            {branch.phone_main && <p className="text-muted-foreground">{branch.phone_main}</p>}
            {branch.email_main && <p className="text-muted-foreground">{branch.email_main}</p>}
            {branch.capabilities.length > 0 && (
              <p className="text-muted-foreground">Capabilities: {branch.capabilities.join(", ").replace(/_/g, " ")}</p>
            )}
          </div>
        </DeckSurface>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <DeckSurface className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Branch logistics queue</h2>
          <div className="mt-4 space-y-2">
            {(trafficQuery.data ?? [])
              .filter((row) => row.status !== "completed")
              .filter((row) => row.from_location.toLowerCase().includes(branch.slug) || row.to_location.toLowerCase().includes(branch.slug) || row.from_location.toLowerCase().includes(branch.display_name.toLowerCase()) || row.to_location.toLowerCase().includes(branch.display_name.toLowerCase()))
              .slice(0, 8)
              .map((row) => (
                <div key={row.id} className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">{row.ticket_type.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{row.status.replace(/_/g, " ")}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{row.from_location} → {row.to_location}</p>
                </div>
              ))}
            {((trafficQuery.data ?? []).filter((row) => row.status !== "completed").length === 0) && (
              <p className="text-sm text-muted-foreground">No open branch logistics moves.</p>
            )}
          </div>
        </DeckSurface>

        <DeckSurface className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Service-linked sales</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Customers with active jobs in this branch and open commercial deals.
          </p>
          <div className="mt-4 space-y-2">
            {activeServiceCompanies.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {companyMapQuery.data?.get(row.customer_id ?? "") ?? "Customer"}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.current_stage.replace(/_/g, " ")}</p>
                </div>
                {row.customer_id && (
                  <Button asChild size="sm" variant="ghost">
                    <Link to={buildAccountCommandHref(row.customer_id)}>
                      Open account <ArrowUpRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                )}
              </div>
            ))}
            {activeServiceCompanies.length === 0 && (
              <p className="text-sm text-muted-foreground">No active service-linked sales opportunities for this branch yet.</p>
            )}
          </div>
        </DeckSurface>
      </div>
    </div>
  );
}
