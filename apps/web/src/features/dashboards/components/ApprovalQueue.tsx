import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

interface ApprovalItem {
  id: string;
  deal_id?: string;
  type: "demo" | "trade" | "margin";
  label: string;
  detail: string;
}

interface ApprovalQueueProps {
  items: ApprovalItem[];
}

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  demo: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Demo" },
  trade: { bg: "bg-violet-500/10", text: "text-violet-400", label: "Trade" },
  margin: { bg: "bg-red-500/10", text: "text-red-400", label: "Margin" },
};

export function ApprovalQueue({ items }: ApprovalQueueProps) {
  if (items.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground">No pending approvals.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">Approval Queue ({items.length})</h3>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const style = TYPE_STYLES[item.type] || TYPE_STYLES.demo;
          return (
            <Link
              key={`${item.type}-${item.id}`}
              to={item.deal_id ? `/crm/deals/${item.deal_id}` : "#"}
              className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:border-foreground/20 transition"
            >
              <div>
                <span className={`inline-block rounded-full ${style.bg} px-2 py-0.5 text-[10px] font-medium ${style.text} mr-2`}>
                  {style.label}
                </span>
                <span className="text-sm font-medium text-foreground">{item.label}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
