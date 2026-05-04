import { Link } from "react-router-dom";
import { Activity, AlertTriangle, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getTethrReadinessSurfaceCopy,
  TETHR_PROVIDER_KEY,
  TETHR_PROVIDER_REQUIREMENTS,
  type TethrActionSurface,
} from "../lib/tethr-readiness";

interface TethrReadinessActionProps {
  surface: TethrActionSurface;
  compact?: boolean;
  fallbackHref?: string;
}

export function TethrReadinessAction({ surface, compact = false, fallbackHref }: TethrReadinessActionProps) {
  const copy = getTethrReadinessSurfaceCopy(surface);

  return (
    <Card className={compact ? "border-amber-500/20 bg-amber-500/5 p-3" : "border-amber-500/20 bg-amber-500/5 p-4"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <LockKeyhole className="mr-1 h-3 w-3" aria-hidden />
              Provider blocked
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">{TETHR_PROVIDER_KEY}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-foreground">{copy.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled aria-disabled="true" className="h-8 text-xs">
            <Activity className="mr-1 h-3.5 w-3.5" aria-hidden />
            Tethr It Now
          </Button>
          {fallbackHref ? (
            <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
              <Link to={fallbackHref}>{copy.fallbackLabel}</Link>
            </Button>
          ) : null}
        </div>
      </div>
      {!compact ? (
        <div className="mt-3 rounded-lg border border-border/70 bg-card/70 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            Requirements before live Tethr wiring
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {TETHR_PROVIDER_REQUIREMENTS.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-[6px] h-1 w-1 rounded-full bg-amber-500" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
