import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, DollarSign, RefreshCcw, Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import {
  buildRentalCommandCenter,
  type RentalFleetUnit,
  type RentalReturnCase,
  type RentalTrafficTicket,
} from "../lib/rental-command";

interface EquipmentRow {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  availability: RentalFleetUnit["availability"];
  location_description: string | null;
  daily_rental_rate: number | null;
  current_market_value: number | null;
}

interface ReturnRow {
  id: string;
  equipment_id: string | null;
  status: string;
  charge_amount: number | null;
  has_charges: boolean | null;
  aging_bucket: string | null;
  work_order_number: string | null;
  created_at: string;
}

interface TrafficRow {
  id: string;
  equipment_id: string | null;
  status: RentalTrafficTicket["status"];
  ticket_type: string;
  to_location: string;
  promised_delivery_at: string | null;
  created_at: string;
}

interface PortalCustomerRow {
  id: string;
  crm_company_id: string | null;
  first_name: string;
  last_name: string;
}

interface RentalContractApprovalRow {
  id: string;
  portal_customer_id: string;
  equipment_id: string | null;
  requested_category: string | null;
  requested_make: string | null;
  requested_model: string | null;
  branch_id: string | null;
  requested_start_date: string;
  requested_end_date: string;
  status: string;
  estimate_daily_rate: number | null;
  estimate_weekly_rate: number | null;
  estimate_monthly_rate: number | null;
  customer_notes: string | null;
  dealer_response: string | null;
}

interface RentalExtensionApprovalRow {
  id: string;
  rental_contract_id: string;
  requested_end_date: string;
  approved_end_date: string | null;
  status: string;
  customer_reason: string | null;
  dealer_response: string | null;
  additional_charge: number | null;
  payment_status: string | null;
}

interface BranchOptionRow {
  id: string;
  display_name: string;
}

export function RentalCommandCenterPage() {
  const queryClient = useQueryClient();
  const [dealerResponses, setDealerResponses] = useState<Record<string, string>>({});
  const [assignedUnits, setAssignedUnits] = useState<Record<string, string>>({});
  const [approvedBranches, setApprovedBranches] = useState<Record<string, string>>({});
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>({});
  const [extensionResponses, setExtensionResponses] = useState<Record<string, string>>({});
  const [extensionCharges, setExtensionCharges] = useState<Record<string, string>>({});

  const commandQuery = useQuery({
    queryKey: ["qrm", "rental-command"],
    queryFn: async () => {
      const [equipmentResult, returnsResult, trafficResult] = await Promise.all([
        supabase
          .from("crm_equipment")
          .select("id, name, make, model, year, availability, location_description, daily_rental_rate, current_market_value")
          .eq("ownership", "rental_fleet")
          .is("deleted_at", null)
          .limit(500),
        supabase
          .from("rental_returns")
          .select("id, equipment_id, status, charge_amount, has_charges, aging_bucket, work_order_number, created_at")
          .neq("status", "completed")
          .limit(500),
        supabase
          .from("traffic_tickets")
          .select("id, equipment_id, status, ticket_type, to_location, promised_delivery_at, created_at")
          .in("ticket_type", ["rental", "re_rent", "customer_transfer", "location_transfer"])
          .neq("status", "completed")
          .limit(500),
      ]);

      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (returnsResult.error) throw new Error(returnsResult.error.message);
      if (trafficResult.error) throw new Error(trafficResult.error.message);

      return buildRentalCommandCenter(
        ((equipmentResult.data ?? []) as EquipmentRow[]).map((row) => ({
          id: row.id,
          name: row.name,
          make: row.make,
          model: row.model,
          year: row.year,
          availability: row.availability,
          locationDescription: row.location_description,
          dailyRentalRate: row.daily_rental_rate,
          currentMarketValue: row.current_market_value,
        })),
        ((returnsResult.data ?? []) as ReturnRow[]).map((row) => ({
          id: row.id,
          equipmentId: row.equipment_id,
          status: row.status,
          chargeAmount: row.charge_amount,
          hasCharges: row.has_charges,
          agingBucket: row.aging_bucket,
          workOrderNumber: row.work_order_number,
          createdAt: row.created_at,
        })),
        ((trafficResult.data ?? []) as TrafficRow[]).map((row) => ({
          id: row.id,
          equipmentId: row.equipment_id,
          status: row.status,
          ticketType: row.ticket_type,
          toLocation: row.to_location,
          promisedDeliveryAt: row.promised_delivery_at,
          createdAt: row.created_at,
        })),
      );
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const contractQueueQuery = useQuery({
    queryKey: ["qrm", "rental-contract-queue"],
    queryFn: async () => {
      const [contractsResult, extensionsResult, portalCustomersResult, equipmentResult, branchResult] = await Promise.all([
        supabase
          .from("rental_contracts")
          .select("id, portal_customer_id, equipment_id, requested_category, requested_make, requested_model, branch_id, requested_start_date, requested_end_date, status, estimate_daily_rate, estimate_weekly_rate, estimate_monthly_rate, customer_notes, dealer_response")
          .in("status", ["submitted", "reviewing", "quoted", "approved", "awaiting_payment"])
          .order("created_at", { ascending: false }),
        supabase
          .from("rental_contract_extensions")
          .select("id, rental_contract_id, requested_end_date, approved_end_date, status, customer_reason, dealer_response, additional_charge, payment_status")
          .in("status", ["submitted", "reviewing", "approved"])
          .order("created_at", { ascending: false }),
        supabase
          .from("portal_customers")
          .select("id, crm_company_id, first_name, last_name")
          .limit(200),
        supabase
          .from("crm_equipment")
          .select("id, name, make, model, year, availability, location_description, daily_rental_rate, current_market_value")
          .eq("ownership", "rental_fleet")
          .is("deleted_at", null)
          .limit(500),
        supabase
          .from("branches")
          .select("id, display_name")
          .eq("is_active", true)
          .limit(100),
      ]);

      if (contractsResult.error) throw new Error(contractsResult.error.message);
      if (extensionsResult.error) throw new Error(extensionsResult.error.message);
      if (portalCustomersResult.error) throw new Error(portalCustomersResult.error.message);
      if (equipmentResult.error) throw new Error(equipmentResult.error.message);
      if (branchResult.error) throw new Error(branchResult.error.message);

      return {
        contracts: (contractsResult.data ?? []) as RentalContractApprovalRow[],
        extensions: (extensionsResult.data ?? []) as RentalExtensionApprovalRow[],
        customers: (portalCustomersResult.data ?? []) as PortalCustomerRow[],
        equipment: (equipmentResult.data ?? []) as EquipmentRow[],
        branches: (branchResult.data ?? []) as BranchOptionRow[],
      };
    },
    staleTime: 60_000,
  });

  const approveBookingMutation = useMutation({
    mutationFn: async (payload: {
      contract: RentalContractApprovalRow;
      equipmentId: string;
      branchId: string | null;
      dealerResponse: string | null;
      depositAmount: number;
    }) => {
      const { contract, equipmentId, branchId, dealerResponse, depositAmount } = payload;
      const customer = contractQueueQuery.data?.customers.find((item) => item.id === contract.portal_customer_id);
      if (!customer) throw new Error("Portal customer not found for this rental request.");

      let depositInvoiceId: string | null = null;
      let status: string = "active";
      let depositStatus: string | null = "not_required";

      if (depositAmount > 0) {
        const invoiceNumber = `RENT-${Date.now()}`;
        const { data: invoice, error: invoiceError } = await supabase
          .from("customer_invoices")
          .insert({
            portal_customer_id: customer.id,
            crm_company_id: customer.crm_company_id,
            invoice_number: invoiceNumber,
            due_date: new Date().toISOString().slice(0, 10),
            description: "Rental deposit",
            amount: depositAmount,
            total: depositAmount,
            status: "pending",
          })
          .select()
          .single();
        if (invoiceError || !invoice?.id) throw new Error(invoiceError?.message ?? "Failed to create rental deposit invoice.");
        depositInvoiceId = invoice.id;
        status = "awaiting_payment";
        depositStatus = "pending";
        await supabase.from("customer_invoice_line_items").insert({
          invoice_id: invoice.id,
          description: "Rental deposit",
          quantity: 1,
          unit_price: depositAmount,
        });
      }

      const { error } = await supabase
        .from("rental_contracts")
        .update({
          equipment_id: equipmentId,
          branch_id: branchId,
          approved_start_date: contract.requested_start_date,
          approved_end_date: contract.requested_end_date,
          agreed_daily_rate: contract.estimate_daily_rate,
          agreed_weekly_rate: contract.estimate_weekly_rate,
          agreed_monthly_rate: contract.estimate_monthly_rate,
          deposit_required: depositAmount > 0,
          deposit_amount: depositAmount > 0 ? depositAmount : null,
          deposit_invoice_id: depositInvoiceId,
          deposit_status: depositStatus,
          dealer_response: dealerResponse,
          status,
        })
        .eq("id", contract.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "invoices"] });
    },
  });

  const declineBookingMutation = useMutation({
    mutationFn: async (payload: { id: string; dealerResponse: string | null }) => {
      const { error } = await supabase
        .from("rental_contracts")
        .update({ status: "declined", dealer_response: payload.dealerResponse })
        .eq("id", payload.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const approveExtensionMutation = useMutation({
    mutationFn: async (payload: { extension: RentalExtensionApprovalRow; dealerResponse: string | null; additionalCharge: number }) => {
      const { extension, dealerResponse, additionalCharge } = payload;
      let paymentInvoiceId: string | null = null;
      let paymentStatus: string | null = "not_required";
      if (additionalCharge > 0) {
        const { data: invoice, error: invoiceError } = await supabase
          .from("customer_invoices")
          .insert({
            invoice_number: `EXT-${Date.now()}`,
            due_date: new Date().toISOString().slice(0, 10),
            description: "Rental extension charge",
            amount: additionalCharge,
            total: additionalCharge,
            status: "pending",
          })
          .select()
          .single();
        if (invoiceError || !invoice?.id) throw new Error(invoiceError?.message ?? "Failed to create extension invoice.");
        paymentInvoiceId = invoice.id;
        paymentStatus = "pending";
      } else {
        await supabase
          .from("rental_contracts")
          .update({ approved_end_date: extension.requested_end_date, requested_end_date: extension.requested_end_date })
          .eq("id", extension.rental_contract_id);
      }
      const { error } = await supabase
        .from("rental_contract_extensions")
        .update({
          status: "approved",
          approved_end_date: extension.requested_end_date,
          dealer_response: dealerResponse,
          additional_charge: additionalCharge > 0 ? additionalCharge : null,
          payment_invoice_id: paymentInvoiceId,
          payment_status: paymentStatus,
        })
        .eq("id", extension.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "invoices"] });
    },
  });

  const declineExtensionMutation = useMutation({
    mutationFn: async (payload: { id: string; dealerResponse: string | null }) => {
      const { error } = await supabase
        .from("rental_contract_extensions")
        .update({ status: "declined", dealer_response: payload.dealerResponse })
        .eq("id", payload.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const center = commandQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Rental Command Center"
        subtitle="Dedicated rental operations across utilization, returns, work recovery, and movement risk."
      />
      <QrmSubNav />

      {commandQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading rental command…</Card>
      ) : commandQuery.isError || !center ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {commandQuery.error instanceof Error ? commandQuery.error.message : "Rental command is unavailable right now."}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-5">
            <SummaryCard icon={Truck} label="Fleet" value={String(center.summary.totalFleet)} detail="Active rental fleet units." />
            <SummaryCard icon={DollarSign} label="On rent" value={String(center.summary.onRentCount)} detail={`Daily revenue in play ${formatCurrency(center.summary.dailyRevenueInPlay)}`} />
            <SummaryCard icon={RefreshCcw} label="Ready" value={String(center.summary.readyCount)} detail={`${Math.round(center.summary.utilizationPct * 100)}% utilization`} />
            <SummaryCard icon={Wrench} label="Recovery" value={String(center.summary.recoveryCount)} detail={`${center.summary.returnsInFlight} return cases in flight`} tone="warn" />
            <SummaryCard icon={Truck} label="Motion risk" value={String(center.summary.motionRiskCount)} detail={`${center.summary.motionCount} rental moves open`} tone={center.summary.motionRiskCount > 0 ? "warn" : "default"} />
          </div>

          <div className="flex justify-end">
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/rental-pricing">
                Rental pricing admin <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-foreground">Pending booking approvals</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Approve customer booking requests, assign units for category-first requests, and trigger deposit checkout.
              </p>
              <div className="mt-4 space-y-3">
                {(contractQueueQuery.data?.contracts ?? []).filter((contract) => ["submitted", "reviewing", "quoted", "approved", "awaiting_payment"].includes(contract.status)).map((contract) => {
                  const customer = contractQueueQuery.data?.customers.find((item) => item.id === contract.portal_customer_id);
                  const availableUnits = (contractQueueQuery.data?.equipment ?? []).filter((equipment) => equipment.availability === "available");
                  return (
                    <div key={contract.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {[customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "Portal customer"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {(contract.requested_category ?? [contract.requested_make, contract.requested_model].filter(Boolean).join(" ")) || "Exact unit booking"}
                            {" · "}
                            {contract.requested_start_date} → {contract.requested_end_date}
                          </p>
                          {contract.customer_notes ? <p className="mt-2 text-xs text-muted-foreground">{contract.customer_notes}</p> : null}
                        </div>
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                          {contract.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2">
                        <select
                          value={assignedUnits[contract.id] ?? contract.equipment_id ?? ""}
                          onChange={(event) => setAssignedUnits((current) => ({ ...current, [contract.id]: event.target.value }))}
                          className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                        >
                          <option value="">Assign unit…</option>
                          {availableUnits.map((equipment) => (
                            <option key={equipment.id} value={equipment.id}>
                              {[equipment.year, equipment.make, equipment.model].filter(Boolean).join(" ")}
                            </option>
                          ))}
                        </select>
                        <select
                          value={approvedBranches[contract.id] ?? contract.branch_id ?? ""}
                          onChange={(event) => setApprovedBranches((current) => ({ ...current, [contract.id]: event.target.value }))}
                          className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                        >
                          <option value="">Assign branch…</option>
                          {(contractQueueQuery.data?.branches ?? []).map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.display_name}</option>
                          ))}
                        </select>
                        <Input
                          value={depositAmounts[contract.id] ?? ""}
                          onChange={(event) => setDepositAmounts((current) => ({ ...current, [contract.id]: event.target.value }))}
                          placeholder="Deposit amount (optional)"
                        />
                        <Input
                          value={dealerResponses[contract.id] ?? contract.dealer_response ?? ""}
                          onChange={(event) => setDealerResponses((current) => ({ ...current, [contract.id]: event.target.value }))}
                          placeholder="Dealer response"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => approveBookingMutation.mutate({
                              contract,
                              equipmentId: assignedUnits[contract.id] ?? contract.equipment_id ?? "",
                              branchId: approvedBranches[contract.id] ?? contract.branch_id ?? null,
                              dealerResponse: dealerResponses[contract.id] ?? contract.dealer_response ?? null,
                              depositAmount: Number(depositAmounts[contract.id] ?? 0) || 0,
                            })}
                            disabled={approveBookingMutation.isPending || !(assignedUnits[contract.id] ?? contract.equipment_id)}
                          >
                            {approveBookingMutation.isPending ? "Approving..." : "Approve booking"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => declineBookingMutation.mutate({
                              id: contract.id,
                              dealerResponse: dealerResponses[contract.id] ?? "Rental request declined by dealership.",
                            })}
                            disabled={declineBookingMutation.isPending}
                          >
                            Decline
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold text-foreground">Pending extension approvals</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Approve or decline extension requests and collect any additional extension charge when needed.
              </p>
              <div className="mt-4 space-y-3">
                {(contractQueueQuery.data?.extensions ?? []).filter((extension) => ["submitted", "reviewing", "approved"].includes(extension.status)).map((extension) => (
                  <div key={extension.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Extension request</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requested end date {extension.requested_end_date}
                          {extension.customer_reason ? ` · ${extension.customer_reason}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                        {extension.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      <Input
                        value={extensionResponses[extension.id] ?? extension.dealer_response ?? ""}
                        onChange={(event) => setExtensionResponses((current) => ({ ...current, [extension.id]: event.target.value }))}
                        placeholder="Dealer response"
                      />
                      <Input
                        value={extensionCharges[extension.id] ?? ""}
                        onChange={(event) => setExtensionCharges((current) => ({ ...current, [extension.id]: event.target.value }))}
                        placeholder="Additional charge (optional)"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => approveExtensionMutation.mutate({
                            extension,
                            dealerResponse: extensionResponses[extension.id] ?? extension.dealer_response ?? null,
                            additionalCharge: Number(extensionCharges[extension.id] ?? 0) || 0,
                          })}
                          disabled={approveExtensionMutation.isPending}
                        >
                          {approveExtensionMutation.isPending ? "Approving..." : "Approve extension"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => declineExtensionMutation.mutate({
                            id: extension.id,
                            dealerResponse: extensionResponses[extension.id] ?? "Extension request declined by dealership.",
                          })}
                          disabled={declineExtensionMutation.isPending}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <UnitListCard
              title="On rent now"
              description="Units currently generating rental revenue."
              items={center.onRentUnits}
              emptyText="No units are out on rent right now."
            />
            <UnitListCard
              title="Ready to turn"
              description="Rental units available in yard and ready for the next move."
              items={center.readyUnits}
              emptyText="No rental units are sitting ready right now."
            />
            <UnitListCard
              title="Recovery"
              description="Units in service or tied to damaged-return recovery."
              items={center.recoveryUnits}
              emptyText="No rental units are in recovery."
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Return queue</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Open returns, aging, and charge exposure pulled from the live return workflow.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/ops/returns">
                    Open returns <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {center.returnQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No rental returns in flight.</p>
                ) : (
                  center.returnQueue.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{item.unit?.name ?? "Unlinked rental return"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.status.replace(/_/g, " ")}
                            {item.agingBucket ? ` · aging ${item.agingBucket}` : ""}
                            {item.workOrderNumber ? ` · ${item.workOrderNumber}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.hasCharges ? `Charge exposure ${formatCurrency(item.chargeAmount)}` : "No charge exposure flagged"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Rental movement</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rental and re-rent moves that still need operational control.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/ops/traffic">
                    Open traffic <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {center.motionQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No rental moves are open right now.</p>
                ) : (
                  center.motionQueue.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{item.unit?.name ?? "Unlinked rental move"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.ticketType.replace(/_/g, " ")} · {item.status.replace(/_/g, " ")} · {item.toLocation}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.promisedDeliveryAt
                              ? `Promised ${new Date(item.promisedDeliveryAt).toLocaleDateString()}`
                              : "No promised delivery window set"}
                          </p>
                        </div>
                        <RiskPill riskLevel={item.riskLevel} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
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
  icon: React.ComponentType<{ className?: string }>;
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
      <p className="mt-3 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function UnitListCard({
  title,
  description,
  items,
  emptyText,
}: {
  title: string;
  description: string;
  items: RentalFleetUnit[];
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          items.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[item.year, item.make, item.model].filter(Boolean).join(" ")}
                    {item.locationDescription ? ` · ${item.locationDescription}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.dailyRentalRate != null ? `${formatCurrency(item.dailyRentalRate)} / day` : "Rate not set"}
                  </p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/equipment/${item.id}`}>
                    Machine <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RiskPill({ riskLevel }: { riskLevel: "high" | "medium" | "low" }) {
  const tone = riskLevel === "high"
    ? "bg-red-500/10 text-red-300"
    : riskLevel === "medium"
      ? "bg-amber-500/10 text-amber-200"
      : "bg-emerald-500/10 text-emerald-200";

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {riskLevel} risk
    </span>
  );
}
