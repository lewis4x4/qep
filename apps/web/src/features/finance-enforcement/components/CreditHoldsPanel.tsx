import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { AsyncSection, financeErrorMessage } from "./AsyncSection";
import {
  useHeldAccounts, useRunCreditHoldSweep,
} from "../hooks/use-finance-enforcement";
import type { CreditHoldRow } from "../lib/finance-enforcement-api";

interface CreditHoldsPanelProps {
  workspaceId: string;
  currentUserRole?: string;
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

/**
 * Net 30 terms + 60-day auto-hold (mig 657).
 *
 * Lists accounts currently on credit hold and lets a manager+ run the sweep
 * that auto-holds accounts past the 60-day threshold.
 */
export function CreditHoldsPanel({ workspaceId, currentUserRole }: CreditHoldsPanelProps) {
  const held = useHeldAccounts(workspaceId);
  const sweep = useRunCreditHoldSweep(workspaceId);

  const [lastCount, setLastCount] = useState<number | null>(null);

  const isManagerPlus =
    currentUserRole === "manager" || currentUserRole === "owner" || currentUserRole === "admin";

  const onSweep = () => {
    if (!isManagerPlus) return;
    sweep.mutate(undefined, { onSuccess: (count) => setLastCount(count) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Credit holds</CardTitle>
        <CardDescription>Accounts blocked from order progression.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <AsyncSection<CreditHoldRow>
          isLoading={held.isLoading}
          isError={held.isError}
          error={held.error}
          data={held.data}
          loadingLabel="Loading held accounts…"
          emptyLabel="No accounts on credit hold."
        >
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Held since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.credit_hold_reason ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDate(row.credit_hold_set_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AsyncSection>

        {isManagerPlus && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-3">
              <Button onClick={onSweep} disabled={sweep.isPending}>
                {sweep.isPending
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  : <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                Run 60-day hold sweep
              </Button>
              <div role="status" aria-live="polite" className="text-sm">
                {sweep.isError && (
                  <span className="text-destructive">{financeErrorMessage(sweep.error)}</span>
                )}
                {!sweep.isError && lastCount != null && (
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">Newly held:</span>
                    <Badge variant="secondary" className="tabular-nums">{lastCount}</Badge>
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Terms default to Net 30; accounts past 60 days overdue are auto-held by the sweep.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
