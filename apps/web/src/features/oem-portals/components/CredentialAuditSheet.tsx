import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { oemVaultQueryKeys, vaultApi, type CredentialAuditEvent } from "../lib/vault-api";

interface CredentialAuditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalId: string;
  portalName: string;
}

const EVENT_TINT: Record<CredentialAuditEvent["event_type"], string> = {
  created:         "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  updated:         "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  rotated:         "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  revealed:        "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  totp_generated:  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  deleted:         "bg-destructive/10 text-destructive",
  reveal_denied:   "bg-destructive/10 text-destructive",
  rate_limited:    "bg-destructive/10 text-destructive",
};

export function CredentialAuditSheet({
  open,
  onOpenChange,
  portalId,
  portalName,
}: CredentialAuditSheetProps) {
  const query = useQuery({
    queryKey: oemVaultQueryKeys.audit(portalId),
    queryFn: () => vaultApi.audit(portalId),
    enabled: open,
    staleTime: 10_000,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" /> Credential audit
          </SheetTitle>
          <SheetDescription>{portalName} · most recent 50 events (append-only)</SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex-1 space-y-2">
          {query.isLoading && <p className="text-sm text-muted-foreground">Loading audit events…</p>}
          {query.isError && (
            <p className="text-sm text-destructive">Failed to load: {(query.error as Error).message}</p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No credential activity recorded yet.</p>
          )}
          {query.data?.map((evt) => (
            <div key={evt.id} className="rounded-lg border border-border/50 bg-background/70 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${EVENT_TINT[evt.event_type] ?? "bg-muted"}`}>
                  {evt.event_type.replace(/_/g, " ")}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(evt.occurred_at).toLocaleString()}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {evt.actor_role && <span>role: <span className="text-foreground">{evt.actor_role}</span></span>}
                {evt.actor_user_id && <span>user: <span className="font-mono text-foreground">{evt.actor_user_id.slice(0, 8)}</span></span>}
                {evt.changed_fields && evt.changed_fields.length > 0 && (
                  <span>fields: <span className="text-foreground">{evt.changed_fields.join(", ")}</span></span>
                )}
              </div>
              {evt.reason && <p className="mt-2 text-xs italic text-foreground">“{evt.reason}”</p>}
              {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                  {JSON.stringify(evt.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
