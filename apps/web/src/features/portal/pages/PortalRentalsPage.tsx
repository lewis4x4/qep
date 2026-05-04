import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi } from "../lib/portal-api";
import {
  canEditPortalRentalBooking,
  canEditPortalRentalExtension,
  canRequestPortalRentalExtension,
  getPortalRentalContractStage,
  validatePortalRentalBookingDraft,
} from "../lib/portal-rentals";
import { AskIronAdvisorButton } from "@/components/primitives";
import { RentalPaymentStatusCard } from "../components/RentalPaymentStatusCard";
import { summarizeRentalSigningReadiness, vesignRequirementsText } from "../lib/signing-readiness";
import type {
  PortalRentalBookingDraft,
  PortalRentalContractView,
  PortalRentalExtensionRequest,
  PortalRentalReturnWorkspaceView,
} from "../../../../../../shared/qep-moonshot-contracts";
import { ClipboardCheck, PackageCheck, Receipt, RotateCcw, ShieldAlert, Truck } from "lucide-react";

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function tone(status: string): string {
  if (status === "active" || status === "completed") return "bg-emerald-500/10 text-emerald-300";
  if (status === "awaiting_payment" || status === "approved") return "bg-blue-500/10 text-blue-300";
  if (status === "declined" || status === "cancelled") return "bg-red-500/10 text-red-300";
  return "bg-amber-500/10 text-amber-300";
}

function emptyBookingDraft(): PortalRentalBookingDraft {
  return {
    mode: "exact_unit",
    equipmentId: null,
    requestedCategory: null,
    requestedMake: null,
    requestedModel: null,
    requestedStartDate: null,
    requestedEndDate: null,
    deliveryMode: "pickup",
    branchId: null,
    deliveryLocation: null,
    customerNotes: null,
  };
}

export function PortalRentalsPage() {
  const queryClient = useQueryClient();
  const [bookingDraft, setBookingDraft] = useState<PortalRentalBookingDraft>(emptyBookingDraft());
  const [bookingStartDates, setBookingStartDates] = useState<Record<string, string>>({});
  const [bookingEndDates, setBookingEndDates] = useState<Record<string, string>>({});
  const [bookingNotes, setBookingNotes] = useState<Record<string, string>>({});
  const [extensionNotes, setExtensionNotes] = useState<Record<string, string>>({});
  const [extensionDates, setExtensionDates] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "rentals"],
    queryFn: portalApi.getRentals,
    staleTime: 30_000,
  });

  const bookingMutation = useMutation({
    mutationFn: () => portalApi.createRentalBooking(bookingDraft),
    onSuccess: async () => {
      setBookingDraft(emptyBookingDraft());
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const extensionMutation = useMutation({
    mutationFn: (payload: { rental_contract_id: string; requested_end_date: string; customer_reason?: string | null }) =>
      portalApi.createRentalExtension(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const updateRequestMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => portalApi.updateRentalRequest(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const finalizePaymentMutation = useMutation({
    mutationFn: (payload: { kind: "contract" | "extension"; id: string }) => portalApi.finalizeRentalPayment(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["portal", "rentals"] });
    },
  });

  const bookings = data?.bookings ?? [];
  const activeContracts = data?.active_contracts ?? [];
  const extensionRequests = data?.extension_requests ?? [];
  const returns = data?.returns ?? [];
  const summary = data?.workspace_summary;
  const catalog = data?.booking_catalog;
  const selectedUnit = useMemo(
    () => catalog?.units?.find((unit) => unit.id === bookingDraft.equipmentId) ?? null,
    [catalog?.units, bookingDraft.equipmentId],
  );
  const bookingDraftState = validatePortalRentalBookingDraft(bookingDraft);
  const estimateQuery = useQuery({
    queryKey: [
      "portal",
      "rental-estimate",
      bookingDraft.equipmentId,
      bookingDraft.branchId,
      bookingDraft.requestedCategory,
      bookingDraft.requestedMake,
      bookingDraft.requestedModel,
    ],
    queryFn: () => portalApi.estimateRentalPricing({
      equipment_id: bookingDraft.equipmentId,
      branch_id: bookingDraft.branchId,
      requested_category: bookingDraft.requestedCategory,
      requested_make: bookingDraft.requestedMake,
      requested_model: bookingDraft.requestedModel,
    }),
    enabled: Boolean(
      bookingDraft.equipmentId ||
      bookingDraft.requestedCategory ||
      bookingDraft.requestedMake ||
      bookingDraft.requestedModel,
    ),
    staleTime: 30_000,
  });

  return (
    <PortalLayout>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-white/10 bg-white/[0.04] p-5 text-white shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Rental workspace</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Bookings</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary?.bookingCount ?? bookings.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Active rentals</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary?.activeContractCount ?? activeContracts.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Extensions</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary?.extensionCount ?? extensionRequests.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Closeouts</p>
              <p className="mt-3 text-3xl font-semibold text-white">{summary?.closeoutCount ?? returns.length}</p>
            </div>
          </div>
        </Card>

        <Card className="border-qep-orange/20 bg-qep-orange/10 p-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Ask Iron</p>
          <p className="mt-3 text-sm leading-6 text-white/75">
            Ask what to book, where payment is blocking activation, or which extension/return needs attention first.
          </p>
          <div className="mt-4">
            <AskIronAdvisorButton
              contextType="portal-rentals"
              contextTitle="Portal rental workspace"
              draftPrompt="Review the portal rental workspace. Explain booking demand, active rental commitments, payment blockers, extension requests, and return risk."
              preferredSurface="sheet"
              variant="inline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              label="Ask Iron"
            />
          </div>
        </Card>
      </div>

      {isLoading && (
        <div className="mt-4 space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="h-40 animate-pulse border-white/10 bg-white/[0.03]" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="mt-4 border-red-500/20 bg-red-500/5 p-6">
          <p className="text-sm text-red-300">Failed to load rental workspace.</p>
        </Card>
      )}

      <div className="mt-4 space-y-4">
        <Card className="border-white/10 bg-white/[0.04] p-5 text-white">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-qep-orange" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">New booking</p>
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              {(["exact_unit", "category_first"] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={bookingDraft.mode === mode ? "default" : "outline"}
                  onClick={() => setBookingDraft((current) => ({
                    ...current,
                    mode,
                    equipmentId: mode === "category_first" ? null : current.equipmentId,
                  }))}
                >
                  {mode === "exact_unit" ? "Exact unit" : "Equipment type"}
                </Button>
              ))}
            </div>

            {bookingDraft.mode === "exact_unit" ? (
              <select
                value={bookingDraft.equipmentId ?? ""}
                onChange={(event) => setBookingDraft((current) => ({ ...current, equipmentId: event.target.value || null }))}
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
              >
                <option value="">Select a rentable unit…</option>
                {(catalog?.units ?? []).map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  value={bookingDraft.requestedCategory ?? ""}
                  onChange={(event) => setBookingDraft((current) => ({ ...current, requestedCategory: event.target.value || null }))}
                  className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="">Category…</option>
                  {(catalog?.categories ?? []).map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <Input
                  value={bookingDraft.requestedMake ?? ""}
                  onChange={(event) => setBookingDraft((current) => ({ ...current, requestedMake: event.target.value || null }))}
                  placeholder="Preferred make"
                />
                <Input
                  value={bookingDraft.requestedModel ?? ""}
                  onChange={(event) => setBookingDraft((current) => ({ ...current, requestedModel: event.target.value || null }))}
                  placeholder="Preferred model"
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="date"
                value={bookingDraft.requestedStartDate ?? ""}
                onChange={(event) => setBookingDraft((current) => ({ ...current, requestedStartDate: event.target.value || null }))}
              />
              <Input
                type="date"
                value={bookingDraft.requestedEndDate ?? ""}
                onChange={(event) => setBookingDraft((current) => ({ ...current, requestedEndDate: event.target.value || null }))}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={bookingDraft.deliveryMode}
                onChange={(event) => setBookingDraft((current) => ({ ...current, deliveryMode: event.target.value === "delivery" ? "delivery" : "pickup" }))}
                className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
              >
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
              </select>
              <Input
                value={bookingDraft.deliveryLocation ?? ""}
                onChange={(event) => setBookingDraft((current) => ({ ...current, deliveryLocation: event.target.value || null }))}
                placeholder="Branch or delivery location"
              />
            </div>

            <textarea
              value={bookingDraft.customerNotes ?? ""}
              onChange={(event) => setBookingDraft((current) => ({ ...current, customerNotes: event.target.value || null }))}
              className="min-h-[100px] w-full rounded border border-input bg-card px-3 py-2 text-sm"
              placeholder="Use case, site conditions, timing notes, transport notes…"
            />

            <div className="rounded-lg border border-border/60 bg-background/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Rough estimate</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <p className="text-sm text-foreground">Daily {formatCurrency(estimateQuery.data?.estimate.dailyRate ?? selectedUnit?.dailyRate ?? null)}</p>
                <p className="text-sm text-foreground">Weekly {formatCurrency(estimateQuery.data?.estimate.weeklyRate ?? selectedUnit?.weeklyRate ?? null)}</p>
                <p className="text-sm text-foreground">Monthly {formatCurrency(estimateQuery.data?.estimate.monthlyRate ?? selectedUnit?.monthlyRate ?? null)}</p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {estimateQuery.data?.estimate.sourceLabel
                  ? `Estimate source: ${estimateQuery.data.estimate.sourceLabel}. `
                  : ""}
                Final pricing and unit assignment are confirmed by the dealership before checkout.
              </p>
            </div>

            <Button
              onClick={() => bookingMutation.mutate()}
              disabled={
                bookingMutation.isPending ||
                !bookingDraftState.valid
              }
            >
              {bookingMutation.isPending ? "Submitting…" : "Submit rental request"}
            </Button>
            {!bookingDraftState.valid && bookingDraftState.reason ? (
              <p className="text-xs text-amber-200">{bookingDraftState.reason}</p>
            ) : null}
          </div>
        </Card>

        <Section
          title="Booking requests"
          icon={Truck}
          items={bookings}
          renderItem={(contract) => {
            const contractStage = getPortalRentalContractStage(contract);
            const signingReadiness = summarizeRentalSigningReadiness({ signedTermsUrl: contract.signedTermsUrl });
            return (
              <Card key={contract.id} className="border-white/10 bg-white/[0.04] p-5 text-white">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone(contract.status)}`}>
                      {contract.status.replace(/_/g, " ")}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                      contract.assignmentStatus === "pending_assignment"
                        ? "bg-amber-500/10 text-amber-300"
                        : "bg-emerald-500/10 text-emerald-200"
                    }`}>
                      {contract.assignmentStatus === "pending_assignment" ? "awaiting unit assignment" : "unit assigned"}
                    </span>
                    {contract.branchLabel ? (
                      <span className="text-[11px] uppercase tracking-[0.18em] text-white/45">{contract.branchLabel}</span>
                    ) : null}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-white">
                    {contract.equipment?.label ?? contract.requestedCategory ?? "Rental booking"}
                  </h2>
                  <p className="mt-1 text-sm text-white/60">
                    {formatDate(contract.approvedStartDate ?? contract.requestedStartDate)} → {formatDate(contract.approvedEndDate ?? contract.requestedEndDate)}
                  </p>
                  {contractStage === "pending_assignment" ? (
                    <p className="mt-2 text-sm text-amber-200">
                      The dealership is still selecting the exact rental unit that matches your requested equipment type and dates.
                    </p>
                  ) : null}
                  {contractStage === "awaiting_payment" ? (
                    <p className="mt-2 text-sm text-blue-200">
                      Your unit and terms are approved. The rental will activate after deposit checkout is completed and finalized here.
                    </p>
                  ) : null}
                  {contractStage === "ready_to_finalize" ? (
                    <p className="mt-2 text-sm text-emerald-200">
                      Payment is settled. Finalize the rental below to move this booking into the active rental lane.
                    </p>
                  ) : null}
                  {contract.dealerResponse ? (
                    <p className="mt-2 text-sm text-foreground">{contract.dealerResponse}</p>
                  ) : null}
                  {contract.customerNotes ? (
                    <p className="mt-2 text-sm text-white/70">{contract.customerNotes}</p>
                  ) : null}
                </div>

                <AskIronAdvisorButton
                  contextType="portal-rental-contract"
                  contextId={contract.id}
                  contextTitle={contract.equipment?.label ?? contract.requestedCategory ?? "Rental booking"}
                  draftPrompt="Review this rental booking request. Explain whether unit assignment, payment, or dealership review is the current blocker and what should happen next."
                  preferredSurface="sheet"
                  variant="inline"
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                  label="Ask Iron"
                />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Metric label="Assignment" value={contract.assignmentStatus === "pending_assignment" ? "Pending" : "Assigned"} detail={contract.equipment?.label ?? contract.requestedCategory ?? "Unit selection in progress"} />
                <Metric label="Estimate" value={formatCurrency(contract.pricingEstimate?.dailyRate ?? null)} detail={contract.pricingEstimate?.sourceLabel ?? "base rate"} />
                  <Metric label="Deposit" value={formatCurrency(contract.depositAmount)} detail={contract.depositStatus ?? "not required"} />
                  <Metric label="Delivery" value={contract.deliveryMode} detail={contract.branchLabel ?? "branch pending"} />
                  <Metric label={signingReadiness.label} value={signingReadiness.value} detail={signingReadiness.detail} />
                </div>

                <p className="mt-2 text-[11px] text-muted-foreground">
                  VESign provider status is still blocked pending {vesignRequirementsText()}.
                </p>

                <RentalPaymentStatusCard
                  payment={contract.paymentStatusView}
                  description={`Rental booking for ${contract.equipment?.label ?? contract.requestedCategory ?? "rental request"}`}
                  finalizeLabel="Finalize rental after payment"
                  finalizePending={finalizePaymentMutation.isPending}
                  onFinalize={() => finalizePaymentMutation.mutate({ kind: "contract", id: contract.id })}
                />

                {canEditPortalRentalBooking(contract) ? (
                  <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Update booking request</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Input
                        type="date"
                        value={bookingStartDates[contract.id] ?? contract.requestedStartDate ?? ""}
                        onChange={(event) => setBookingStartDates((current) => ({ ...current, [contract.id]: event.target.value }))}
                      />
                      <Input
                        type="date"
                        value={bookingEndDates[contract.id] ?? contract.requestedEndDate ?? ""}
                        onChange={(event) => setBookingEndDates((current) => ({ ...current, [contract.id]: event.target.value }))}
                      />
                    </div>
                    <Input
                      className="mt-2"
                      value={bookingNotes[contract.id] ?? contract.customerNotes ?? ""}
                      onChange={(event) => setBookingNotes((current) => ({ ...current, [contract.id]: event.target.value }))}
                      placeholder="Update request notes"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => updateRequestMutation.mutate({
                          kind: "contract",
                          id: contract.id,
                          requested_start_date: bookingStartDates[contract.id] || contract.requestedStartDate,
                          requested_end_date: bookingEndDates[contract.id] || contract.requestedEndDate,
                          customer_notes: bookingNotes[contract.id] || contract.customerNotes,
                        })}
                      >
                        Update
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => updateRequestMutation.mutate({ kind: "contract", id: contract.id, action: "cancel" })}
                      >
                        Cancel request
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          }}
          emptyText="No booking requests are in flight right now."
        />

        <Section
          title="Active rentals"
          icon={PackageCheck}
          items={activeContracts}
          renderItem={(contract) => {
            const relatedExtensions = extensionRequests.filter((item) => item.rentalContractId === contract.id);
            const pendingExtension = relatedExtensions.find((item) => ["submitted", "reviewing"].includes(item.status));
            const signingReadiness = summarizeRentalSigningReadiness({ signedTermsUrl: contract.signedTermsUrl });
            return (
              <Card key={contract.id} className="border-white/10 bg-white/[0.04] p-5 text-white">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone(contract.status)}`}>
                        {contract.status.replace(/_/g, " ")}
                      </span>
                      {contract.branchLabel && <span className="text-[11px] uppercase tracking-[0.18em] text-white/45">{contract.branchLabel}</span>}
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-white">
                      {contract.equipment?.label ?? contract.requestedCategory ?? "Rental contract"}
                    </h2>
                    <p className="mt-1 text-sm text-white/60">
                      {formatDate(contract.approvedStartDate ?? contract.requestedStartDate)} → {formatDate(contract.approvedEndDate ?? contract.requestedEndDate)}
                    </p>
                    {contract.dealerResponse ? (
                      <p className="mt-2 text-sm text-foreground">{contract.dealerResponse}</p>
                    ) : null}
                  </div>

                  <AskIronAdvisorButton
                    contextType="portal-rental-contract"
                    contextId={contract.id}
                    contextTitle={contract.equipment?.label ?? contract.requestedCategory ?? "Rental contract"}
                    draftPrompt="Review this rental contract. Explain current state, pricing, payment blockers, and what action should happen next."
                    preferredSurface="sheet"
                    variant="inline"
                    className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                    label="Ask Iron"
                  />
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Deposit" value={formatCurrency(contract.depositAmount)} detail={contract.depositStatus ?? "not required"} />
                  <Metric label="Agreed daily" value={formatCurrency(contract.agreedRates?.dailyRate ?? null)} detail={contract.agreedRates?.sourceLabel ?? "pending"} />
                  <Metric label="Delivery" value={contract.deliveryMode} detail={contract.branchLabel ?? "branch pending"} />
                  <Metric label={signingReadiness.label} value={signingReadiness.value} detail={signingReadiness.detail} />
                </div>

                <p className="mt-2 text-[11px] text-muted-foreground">
                  VESign provider status is still blocked pending {vesignRequirementsText()}.
                </p>

                <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Request extension</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                      type="date"
                      value={extensionDates[contract.id] ?? ""}
                      onChange={(event) => setExtensionDates((current) => ({ ...current, [contract.id]: event.target.value }))}
                    />
                    <Input
                      value={extensionNotes[contract.id] ?? ""}
                      onChange={(event) => setExtensionNotes((current) => ({ ...current, [contract.id]: event.target.value }))}
                      placeholder="Reason for extension"
                    />
                    <Button
                      onClick={() => extensionMutation.mutate({
                        rental_contract_id: contract.id,
                        requested_end_date: extensionDates[contract.id],
                        customer_reason: extensionNotes[contract.id] || null,
                      })}
                      disabled={extensionMutation.isPending || !extensionDates[contract.id] || !canRequestPortalRentalExtension(contract, Boolean(pendingExtension))}
                    >
                      {pendingExtension ? "Extension pending" : "Request extension"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          }}
          emptyText="No active rental contracts are visible right now."
        />

        <Section
          title="Extension requests"
          icon={RotateCcw}
          items={extensionRequests}
          renderItem={(extension) => (
            <Card key={extension.id} className="border-white/10 bg-white/[0.04] p-5 text-white">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">Extension request</p>
                  <p className="mt-1 text-sm text-white/60">
                    Requested end date {formatDate(extension.requestedEndDate)}
                    {extension.approvedEndDate ? ` · approved ${formatDate(extension.approvedEndDate)}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone(extension.status)}`}>
                  {extension.status.replace(/_/g, " ")}
                </span>
              </div>
              {extension.customerReason ? <p className="mt-2 text-sm text-foreground">{extension.customerReason}</p> : null}
              {extension.dealerResponse ? <p className="mt-2 text-sm text-white/70">{extension.dealerResponse}</p> : null}
              {extension.additionalCharge != null ? (
                <p className="mt-2 text-sm text-white/70">Additional charge {formatCurrency(extension.additionalCharge)}</p>
              ) : null}

              <RentalPaymentStatusCard
                payment={extension.paymentStatusView}
                description="Approved rental extension"
                finalizeLabel="Finalize extension after payment"
                finalizePending={finalizePaymentMutation.isPending}
                onFinalize={() => finalizePaymentMutation.mutate({ kind: "extension", id: extension.id })}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {canEditPortalRentalExtension(extension) && (
                  <>
                    <Input
                      type="date"
                      value={extensionDates[extension.id] ?? extension.requestedEndDate ?? ""}
                      onChange={(event) => setExtensionDates((current) => ({ ...current, [extension.id]: event.target.value }))}
                    />
                    <Input
                      value={extensionNotes[extension.id] ?? extension.customerReason ?? ""}
                      onChange={(event) => setExtensionNotes((current) => ({ ...current, [extension.id]: event.target.value }))}
                      placeholder="Update reason"
                    />
                    <Button
                      variant="outline"
                      onClick={() => updateRequestMutation.mutate({
                        kind: "extension",
                        id: extension.id,
                        requested_end_date: extensionDates[extension.id] || extension.requestedEndDate,
                        customer_reason: extensionNotes[extension.id] || extension.customerReason,
                      })}
                    >
                      Update
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => updateRequestMutation.mutate({ kind: "extension", id: extension.id, action: "cancel" })}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </Card>
          )}
          emptyText="No extension requests are in flight right now."
        />

        <Section
          title="Return & closeout"
          icon={ClipboardCheck}
          items={returns}
          renderItem={(rental) => (
            <Card key={rental.id} className="border-white/10 bg-white/[0.04] p-5 text-white shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone(rental.status)}`}>
                      {rental.status.replace(/_/g, " ")}
                    </span>
                    {rental.rentalContractReference && (
                      <span className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                        Contract {rental.rentalContractReference}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-white">
                    {rental.equipment?.label ?? "Rental equipment"}
                  </h2>
                  <p className="mt-1 text-sm text-white/60">
                    {rental.equipment?.serialNumber ? `S/N ${rental.equipment.serialNumber}` : "Serial unavailable"}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Metric label="Inspection" value={formatDate(rental.inspectionDate)} detail={`Decision ${formatDate(rental.decisionAt)}`} />
                <Metric label="Damage" value={rental.hasCharges == null ? "Pending" : rental.hasCharges ? "Charges applied" : "Clean return"} detail={`Charge amount ${formatCurrency(rental.chargeAmount)}`} />
                <Metric label="Refund" value={rental.refundStatus?.replace(/_/g, " ") ?? "Not started"} detail={`Deposit ${formatCurrency(rental.depositAmount)}`} />
                <Metric label="Balance" value={formatCurrency(rental.balanceDue)} detail={`Deposit covers charges ${rental.hasCharges === false ? "not needed" : "review required"}`} />
              </div>
            </Card>
          )}
          emptyText="No rental returns are visible for this portal customer yet."
        />
      </div>
    </PortalLayout>
  );
}

function Section<T>({
  title,
  icon: Icon,
  items,
  renderItem,
  emptyText,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  emptyText: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      </div>
      {items.length > 0 ? items.map(renderItem) : (
        <Card className="border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-white/65">
          {emptyText}
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-white/50">{detail}</p>
    </div>
  );
}
