import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { PortalLayout } from "../components/PortalLayout";
import { portalApi } from "../lib/portal-api";
import { AskIronAdvisorButton } from "@/components/primitives";
import type { PortalRentalReturnWorkspaceView } from "../../../../../../shared/qep-moonshot-contracts";
import { ClipboardCheck, Receipt, RotateCcw, ShieldAlert } from "lucide-react";

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
  if (status === "completed") return "bg-emerald-500/10 text-emerald-300";
  if (status === "refund_processing") return "bg-blue-500/10 text-blue-300";
  if (status === "damage_assessment" || status === "work_order_open") return "bg-red-500/10 text-red-300";
  return "bg-amber-500/10 text-amber-300";
}

export function PortalRentalsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "rentals"],
    queryFn: portalApi.getRentals,
    staleTime: 30_000,
  });

  const rentals = data?.rentals ?? [];

  return (
    <PortalLayout>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="border-white/10 bg-white/[0.04] p-5 text-white shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Rental closeout board</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Open returns</p>
              <p className="mt-3 text-3xl font-semibold text-white">{rentals.filter((item) => item.status !== "completed").length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Charge exposure</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {formatCurrency(rentals.reduce((sum, item) => sum + (item.chargeAmount ?? 0), 0))}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Refunds pending</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {rentals.filter((item) => item.refundStatus === "pending" || item.refundStatus === "processing").length}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-qep-orange/20 bg-qep-orange/10 p-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Ask Iron</p>
          <p className="mt-3 text-sm leading-6 text-white/75">
            Ask which returns need intervention first, where refund risk is building, and whether any closeouts are stuck.
          </p>
          <div className="mt-4">
            <AskIronAdvisorButton
              contextType="portal-rentals"
              contextTitle="Portal rentals"
              draftPrompt="Review the customer rental closeout board. Which returns are stuck, where is refund or damage risk building, and what should happen next?"
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
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="h-44 animate-pulse border-white/10 bg-white/[0.03]" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="mt-4 border-red-500/20 bg-red-500/5 p-6">
          <p className="text-sm text-red-300">Failed to load rental return status.</p>
        </Card>
      )}

      <div className="mt-4 space-y-4">
        {rentals.map((rental: PortalRentalReturnWorkspaceView) => (
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
              <AskIronAdvisorButton
                contextType="portal-rental-return"
                contextId={rental.id}
                contextTitle={rental.equipment?.label ?? "Rental return"}
                draftPrompt={`Review this rental return. Explain inspection status, charge exposure, refund posture, and what the customer should expect next.`}
                evidence={[
                  `Status: ${rental.status}`,
                  `Inspection date: ${rental.inspectionDate ?? "unknown"}`,
                  `Charges: ${rental.hasCharges == null ? "pending" : rental.hasCharges ? "yes" : "no"}`,
                  `Charge amount: ${rental.chargeAmount ?? 0}`,
                  `Refund status: ${rental.refundStatus ?? "none"}`,
                ].join("\n")}
                preferredSurface="sheet"
                variant="inline"
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                label="Ask Iron"
              />
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
                <div className="flex items-center gap-2 text-white/55">
                  <ClipboardCheck className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Inspection</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">{formatDate(rental.inspectionDate)}</p>
                <p className="mt-1 text-xs text-white/50">Decision {formatDate(rental.decisionAt)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
                <div className="flex items-center gap-2 text-white/55">
                  <ShieldAlert className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Damage</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {rental.hasCharges == null ? "Pending" : rental.hasCharges ? "Charges applied" : "Clean return"}
                </p>
                <p className="mt-1 text-xs text-white/50">Charge amount {formatCurrency(rental.chargeAmount)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
                <div className="flex items-center gap-2 text-white/55">
                  <RotateCcw className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Refund</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">{rental.refundStatus?.replace(/_/g, " ") ?? "Not started"}</p>
                <p className="mt-1 text-xs text-white/50">Deposit {formatCurrency(rental.depositAmount)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
                <div className="flex items-center gap-2 text-white/55">
                  <Receipt className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Balance</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(rental.balanceDue)}</p>
                <p className="mt-1 text-xs text-white/50">Deposit covers charges {rental.hasCharges === false ? "not needed" : "review required"}</p>
              </div>
            </div>
          </Card>
        ))}

        {!isLoading && rentals.length === 0 && (
          <Card className="border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-white/65">
            No rental returns are visible for this portal customer yet.
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
