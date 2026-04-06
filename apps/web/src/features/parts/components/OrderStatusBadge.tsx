import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant } from "../lib/order-status-machine";

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={statusBadgeVariant(status)}>{status}</Badge>;
}
