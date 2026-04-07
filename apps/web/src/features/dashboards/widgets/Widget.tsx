/**
 * Widget — standardized wrapper for dashboard widgets.
 *
 * Every widget on the new Iron dashboard shell renders inside this shell so
 * the dashboard has consistent spacing, header treatment, and loading/error
 * states. Widgets remain free to render whatever JSX they want in `children`.
 *
 * Once per-user customization ships, this is also the natural place to hang
 * a "remove" / drag handle without touching every widget impl.
 */
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { AlertTriangle, Loader2 } from "lucide-react";

export interface WidgetProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
  className?: string;
}

export function Widget({
  title,
  description,
  icon,
  action,
  loading = false,
  error = null,
  children,
  className,
}: WidgetProps) {
  return (
    <Card className={`p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {icon && <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
