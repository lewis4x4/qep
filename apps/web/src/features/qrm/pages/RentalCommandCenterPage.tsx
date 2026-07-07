import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { optimizeCharge } from "../../../../../../shared/rental-rate-math";
import { Link } from "react-router-dom";
import { ArrowUpRight, DollarSign, RefreshCcw, Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { rentalOpsApi } from "../lib/rental-ops-api";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { DeckSurface } from "../components/command-deck";
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

interface PortalCustomerRow {
  id: string;
  first_name: string;
  last_name: string;
}

interface RentalContractApprovalRow {
  id: string;
  portal_customer_id: string;
  equipment_id: string | null;
  assignment_status: "pending_assignment" | "assigned" | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeAvailability(value: unknown): RentalFleetUnit["availability"] | null {
  switch (value) {
    case "available":
    case "rented":
    case "sold":
    case "in_service":
    case "in_transit":
    case "reserved":
    case "decommissioned":
      return value;
    default:
      return null;
  }
}

function normalizeTrafficStatus(value: unknown): RentalTrafficTicket["status"] | null {
  switch (value) {
    case "haul_pending":
    case "scheduled":
    case "being_shipped":
    case "completed":
      return value;
    default:
      return null;
  }
}

function normalizeAssignmentStatus(value: unknown): RentalContractApprovalRow["assignment_status"] {
  switch (value) {
    case "pending_assignment":
    case "assigned":
      return value;
    default:
      return null;
  }
}

function normalizeEquipmentOptions(rows: unknown): EquipmentRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    const availability = normalizeAvailability(row.availability);
    if (!availability) return [];

    return [{
      id: row.id,
      name: requiredString(row.name, "Unnamed rental unit"),
      make: nullableString(row.make),
      model: nullableString(row.model),
      year: nullableNumber(row.year),
      availability,
      location_description: nullableString(row.location_description),
      daily_rental_rate: nullableNumber(row.daily_rental_rate),
      current_market_value: nullableNumber(row.current_market_value),
    }];
  });
}

function normalizeFleetUnits(rows: unknown): RentalFleetUnit[] {
  return normalizeEquipmentOptions(rows).map((row) => ({
    id: row.id,
    name: row.name,
    make: row.make,
    model: row.model,
    year: row.year,
    availability: row.availability,
    locationDescription: row.location_description,
    dailyRentalRate: row.daily_rental_rate,
    currentMarketValue: row.current_market_value,
  }));
}

function normalizeReturnCases(rows: unknown): RentalReturnCase[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      equipmentId: nullableString(row.equipment_id),
      status: requiredString(row.status, "unknown"),
      chargeAmount: nullableNumber(row.charge_amount),
      hasCharges: nullableBoolean(row.has_charges),
      agingBucket: nullableString(row.aging_bucket),
      workOrderNumber: nullableString(row.work_order_number),
      createdAt: requiredString(row.created_at, new Date(0).toISOString()),
    }];
  });
}

function normalizeTrafficTickets(rows: unknown): RentalTrafficTicket[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    const status = normalizeTrafficStatus(row.status);
    if (!status) return [];

    return [{
      id: row.id,
      equipmentId: nullableString(row.equipment_id),
      status,
      ticketType: requiredString(row.ticket_type, "rental"),
      toLocation: requiredString(row.to_location, "Unknown destination"),
      promisedDeliveryAt: nullableString(row.promised_delivery_at),
      createdAt: requiredString(row.created_at, new Date(0).toISOString()),
    }];
  });
}

function normalizePortalCustomers(rows: unknown): PortalCustomerRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      first_name: requiredString(row.first_name, ""),
      last_name: requiredString(row.last_name, ""),
    }];
  });
}

function normalizeRentalContracts(rows: unknown): RentalContractApprovalRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.portal_customer_id !== "string") return [];

    return [{
      id: row.id,
      portal_customer_id: row.portal_customer_id,
      equipment_id: nullableString(row.equipment_id),
      assignment_status: normalizeAssignmentStatus(row.assignment_status),
      requested_category: nullableString(row.requested_category),
      requested_make: nullableString(row.requested_make),
      requested_model: nullableString(row.requested_model),
      branch_id: nullableString(row.branch_id),
      requested_start_date: requiredString(row.requested_start_date, "Unscheduled"),
      requested_end_date: requiredString(row.requested_end_date, "Unscheduled"),
      status: requiredString(row.status, "submitted"),
      estimate_daily_rate: nullableNumber(row.estimate_daily_rate),
      estimate_weekly_rate: nullableNumber(row.estimate_weekly_rate),
      estimate_monthly_rate: nullableNumber(row.estimate_monthly_rate),
      customer_notes: nullableString(row.customer_notes),
      dealer_response: nullableString(row.dealer_response),
    }];
  });
}

function normalizeRentalExtensions(rows: unknown): RentalExtensionApprovalRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.rental_contract_id !== "string") return [];

    return [{
      id: row.id,
      rental_contract_id: row.rental_contract_id,
      requested_end_date: requiredString(row.requested_end_date, "Unscheduled"),
      approved_end_date: nullableString(row.approved_end_date),
      status: requiredString(row.status, "submitted"),
      customer_reason: nullableString(row.customer_reason),
      dealer_response: nullableString(row.dealer_response),
      additional_charge: nullableNumber(row.additional_charge),
      payment_status: nullableString(row.payment_status),
    }];
  });
}

function normalizeBranches(rows: unknown): BranchOptionRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      display_name: requiredString(row.display_name, "Unnamed branch"),
    }];
  });
}

export function RentalCommandCenterPage() {
  const queryClient = useQueryClient();
  const [dealerResponses, setDealerResponses] = useState<Record<string, string>>({});
  const [assignedUnits, setAssignedUnits] = useState<Record<string, string>>({});
  const [approvedBranches, setApprovedBranches] = useState<Record<string, string>>({});
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>({});
  const [extensionResponses, setExtensionResponses] = useState<Record<string, string>>({});
  const [extensionCharges, setExtensionCharges] = useState<Record<string, string>>({});
  const [counterCompanySearch, setCounterCompanySearch] = useState("");
  const [counterCompanyId, setCounterCompanyId] = useState("");
  const [counterContractType, setCounterContractType] = useState<"reservation" | "rental" | "demo" | "loaner">("rental");
  const [counterEquipmentId, setCounterEquipmentId] = useState("");
  const [counterStartDate, setCounterStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [counterEndDate, setCounterEndDate] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [counterDailyRate, setCounterDailyRate] = useState("");
  const [counterResult, setCounterResult] = useState<string | null>(null);
  const [exchangeUnits, setExchangeUnits] = useState<Record<string, string>>({});
  const [exchangeContinuity, setExchangeContinuity] = useState<Record<string, boolean>>({});
  const [opsError, setOpsError] = useState<string | null>(null);

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
        normalizeFleetUnits(equipmentResult.data),
        normalizeReturnCases(returnsResult.data),
        normalizeTrafficTickets(trafficResult.data),
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
          .select("id, portal_customer_id, equipment_id, assignment_status, requested_category, requested_make, requested_model, branch_id, requested_start_date, requested_end_date, status, estimate_daily_rate, estimate_weekly_rate, estimate_monthly_rate, customer_notes, dealer_response")
          .in("status", ["submitted", "reviewing", "quoted", "approved", "awaiting_payment"])
          .order("created_at", { ascending: false }),
        supabase
          .from("rental_contract_extensions")
          .select("id, rental_contract_id, requested_end_date, approved_end_date, status, customer_reason, dealer_response, additional_charge, payment_status")
          .in("status", ["submitted", "reviewing", "approved"])
          .order("created_at", { ascending: false }),
        supabase
          .from("portal_customers")
          .select("id, first_name, last_name")
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
        contracts: normalizeRentalContracts(contractsResult.data),
        extensions: normalizeRentalExtensions(extensionsResult.data),
        customers: normalizePortalCustomers(portalCustomersResult.data),
        equipment: normalizeEquipmentOptions(equipmentResult.data),
        branches: normalizeBranches(branchResult.data),
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
      await rentalOpsApi.approveBooking({
        contract_id: payload.contract.id,
        equipment_id: payload.equipmentId,
        branch_id: payload.branchId,
        dealer_response: payload.dealerResponse,
        deposit_amount: payload.depositAmount,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "invoices"] });
    },
  });

  const declineBookingMutation = useMutation({
    mutationFn: async (payload: { id: string; dealerResponse: string | null }) => {
      await rentalOpsApi.declineBooking({
        contract_id: payload.id,
        dealer_response: payload.dealerResponse,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const approveExtensionMutation = useMutation({
    mutationFn: async (payload: { extension: RentalExtensionApprovalRow; dealerResponse: string | null; additionalCharge: number }) => {
      await rentalOpsApi.approveExtension({
        extension_id: payload.extension.id,
        dealer_response: payload.dealerResponse,
        additional_charge: payload.additionalCharge,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "invoices"] });
    },
  });

  const declineExtensionMutation = useMutation({
    mutationFn: async (payload: { id: string; dealerResponse: string | null }) => {
      await rentalOpsApi.declineExtension({
        extension_id: payload.id,
        dealer_response: payload.dealerResponse,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const companySearchQuery = useQuery({
    queryKey: ["qrm", "rental-counter-companies", counterCompanySearch],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_companies")
        .select("id, name")
        .ilike("name", `%${counterCompanySearch}%`)
        .is("deleted_at", null)
        .order("name")
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    enabled: counterCompanySearch.trim().length >= 2,
  });

  const createContractMutation = useMutation({
    mutationFn: () =>
      rentalOpsApi.createContract({
        qrm_company_id: counterCompanyId,
        contract_type: counterContractType,
        equipment_id: counterEquipmentId || null,
        start_date: counterStartDate,
        end_date: counterEndDate,
        daily_rate: Number(counterDailyRate) || null,
      }),
    onSuccess: async ({ contract }) => {
      const number = typeof contract.contract_number === "string" ? contract.contract_number : "created";
      setCounterResult(`Contract ${number} opened as a draft. It moves to reserved/on-rent from the lifecycle guard.`);
      setCounterCompanyId("");
      setCounterCompanySearch("");
      setCounterEquipmentId("");
      setCounterDailyRate("");
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-command"] });
      await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-contract-queue"] });
    },
    onError: (error: unknown) => {
      setCounterResult(error instanceof Error ? error.message : "Failed to create the contract.");
    },
  });

  // Instant counter quote preview from the canonical rate math (L1). Day-rate
  // book only until the resolver-backed book is wired into this card.
  const counterPreview = useMemo(() => {
    const dayCents = Math.round((Number(counterDailyRate) || 0) * 100);
    const start = Date.parse(counterStartDate);
    const end = Date.parse(counterEndDate);
    if (dayCents <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const billableDays = Math.max(1, Math.round((end - start) / 86_400_000));
    try {
      const charge = optimizeCharge(billableDays, { day: dayCents });
      const billedAs = charge.segments
        .map((s) => `${s.qty} ${s.unit}${s.qty > 1 ? "s" : ""}`)
        .join(" + ");
      return { billableDays, total: charge.total / 100, billedAs, fired: charge.fired };
    } catch {
      return null;
    }
  }, [counterDailyRate, counterStartDate, counterEndDate]);

  const onRentOpsQuery = useQuery({
    queryKey: ["qrm", "rental-onrent-ops"],
    queryFn: async () => {
      const { data: contracts, error: contractsError } = await supabase
        .from("rental_contracts")
        .select("id, contract_number, lifecycle_state, contract_type, approved_end_date, requested_end_date")
        .in("lifecycle_state", ["on_rent", "off_rent"])
        .is("deleted_at", null)
        .order("approved_end_date", { ascending: true })
        .limit(100);
      if (contractsError) throw new Error(contractsError.message);

      const contractIds = (contracts ?? []).map((row) => row.id);
      const { data: lines, error: linesError } = contractIds.length
        ? await supabase
            .from("rental_contract_lines")
            .select("id, rental_contract_id, line_number, equipment_id, status, return_code, rental_end_at")
            .in("rental_contract_id", contractIds)
            .is("deleted_at", null)
            .order("line_number")
        : { data: [], error: null };
      if (linesError) throw new Error(linesError.message);

      const unitIds = Array.from(
        new Set((lines ?? []).map((line) => line.equipment_id).filter((id): id is string => Boolean(id))),
      );
      const { data: units, error: unitsError } = unitIds.length
        ? await supabase.from("crm_equipment").select("id, year, make, model, name").in("id", unitIds)
        : { data: [], error: null };
      if (unitsError) throw new Error(unitsError.message);

      const unitName = new Map(
        (units ?? []).map((unit) => [
          unit.id,
          [unit.year, unit.make, unit.model].filter(Boolean).join(" ") || unit.name || unit.id,
        ]),
      );
      return { contracts: contracts ?? [], lines: lines ?? [], unitName };
    },
    staleTime: 30_000,
  });

  const invalidateRentalOps = async () => {
    setOpsError(null);
    await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-onrent-ops"] });
    await queryClient.invalidateQueries({ queryKey: ["qrm", "rental-command"] });
    await queryClient.invalidateQueries({ queryKey: ["ops", "rental-returns"] });
  };
  const onOpsError = (error: unknown) => {
    setOpsError(error instanceof Error ? error.message : "Rental operation failed.");
  };

  const codeLineMutation = useMutation({
    mutationFn: (data: { line_id: string; return_code: "returned" | "off_rent" | "hold" }) =>
      rentalOpsApi.codeLineReturn(data),
    onSuccess: invalidateRentalOps,
    onError: onOpsError,
  });
  const releaseHoldMutation = useMutation({
    mutationFn: (data: { line_id: string }) => rentalOpsApi.releaseHold(data),
    onSuccess: invalidateRentalOps,
    onError: onOpsError,
  });
  const exchangeMutation = useMutation({
    mutationFn: (data: { contract_id: string; line_id: string; new_equipment_id: string; rate_continuous: boolean }) =>
      rentalOpsApi.exchangeLine(data),
    onSuccess: async (_, variables) => {
      setExchangeUnits((current) => ({ ...current, [variables.line_id]: "" }));
      await invalidateRentalOps();
    },
    onError: onOpsError,
  });

  const center = commandQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Rental Command Center"
        subtitle="Dedicated rental operations across utilization, returns, work recovery, and movement risk."
        crumb={{ surface: "GRAPH", lens: "RENTALS" }}
      />

      {commandQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading rental command…</DeckSurface>
      ) : commandQuery.isError || !center ? (
        <DeckSurface className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {commandQuery.error instanceof Error ? commandQuery.error.message : "Rental command is unavailable right now."}
        </DeckSurface>
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

          <DeckSurface className="p-4">
            <h2 className="text-sm font-semibold text-foreground">New counter contract</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Open a draft rental contract for a walk-in or phone customer — no portal account needed.
              The lifecycle guard governs every move after this (reserve, check out, off-rent, return, close).
            </p>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Input
                  value={counterCompanySearch}
                  onChange={(event) => {
                    setCounterCompanySearch(event.target.value);
                    setCounterCompanyId("");
                  }}
                  placeholder="Search customer company (min 2 chars)…"
                />
                <select
                  value={counterCompanyId}
                  onChange={(event) => setCounterCompanyId(event.target.value)}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="">
                    {companySearchQuery.isFetching
                      ? "Searching…"
                      : (companySearchQuery.data?.length ?? 0) > 0
                        ? "Select company…"
                        : "Type above to find a company"}
                  </option>
                  {(companySearchQuery.data ?? []).map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
                <select
                  value={counterContractType}
                  onChange={(event) => setCounterContractType(event.target.value as typeof counterContractType)}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="rental">Rental</option>
                  <option value="reservation">Reservation</option>
                  <option value="demo">Demo</option>
                  <option value="loaner">Loaner</option>
                </select>
              </div>
              <div className="grid gap-2">
                <select
                  value={counterEquipmentId}
                  onChange={(event) => setCounterEquipmentId(event.target.value)}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="">Unit: assign later</option>
                  {(contractQueueQuery.data?.equipment ?? [])
                    .filter((equipment) => equipment.availability === "available")
                    .map((equipment) => (
                      <option key={equipment.id} value={equipment.id}>
                        {[equipment.year, equipment.make, equipment.model].filter(Boolean).join(" ") || equipment.name}
                      </option>
                    ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" value={counterStartDate} onChange={(event) => setCounterStartDate(event.target.value)} />
                  <Input type="date" value={counterEndDate} onChange={(event) => setCounterEndDate(event.target.value)} />
                </div>
                <Input
                  value={counterDailyRate}
                  onChange={(event) => setCounterDailyRate(event.target.value)}
                  placeholder="Daily rate (optional, resolves from rate rules later)"
                  inputMode="decimal"
                />
                {counterPreview ? (
                  <p className="text-xs text-muted-foreground">
                    Preview: {counterPreview.billableDays} billable days · billed as {counterPreview.billedAs} ·{" "}
                    {formatCurrency(counterPreview.total)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={() => {
                  setCounterResult(null);
                  createContractMutation.mutate();
                }}
                disabled={createContractMutation.isPending || !counterCompanyId || !counterStartDate || !counterEndDate}
              >
                {createContractMutation.isPending ? "Opening…" : "Open draft contract"}
              </Button>
              {counterResult ? <p className="text-xs text-muted-foreground">{counterResult}</p> : null}
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <h2 className="text-sm font-semibold text-foreground">On-rent operations</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Code lines Off-rent (clock stops, unit awaits pickup), Return, or Hold; release holds; exchange units
              mid-rental. The contract follows the lines automatically — downstream only.
            </p>
            {opsError ? <p className="mt-2 text-xs text-red-300">{opsError}</p> : null}
            <div className="mt-4 space-y-3">
              {(onRentOpsQuery.data?.contracts ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {onRentOpsQuery.isLoading ? "Loading on-rent contracts…" : "Nothing on rent right now."}
                </p>
              ) : null}
              {(onRentOpsQuery.data?.contracts ?? []).map((contract) => {
                const contractLines = (onRentOpsQuery.data?.lines ?? []).filter(
                  (line) => line.rental_contract_id === contract.id,
                );
                const availableUnits = (contractQueueQuery.data?.equipment ?? []).filter(
                  (equipment) => equipment.availability === "available",
                );
                return (
                  <div key={contract.id} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {contract.contract_number ?? contract.id.slice(0, 8)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {contract.contract_type} · due {contract.approved_end_date ?? contract.requested_end_date}
                        </span>
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        contract.lifecycle_state === "off_rent"
                          ? "bg-cyan-500/10 text-cyan-300"
                          : "bg-emerald-500/10 text-emerald-300"
                      }`}>
                        {String(contract.lifecycle_state).replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {contractLines.map((line) => (
                        <div key={line.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 px-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                            #{line.line_number}{" "}
                            {line.equipment_id ? onRentOpsQuery.data?.unitName.get(line.equipment_id) ?? "—" : "unassigned"}
                            <span className="ml-2 text-muted-foreground">{String(line.status).replace(/_/g, " ")}</span>
                          </span>
                          {["active", "held"].includes(String(line.status)) ? (
                            <>
                              {String(line.status) === "held" ? (
                                <Button size="sm" variant="outline" disabled={releaseHoldMutation.isPending}
                                  onClick={() => releaseHoldMutation.mutate({ line_id: line.id })}>
                                  Release hold
                                </Button>
                              ) : (
                                <Button size="sm" variant="outline" disabled={codeLineMutation.isPending}
                                  onClick={() => codeLineMutation.mutate({ line_id: line.id, return_code: "hold" })}>
                                  Hold
                                </Button>
                              )}
                              <Button size="sm" variant="outline" disabled={codeLineMutation.isPending}
                                onClick={() => codeLineMutation.mutate({ line_id: line.id, return_code: "off_rent" })}>
                                Off-rent
                              </Button>
                              <Button size="sm" variant="outline" disabled={codeLineMutation.isPending}
                                onClick={() => codeLineMutation.mutate({ line_id: line.id, return_code: "returned" })}>
                                Return
                              </Button>
                              <select
                                value={exchangeUnits[line.id] ?? ""}
                                onChange={(event) => setExchangeUnits((current) => ({ ...current, [line.id]: event.target.value }))}
                                className="rounded border border-input bg-card px-2 py-1 text-xs"
                              >
                                <option value="">Exchange to…</option>
                                {availableUnits.map((equipment) => (
                                  <option key={equipment.id} value={equipment.id}>
                                    {[equipment.year, equipment.make, equipment.model].filter(Boolean).join(" ") || equipment.name}
                                  </option>
                                ))}
                              </select>
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={exchangeContinuity[line.id] ?? true}
                                  onChange={(event) =>
                                    setExchangeContinuity((current) => ({ ...current, [line.id]: event.target.checked }))}
                                />
                                same rate class
                              </label>
                              <Button size="sm" disabled={exchangeMutation.isPending || !exchangeUnits[line.id]}
                                onClick={() => exchangeMutation.mutate({
                                  contract_id: contract.id,
                                  line_id: line.id,
                                  new_equipment_id: exchangeUnits[line.id],
                                  rate_continuous: exchangeContinuity[line.id] ?? true,
                                })}>
                                Exchange
                              </Button>
                            </>
                          ) : String(line.status) === "off_rent" ? (
                            <Button size="sm" variant="outline" disabled={codeLineMutation.isPending}
                              onClick={() => codeLineMutation.mutate({ line_id: line.id, return_code: "returned" })}>
                              Mark returned
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">
                              {line.return_code ? `coded ${line.return_code}` : "—"}
                            </span>
                          )}
                        </div>
                      ))}
                      {contractLines.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground">No lines on this contract yet.</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </DeckSurface>

          <div className="grid gap-4 xl:grid-cols-2">
            <DeckSurface className="p-4">
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
                          {contract.assignment_status === "pending_assignment" ? (
                            <p className="mt-2 text-xs font-medium text-amber-300">
                              Unit assignment is still pending. This booking cannot move forward until a specific rental unit is assigned.
                            </p>
                          ) : null}
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
            </DeckSurface>

            <DeckSurface className="p-4">
              <h2 className="text-sm font-semibold text-foreground">Pending extension approvals</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Approve or decline extension requests and collect the additional extension charge when needed.
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
            </DeckSurface>
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
            <DeckSurface className="p-4">
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
            </DeckSurface>

            <DeckSurface className="p-4">
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
            </DeckSurface>
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
