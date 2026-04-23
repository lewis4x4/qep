import { Link } from "react-router-dom";
import { Cog, ExternalLink, Package, ShoppingCart, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  jobId: string;
  fulfillmentRunId: string | null;
  variant?: "service" | "floor";
}

const serviceLinkClass = cn(
  "inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1.5",
  "text-[11px] font-medium text-foreground shadow-sm transition-colors",
  "hover:bg-muted/80 hover:border-border dark:bg-white/[0.04] dark:hover:bg-white/[0.07]",
);

const floorLinkClass = cn(
  "inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--qep-deck-rule))] bg-[hsl(var(--qep-deck))]/80 px-2.5 py-1.5",
  "text-[11px] font-semibold text-foreground shadow-sm transition-colors",
  "hover:border-[hsl(var(--qep-orange))]/40 hover:bg-[hsl(var(--qep-orange))]/5",
);

/** When a job drawer is open: quick jumps for parts fulfillment workflows (B3). */
export function ServicePartsHubStrip({ jobId, fulfillmentRunId, variant = "service" }: Props) {
  const isFloor = variant === "floor";
  const linkClass = isFloor ? floorLinkClass : serviceLinkClass;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
        isFloor
          ? "border-[hsl(var(--qep-orange))]/30 bg-[hsl(var(--qep-orange))]/5"
          : "border-amber-600/25 bg-amber-500/[0.06] dark:border-amber-500/20 dark:bg-amber-500/[0.08]",
      )}
    >
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          isFloor
            ? "text-[hsl(var(--qep-orange))]"
            : "text-amber-900/90 dark:text-amber-200/90",
        )}
      >
        Parts hub
      </span>
      <Link
        to={`/service/parts`}
        className={linkClass}
        title="Shop parts work queue"
      >
        <Package className={cn("h-3.5 w-3.5", isFloor ? "text-[hsl(var(--qep-orange))]" : "text-primary")} />
        Queue
      </Link>
      <Link to="/service/portal-parts" className={linkClass} title="Portal parts orders">
        <ShoppingCart className={cn("h-3.5 w-3.5", isFloor ? "text-[hsl(var(--qep-orange))]" : "text-primary")} />
        Portal orders
      </Link>
      {fulfillmentRunId ? (
        <Link
          to={`/service/fulfillment/${fulfillmentRunId}`}
          className={linkClass}
          title="Fulfillment run audit trail"
        >
          <Truck className={cn("h-3.5 w-3.5", isFloor ? "text-[hsl(var(--qep-orange))]" : "text-primary")} />
          Fulfillment run
        </Link>
      ) : null}
      <Link
        to="/parts"
        className={linkClass}
        title="Standalone parts module"
      >
        <Cog className={cn("h-3.5 w-3.5", isFloor ? "text-[hsl(var(--qep-orange))]" : "text-primary")} />
        Parts module
      </Link>
      <Link
        to={`/service?job=${encodeURIComponent(jobId)}`}
        className={cn(linkClass, "border-dashed text-muted-foreground")}
        title="Focus this job in the command center"
      >
        <ExternalLink className="h-3 w-3" />
        Job
      </Link>
    </div>
  );
}
