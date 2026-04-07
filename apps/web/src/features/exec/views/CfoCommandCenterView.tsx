/**
 * CFO lens — placeholder until Slice 3 ships finance KPIs + sub-views.
 */
import { Card } from "@/components/ui/card";
import { Wallet } from "lucide-react";

export function CfoCommandCenterView() {
  return (
    <Card className="p-8 text-center">
      <Wallet className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-foreground">CFO lens</p>
      <p className="mt-2 max-w-md mx-auto text-[11px] text-muted-foreground">
        Cash, A/R, deposits, refund exposure, payment exceptions, receipt compliance,
        hauling recovery, and the loaded margin waterfall ship in Slice 3.
      </p>
    </Card>
  );
}
