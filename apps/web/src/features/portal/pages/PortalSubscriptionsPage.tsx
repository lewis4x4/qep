import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import { AskIronAdvisorButton } from "@/components/primitives";
import type { PortalSubscriptionWorkspaceView } from "../../../../../../shared/qep-moonshot-contracts";
import { CalendarClock, Gauge, RefreshCcw, ShieldCheck } from "lucide-react";

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

function statusTone(status: string): string {
  if (status === "active") return "bg-emerald-500/10 text-emerald-300";
  if (status === "pending") return "bg-amber-500/10 text-amber-300";
  if (status === "paused") return "bg-blue-500/10 text-blue-300";
  return "bg-white/10 text-white/70";
}

export function PortalSubscriptionsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "subscriptions"],
    queryFn: portalApi.getSubscriptions,
    staleTime: 30_000,
  });

  const subscriptions = data?.subscriptions ?? [];

  return (
    <PortalLayout>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Card className="border-white/10 bg-white/[0.04] p-5 text-white shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Subscription posture</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Active plans</p>
              <p className="mt-3 text-3xl font-semibold text-white">{subscriptions.filter((item) => item.status === "active").length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Open maintenance</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {subscriptions.reduce((sum, item) => sum + item.maintenanceStatus.openCount, 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Monthly base</p>
              <p className="mt-3 text-3xl font-semibold text-white">
                {formatCurrency(subscriptions.reduce((sum, item) => sum + item.baseMonthlyRate, 0))}
              </p>
            </div>
          </div>
        </Card>

        <Card className="border-qep-orange/20 bg-qep-orange/10 p-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange">Ask Iron</p>
          <p className="mt-3 text-sm leading-6 text-white/75">
            Ask for usage drift, overage exposure, maintenance timing, or which subscription needs intervention first.
          </p>
          <div className="mt-4">
            <AskIronAdvisorButton
              contextType="portal-subscriptions"
              contextTitle="Portal subscriptions"
              draftPrompt="Walk me through the active customer subscription posture. Which plans are at risk, where is usage drifting, and what action should I take next?"
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
            <Card key={index} className="h-48 animate-pulse border-white/10 bg-white/[0.03]" />
          ))}
        </div>
      )}

      {isError && (
        <Card className="mt-4 border-red-500/20 bg-red-500/5 p-6">
          <p className="text-sm text-red-300">Failed to load subscriptions.</p>
        </Card>
      )}

      <div className="mt-4 space-y-4">
        {subscriptions.map((subscription: PortalSubscriptionWorkspaceView) => (
          <Card key={subscription.id} className="border-white/10 bg-white/[0.04] p-5 text-white shadow-[0_20px_80px_rgba(0,0,0,0.18)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusTone(subscription.status)}`}>
                    {subscription.status}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/45">{subscription.planType.replace(/_/g, " ")}</span>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-white">{subscription.planName}</h2>
                <p className="mt-1 text-sm text-white/60">
                  {subscription.equipment?.label ?? "Equipment assignment pending"}
                  {subscription.equipment?.serialNumber ? ` · S/N ${subscription.equipment.serialNumber}` : ""}
                </p>
              </div>
              <AskIronAdvisorButton
                contextType="portal-subscription"
                contextId={subscription.id}
                contextTitle={subscription.planName}
                draftPrompt={`Review the ${subscription.planName} subscription. Explain usage, maintenance posture, billing timing, and whether the customer is drifting toward overage or rotation risk.`}
                evidence={[
                  `Status: ${subscription.status}`,
                  `Equipment: ${subscription.equipment?.label ?? "Unassigned"}`,
                  `Base monthly rate: ${formatCurrency(subscription.baseMonthlyRate)}`,
                  `Usage cap: ${subscription.usageCapHours ?? "none"}`,
                  `Current usage: ${subscription.usageHours ?? "unknown"}`,
                  `Open maintenance items: ${subscription.maintenanceStatus.openCount}`,
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
                  <Gauge className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Usage</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {subscription.usageHours == null ? "—" : `${subscription.usageHours.toLocaleString()} hrs`}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  Cap {subscription.usageCapHours == null ? "not set" : `${subscription.usageCapHours.toLocaleString()} hrs`}
                </p>
                <p className="mt-2 text-xs text-white/50">
                  Overage {subscription.overageHours == null ? "—" : `${subscription.overageHours.toLocaleString()} hrs`}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
                <div className="flex items-center gap-2 text-white/55">
                  <CalendarClock className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Billing</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">{formatCurrency(subscription.baseMonthlyRate)}</p>
                <p className="mt-1 text-xs text-white/50">{subscription.billingCycle ?? "custom cycle"}</p>
                <p className="mt-2 text-xs text-white/50">Next billing {formatDate(subscription.nextBillingDate)}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
                <div className="flex items-center gap-2 text-white/55">
                  <ShieldCheck className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Maintenance</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">{subscription.maintenanceStatus.openCount}</p>
                <p className="mt-1 text-xs text-white/50">
                  {subscription.includesMaintenance ? "Maintenance included" : "Maintenance not included"}
                </p>
                <p className="mt-2 text-xs text-white/50">
                  Next due {formatDate(subscription.maintenanceStatus.nextScheduledDate)}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#10192d]/70 p-4">
                <div className="flex items-center gap-2 text-white/55">
                  <RefreshCcw className="h-4 w-4 text-qep-orange" />
                  <p className="text-[11px] uppercase tracking-[0.18em]">Rotation</p>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">{formatDate(subscription.nextRotationDate)}</p>
                <p className="mt-1 text-xs text-white/50">Next recommended rotation</p>
                <p className="mt-2 text-xs text-white/50">
                  Overage rate {formatCurrency(subscription.overageRate)}
                </p>
              </div>
            </div>
          </Card>
        ))}

        {!isLoading && subscriptions.length === 0 && (
          <Card className="border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-white/65">
            No active customer subscriptions are visible yet.
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
