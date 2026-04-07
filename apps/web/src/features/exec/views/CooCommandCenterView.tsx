/**
 * COO lens — placeholder until Slice 4 ships ops KPIs + sub-views.
 */
import { Card } from "@/components/ui/card";
import { Truck } from "lucide-react";

export function CooCommandCenterView() {
  return (
    <Card className="p-8 text-center">
      <Truck className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-foreground">COO lens</p>
      <p className="mt-2 max-w-md mx-auto text-[11px] text-muted-foreground">
        Today's execution board, traffic / readiness / returns rails, failure pattern
        view, and recovery queue ship in Slice 4.
      </p>
    </Card>
  );
}
