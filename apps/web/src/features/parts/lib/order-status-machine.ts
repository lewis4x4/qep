export type OrderStatus =
  | "draft"
  | "submitted"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled";

export function validNextStatuses(current: string): OrderStatus[] {
  switch (current) {
    case "draft":
      return ["submitted", "confirmed", "cancelled"];
    case "submitted":
      return ["confirmed", "cancelled"];
    case "confirmed":
      return ["processing", "cancelled"];
    case "processing":
      return ["shipped", "cancelled"];
    case "shipped":
      return ["delivered"];
    case "delivered":
    case "cancelled":
      return [];
    default:
      return ["cancelled"];
  }
}

export function statusBadgeVariant(
  s: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (s === "delivered") return "default";
  if (s === "cancelled") return "destructive";
  if (s === "shipped" || s === "processing") return "secondary";
  return "outline";
}
