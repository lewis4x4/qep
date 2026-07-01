import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { Loader2, ShieldCheck } from "lucide-react";
import { useReverseEquipmentSale, useReversalAudit } from "../hooks/use-finance-enforcement";
import { AsyncSection, financeErrorMessage } from "./AsyncSection";
import type { ReversalAuditRow } from "../lib/finance-enforcement-api";

interface EquipmentReversalPanelProps {
  workspaceId: string;
  currentUserId?: string;
  currentUserRole?: string;
}

const MIN_REASON_LENGTH = 5;

/** Only Sales Manager / Iron Manager (manager / owner) may submit a reversal. */
function canApprove(role: string | undefined): boolean {
  return role === "manager" || role === "owner";
}

const AUDIT_ACTION_LABEL: Record<ReversalAuditRow["action"], string> = {
  approved: "Approved",
  rejected: "Rejected",
  executed: "Executed",
};

function auditBadgeVariant(
  action: ReversalAuditRow["action"],
): "success" | "destructive" | "secondary" {
  if (action === "rejected") return "destructive";
  if (action === "executed") return "success";
  return "secondary";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("en-US");
}

/**
 * Equipment-sale reversal request + audit log.
 *
 * Submission is gated to Sales Manager / Iron Manager; the RPC re-checks the
 * approver server-side. The audit table below reflects the enforcement outcome
 * (approved / rejected / executed) as soon as a reversal resolves.
 */
export function EquipmentReversalPanel({
  workspaceId,
  currentUserId,
  currentUserRole,
}: EquipmentReversalPanelProps) {
  const [stockNumber, setStockNumber] = useState("");
  const [reversalId, setReversalId] = useState("");
  const [reason, setReason] = useState("");

  const reverse = useReverseEquipmentSale(workspaceId);
  const audit = useReversalAudit(workspaceId);

  const isManager = canApprove(currentUserRole);
  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH;
  const formValid =
    stockNumber.trim().length > 0 && reversalId.trim().length > 0 && reasonValid;
  const canSubmit = isManager && formValid && !reverse.isPending;

  const result = reverse.data;

  function handleSubmit(): void {
    if (!canSubmit) return;
    reverse.mutate({
      stockNumber: stockNumber.trim(),
      reversalId: reversalId.trim(),
      reason: reason.trim(),
      approverId: currentUserId ?? "",
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Equipment-sale reversal</CardTitle>
          <CardDescription>
            Reverse a booked equipment sale. Requires Sales Manager or Iron Manager approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reversal-stock-number">Stock number</Label>
                <Input
                  id="reversal-stock-number"
                  value={stockNumber}
                  onChange={(e) => setStockNumber(e.target.value)}
                  placeholder="e.g. STK-10482"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reversal-id">Reversal id</Label>
                <Input
                  id="reversal-id"
                  value={reversalId}
                  onChange={(e) => setReversalId(e.target.value)}
                  placeholder="e.g. REV-2026-0007"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reversal-reason">Reason (min {MIN_REASON_LENGTH} chars)</Label>
              <Input
                id="reversal-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this sale being reversed?"
                aria-invalid={reason.length > 0 && !reasonValid}
                aria-describedby="reversal-reason-help"
              />
              <p id="reversal-reason-help" className="text-[11px] text-muted-foreground">
                {reason.length > 0 && !reasonValid
                  ? `Reason must be at least ${MIN_REASON_LENGTH} characters.`
                  : "Recorded in the reversal audit log."}
              </p>
            </div>

            {!isManager && (
              <p className="text-[11px] text-muted-foreground" role="note">
                Requires Sales Manager or Iron Manager
              </p>
            )}

            {reverse.isError && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {financeErrorMessage(reverse.error)}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!canSubmit}>
                {reverse.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />
                )}
                Submit reversal for approval
              </Button>

              {result && (
                <div className="flex items-center gap-2" role="status" aria-live="polite">
                  <Badge variant={result.approved ? "success" : "destructive"}>
                    {result.approved ? "Approved / executed" : "Rejected"}
                  </Badge>
                  {(result.reason || result.approver_role) && (
                    <span className="text-[11px] text-muted-foreground">
                      {result.reason ?? result.outcome}
                      {result.approver_role ? ` · ${result.approver_role}` : ""}
                    </span>
                  )}
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reversal audit log</CardTitle>
          <CardDescription>Recent approved / rejected / executed reversals.</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <AsyncSection
            isLoading={audit.isLoading}
            isError={audit.isError}
            error={audit.error}
            data={audit.data}
            loadingLabel="Loading reversal audit…"
            emptyLabel="No reversal audit entries."
          >
            {(rows) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Stock #</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge variant={auditBadgeVariant(row.action)}>
                          {AUDIT_ACTION_LABEL[row.action]}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{row.stock_number ?? "—"}</TableCell>
                      <TableCell className="max-w-[16rem] truncate" title={row.reason ?? undefined}>
                        {row.reason ?? "—"}
                      </TableCell>
                      <TableCell>{row.outcome ?? "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatWhen(row.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </AsyncSection>
        </CardContent>
      </Card>
    </div>
  );
}
