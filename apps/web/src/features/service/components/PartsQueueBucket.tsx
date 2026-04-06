import { Link } from "react-router-dom";
import type { PartsQueueItem } from "../hooks/usePartsQueue";

interface Props {
  title: string;
  items: PartsQueueItem[];
  accentColor?: string;
  onAction?: (requirementId: string, action: string) => void;
}

export function PartsQueueBucket({ title, items, accentColor = "bg-slate-100", onAction }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border overflow-hidden">
      <div className={`px-4 py-2 ${accentColor}`}>
        <h3 className="text-sm font-semibold">
          {title} <span className="text-muted-foreground font-normal">({items.length})</span>
        </h3>
      </div>
      <div className="divide-y">
        {items.map((item) => {
          const flags = item.job?.status_flags;
          const isMachineDown =
            Array.isArray(flags) && flags.includes("machine_down");
          return (
            <div key={item.id} className={`px-4 py-3 flex items-center gap-4 ${isMachineDown ? "bg-red-50/50" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{item.part_number}</span>
                  <span className="text-xs text-muted-foreground">x{item.quantity}</span>
                  {isMachineDown && (
                    <span className="text-[10px] font-medium bg-red-100 text-red-700 rounded-full px-1.5 py-0.5">
                      MACHINE DOWN
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.job?.customer?.name ?? "Unknown"} &middot;{" "}
                  {item.job?.machine ? `${item.job.machine.make} ${item.job.machine.model}` : "No machine"}
                </p>
                {item.job?.fulfillment_run_id ? (
                  <p className="text-[10px] mt-1">
                    <Link
                      to={`/service/fulfillment/${item.job.fulfillment_run_id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Fulfillment run
                    </Link>
                  </p>
                ) : null}
              </div>
              <div className="text-right shrink-0">
                {item.need_by_date && (
                  <p className="text-xs font-medium">
                    Need by: {new Date(item.need_by_date).toLocaleDateString()}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{item.status}</p>
              </div>
              {onAction && (
                <div className="flex gap-1 shrink-0">
                  {item.status === "pending" && (
                    <button
                      onClick={() => onAction(item.id, "pick")}
                      className="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition"
                    >
                      Pick
                    </button>
                  )}
                  {item.status === "ordering" && (
                    <button
                      onClick={() => onAction(item.id, "receive")}
                      className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition"
                    >
                      Received
                    </button>
                  )}
                  {item.status === "received" && (
                    <button
                      onClick={() => onAction(item.id, "stage")}
                      className="text-xs px-2 py-1 rounded bg-lime-100 text-lime-700 hover:bg-lime-200 transition"
                    >
                      Stage
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
