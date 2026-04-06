import { Card } from "@/components/ui/card";
import { useOrderEvents, type OrderEvent } from "../hooks/useOrderEvents";

const EVENT_LABELS: Record<string, string> = {
  created: "Order created",
  submitted: "Submitted to fulfillment",
  confirmed: "Confirmed",
  processing: "Processing / picking",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  lines_updated: "Line items updated",
  fields_updated: "Order fields updated",
  pick_completed: "Inventory pick completed",
  auto_replenish_created: "Auto-replenishment created",
  auto_replenish_approved: "Replenishment approved",
  auto_replenish_auto_approved: "Auto-approved by system",
  vendor_confirmed: "Vendor confirmed order",
  tracking_received: "Tracking number received",
  delivery_scanned: "Delivery scanned",
  notification_sent: "Notification sent",
  escalation_triggered: "Escalation triggered",
};

const EVENT_COLORS: Record<string, string> = {
  created: "bg-blue-500",
  submitted: "bg-indigo-500",
  confirmed: "bg-emerald-500",
  processing: "bg-amber-500",
  shipped: "bg-purple-500",
  delivered: "bg-green-600",
  cancelled: "bg-red-500",
  pick_completed: "bg-teal-500",
  auto_replenish_created: "bg-cyan-500",
  auto_replenish_auto_approved: "bg-cyan-600",
  escalation_triggered: "bg-red-600",
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((now - t) / 1000);

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function EventRow({ event }: { event: OrderEvent }) {
  const dotColor = EVENT_COLORS[event.event_type] ?? "bg-muted-foreground";
  const label = EVENT_LABELS[event.event_type] ?? event.event_type.replace(/_/g, " ");
  const sourceLabel = event.source === "manual" ? null : event.source;

  return (
    <div className="flex gap-3 items-start relative">
      <div className="flex flex-col items-center shrink-0 pt-1">
        <span className={`block w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-background`} />
        <span className="block w-px flex-1 bg-border" />
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{label}</span>
          {sourceLabel && (
            <span className="text-[10px] rounded px-1 py-0.5 bg-muted text-muted-foreground">
              {sourceLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
          <time dateTime={event.created_at}>{relativeTime(event.created_at)}</time>
          {event.actor_name && (
            <>
              <span>·</span>
              <span>{event.actor_name}</span>
            </>
          )}
          {event.from_status && event.to_status && (
            <>
              <span>·</span>
              <span>
                {event.from_status} → {event.to_status}
              </span>
            </>
          )}
        </div>
        {Object.keys(event.metadata).length > 0 && (
          <MetadataChips metadata={event.metadata} />
        )}
      </div>
    </div>
  );
}

function MetadataChips({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(
    ([, v]) => v != null && v !== "" && typeof v !== "object",
  );
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.slice(0, 4).map(([k, v]) => (
        <span
          key={k}
          className="inline-flex text-[10px] rounded px-1.5 py-0.5 bg-muted/60 text-muted-foreground font-mono"
        >
          {k.replace(/_/g, " ")}: {String(v)}
        </span>
      ))}
    </div>
  );
}

interface Props {
  orderId: string | null;
}

export function OrderTimelineCard({ orderId }: Props) {
  const { data: events, isLoading, isError, error } = useOrderEvents(orderId);

  if (!orderId) return null;

  return (
    <Card className="p-4 space-y-3">
      <h2 className="text-sm font-medium">Order timeline</h2>
      {isLoading && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading events…</p>
      )}
      {isError && (
        <p className="text-xs text-destructive">
          {(error as Error)?.message ?? "Could not load timeline."}
        </p>
      )}
      {events && events.length === 0 && (
        <p className="text-xs text-muted-foreground">No events recorded yet.</p>
      )}
      {events && events.length > 0 && (
        <div className="pt-1">
          {events.map((ev) => (
            <EventRow key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </Card>
  );
}
