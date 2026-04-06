import { Card } from "@/components/ui/card";
import type { PartsOrderListRow } from "../hooks/usePartsOrders";

const PIPELINE = [
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "confirmed", label: "Confirmed" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
] as const;

export function OrderPipelineBoard({ rows }: { rows: PartsOrderListRow[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {PIPELINE.map(({ key, label }) => (
        <Card key={key} className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {rows.filter((r) => r.status === key).length}
          </p>
        </Card>
      ))}
    </div>
  );
}
