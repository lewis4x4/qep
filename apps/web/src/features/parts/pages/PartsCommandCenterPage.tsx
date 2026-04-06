import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PartsSubNav } from "../components/PartsSubNav";
import { OrderPipelineBoard } from "../components/OrderPipelineBoard";
import { InventoryHealthCard } from "../components/InventoryHealthCard";
import { VendorMetricsCard } from "../components/VendorMetricsCard";
import { usePartsOrders } from "../hooks/usePartsOrders";
import { useInventoryHealth } from "../hooks/useInventoryHealth";

export function PartsCommandCenterPage() {
  const ordersQ = usePartsOrders();
  const invQ = useInventoryHealth();

  const openOrders =
    ordersQ.data?.filter((r) => !["delivered", "cancelled"].includes(r.status)).length ?? 0;

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
        <Button asChild variant="outline" size="sm">
          <Link to="/parts/catalog">Browse catalog</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/parts/fulfillment">Fulfillment runs</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/parts/lab">Vision deck (lab)</Link>
        </Button>
      </div>

      {ordersQ.isLoading ? (
        <div
          className="flex justify-center py-12"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="sr-only">Loading parts dashboard</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      ) : ordersQ.isError ? (
        <Card className="p-4 text-sm text-destructive border-destructive/40">
          {(ordersQ.error as Error)?.message ?? "Failed to load orders."}
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-[11px] font-medium uppercase text-muted-foreground">Open orders</p>
              <p className="text-3xl font-semibold tabular-nums">{openOrders}</p>
              <Link
                to="/parts/orders"
                className="text-xs text-primary mt-2 inline-block underline-offset-2 hover:underline"
              >
                View all orders
              </Link>
            </Card>
            <VendorMetricsCard />
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">Pipeline</h2>
            <OrderPipelineBoard rows={ordersQ.data ?? []} />
          </div>

          <InventoryHealthCard
            rows={invQ.data?.rows ?? []}
            threshold={invQ.data?.threshold ?? 3}
            isLoading={invQ.isLoading}
            isError={invQ.isError}
            errorMessage={(invQ.error as Error | null)?.message ?? undefined}
          />
        </>
      )}
    </div>
  );
}
