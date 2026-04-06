import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PartsSubNav } from "../components/PartsSubNav";
import { OrderPipelineBoard } from "../components/OrderPipelineBoard";
import { InventoryHealthCard } from "../components/InventoryHealthCard";
import { VendorMetricsCard } from "../components/VendorMetricsCard";
import { DemandForecastCard } from "../components/DemandForecastCard";
import { VoicePartsOrderButton } from "../components/VoicePartsOrderButton";
import { ReplenishmentApprovalCard } from "../components/ReplenishmentApprovalCard";
import { PredictiveKitsCard } from "../components/PredictiveKitsCard";
import { TransferRecommendationsCard } from "../components/TransferRecommendationsCard";
import { usePartsOrders } from "../hooks/usePartsOrders";
import { useInventoryHealth } from "../hooks/useInventoryHealth";
import { useDemandForecast } from "../hooks/useDemandForecast";
import { useReplenishQueue } from "../hooks/useReplenishQueue";
import { usePredictiveKits } from "../hooks/usePredictiveKits";
import { useTransferRecommendations } from "../hooks/useTransferRecommendations";

export function PartsCommandCenterPage() {
  const ordersQ = usePartsOrders();
  const invQ = useInventoryHealth();
  const forecastQ = useDemandForecast();
  const replenishQ = useReplenishQueue();
  const kitsQ = usePredictiveKits();
  const transfersQ = useTransferRecommendations();

  const openOrders =
    ordersQ.data?.filter((r) => !["delivered", "cancelled"].includes(r.status)).length ?? 0;

  const healthData = invQ.data;
  const stockoutCount = healthData?.rows.filter((r) => r.stock_status === "stockout").length ?? 0;

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Parts command center</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Counter sales, inventory, vendors, and fulfillment — independent of service jobs.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/parts/orders/new">New counter / phone order</Link>
        </Button>
        <VoicePartsOrderButton />
        <Button asChild variant="outline" size="sm">
          <Link to="/parts/catalog">Browse catalog</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/parts/fulfillment">Fulfillment runs</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/parts/analytics">Analytics</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/parts/lab">Vision deck (lab)</Link>
        </Button>
      </div>

      {/* Orders section — loading/error only gates the pipeline, not all cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card className="p-4">
          {ordersQ.isLoading ? (
            <div className="space-y-2">
              <div className="h-3 w-20 rounded bg-muted animate-pulse" />
              <div className="h-8 w-12 rounded bg-muted animate-pulse" />
            </div>
          ) : ordersQ.isError ? (
            <p className="text-xs text-destructive">Orders unavailable</p>
          ) : (
            <>
              <p className="text-[11px] font-medium uppercase text-muted-foreground">Open orders</p>
              <p className="text-3xl font-semibold tabular-nums">{openOrders}</p>
              <Link
                to="/parts/orders"
                className="text-xs text-primary mt-2 inline-block underline-offset-2 hover:underline"
              >
                View all orders
              </Link>
            </>
          )}
        </Card>
        <VendorMetricsCard />
        {stockoutCount > 0 && (
          <Card className="p-4 border-red-500/30 bg-red-500/5">
            <p className="text-[11px] font-medium uppercase text-red-700 dark:text-red-400">
              Stockouts
            </p>
            <p className="text-3xl font-semibold tabular-nums text-red-700 dark:text-red-400">
              {stockoutCount}
            </p>
            <Link
              to="/parts/inventory"
              className="text-xs text-red-700 dark:text-red-400 mt-2 inline-block underline-offset-2 hover:underline"
            >
              Resolve now
            </Link>
          </Card>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium mb-2">Pipeline</h2>
        {ordersQ.isLoading ? (
          <div className="h-24 rounded bg-muted animate-pulse" />
        ) : (
          <OrderPipelineBoard rows={ordersQ.data ?? []} />
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <InventoryHealthCard
          rows={healthData?.rows ?? []}
          mode={healthData?.mode ?? "static"}
          threshold={healthData?.threshold ?? 3}
          isLoading={invQ.isLoading}
          isError={invQ.isError}
          errorMessage={(invQ.error as Error | null)?.message ?? undefined}
        />
        <DemandForecastCard
          data={forecastQ.data}
          isLoading={forecastQ.isLoading}
          isError={forecastQ.isError}
          errorMessage={(forecastQ.error as Error | null)?.message ?? undefined}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <ReplenishmentApprovalCard
          data={replenishQ.data}
          isLoading={replenishQ.isLoading}
          isError={replenishQ.isError}
          errorMessage={(replenishQ.error as Error | null)?.message ?? undefined}
        />
        <PredictiveKitsCard
          data={kitsQ.data}
          isLoading={kitsQ.isLoading}
          isError={kitsQ.isError}
          errorMessage={(kitsQ.error as Error | null)?.message ?? undefined}
        />
      </div>

      <TransferRecommendationsCard
        data={transfersQ.data}
        isLoading={transfersQ.isLoading}
        isError={transfersQ.isError}
        errorMessage={(transfersQ.error as Error | null)?.message ?? undefined}
      />
    </div>
  );
}
