import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function QuoteSendActionCard({
  icon,
  title,
  detail,
  readiness,
  setupBlocked,
  busy,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  readiness: { ready: boolean; missing: string[] };
  setupBlocked?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/50 p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-qep-orange/10 p-2 text-qep-orange">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="mt-3 rounded border border-border/60 bg-card/50 px-3 py-2 text-xs">
        {readiness.ready ? (
          <span className="text-emerald-300">Ready to log this action.</span>
        ) : (
          <span className="text-amber-300">Blocked: {readiness.missing.join(", ")}</span>
        )}
      </div>
      {setupBlocked && (
        <p className="mt-2 text-xs text-blue-200">Setup blocked — this button logs a draft/setup-blocked event only; it does not send to the customer.</p>
      )}
      <Button className="mt-4 w-full" variant={setupBlocked ? "outline" : "default"} onClick={onClick} disabled={busy || !readiness.ready}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        {setupBlocked ? "Log setup-blocked" : title}
      </Button>
    </div>
  );
}
