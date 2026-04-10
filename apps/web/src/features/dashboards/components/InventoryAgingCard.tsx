import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";

export interface AgingEquipmentRow {
  id: string;
  name: string;
  created_at: string;
  company_id: string;
  crm_companies?: { name: string | null } | { name: string | null }[] | null;
}

function companyLabel(row: AgingEquipmentRow): string {
  const c = row.crm_companies;
  if (!c) return "Unknown account";
  if (Array.isArray(c)) return c[0]?.name?.trim() || "Unknown account";
  return c.name?.trim() || "Unknown account";
}

function daysSince(iso: string): number {
  const start = new Date(iso).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.floor((Date.now() - start) / (24 * 60 * 60 * 1000));
}

interface InventoryAgingCardProps {
  items: AgingEquipmentRow[];
}

export function InventoryAgingCard({ items }: InventoryAgingCardProps) {
  if (items.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Inventory aging</h3>
        </div>
        <p className="text-sm text-muted-foreground">No fleet units over 90 days in the registry.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Package className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">Inventory aging ({items.length})</h3>
        <Link to="/qrm/inventory-pressure" className="ml-auto text-[11px] text-qep-orange hover:underline">
          Open board
        </Link>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Equipment registry records older than 90 days — review wholesale, auction, or repricing plays.
      </p>
      <div className="space-y-2">
        {items.map((row) => {
          const days = daysSince(row.created_at);
          return (
            <Link
              key={row.id}
              to={`/equipment/${row.id}`}
              className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground truncate block">{row.name}</span>
                <span className="text-xs text-muted-foreground truncate block">{companyLabel(row)}</span>
              </div>
              <span className="text-xs font-medium tabular-nums text-amber-400 shrink-0 ml-2">{days}d</span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
