import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";

type Row = {
  id: string;
  branch_id: string;
  part_number: string;
  qty_on_hand: number;
  bin_location: string | null;
};

export function InventoryHealthCard({
  rows,
  threshold,
  isLoading,
  isError = false,
  errorMessage,
}: {
  rows: Row[];
  threshold: number;
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-medium">Low stock (≤ {threshold})</h2>
        <Link to="/parts/inventory" className="text-xs text-primary underline-offset-2 hover:underline">
          Inventory
        </Link>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage ?? "Inventory health failed to load."}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No low-stock rows in the sample.</p>
      ) : (
        <ul className="space-y-1.5 text-xs max-h-40 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-2 border-b border-border/40 pb-1">
              <span className="font-mono truncate">{r.part_number}</span>
              <span className="text-muted-foreground shrink-0">
                {r.branch_id} · {r.qty_on_hand} ea
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
