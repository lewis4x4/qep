import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GitMerge, Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface CompanyPair {
  company_a_id: string;
  company_a_name: string;
  company_b_id: string;
  company_b_name: string;
  similarity_score: number;
}

interface CompanyMergeDialogProps {
  pair: CompanyPair | null;
  onClose: () => void;
}

interface MergeResponse {
  ok: boolean;
  audit_id: string;
  dry_run: boolean;
  total_rows_affected: number;
  table_row_counts: Record<string, number>;
  kept_company_id: string;
  discarded_company_id: string;
}

export function CompanyMergeDialog({ pair, onClose }: CompanyMergeDialogProps) {
  const queryClient = useQueryClient();
  const [keepSide, setKeepSide] = useState<"a" | "b">("a");
  const [notes, setNotes] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [dryRunResult, setDryRunResult] = useState<MergeResponse | null>(null);
  const [lastMergeAuditId, setLastMergeAuditId] = useState<string | null>(null);

  const mergeMutation = useMutation({
    mutationFn: async (opts: { dryRun: boolean }) => {
      if (!pair) throw new Error("No pair selected");
      const keepId = keepSide === "a" ? pair.company_a_id : pair.company_b_id;
      const discardId = keepSide === "a" ? pair.company_b_id : pair.company_a_id;
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: MergeResponse | null; error: unknown }>;
      }).rpc("merge_companies", {
        p_keep_id: keepId,
        p_discard_id: discardId,
        p_dry_run: opts.dryRun,
        p_caller_notes: notes || null,
      });
      if (error) throw new Error(String((error as { message?: string }).message ?? "Merge failed"));
      return data!;
    },
    onSuccess: (data) => {
      if (data.dry_run) {
        setDryRunResult(data);
      } else {
        // Round-5 audit fix: clear the dry-run preview on real-merge success
        // so the success banner doesn't render alongside a stale preview card.
        setDryRunResult(null);
        setConfirmText("");
        setLastMergeAuditId(data.audit_id);
        queryClient.invalidateQueries({ queryKey: ["duplicate-companies"] });
        queryClient.invalidateQueries({ queryKey: ["account-360"] });
      }
    },
  });

  // Round-5 audit fix: reset transient state every time the dialog opens
  // with a new pair, so reopening after a cancel doesn't carry "MERGE"
  // confirmation, prior dry-run output, or stale notes forward.
  useEffect(() => {
    if (pair) {
      setNotes("");
      setConfirmText("");
      setDryRunResult(null);
      setLastMergeAuditId(null);
      setKeepSide("a");
    }
  }, [pair?.company_a_id, pair?.company_b_id]);

  const undoMutation = useMutation({
    mutationFn: async (auditId: string) => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }).rpc("qrm_undo_company_merge", { p_audit_id: auditId });
      if (error) throw new Error(String((error as { message?: string }).message ?? "Undo failed"));
      return data;
    },
    onSuccess: () => {
      setLastMergeAuditId(null);
      setDryRunResult(null);
      queryClient.invalidateQueries({ queryKey: ["duplicate-companies"] });
      queryClient.invalidateQueries({ queryKey: ["account-360"] });
      onClose();
    },
  });

  const resetAndClose = () => {
    setNotes("");
    setConfirmText("");
    setDryRunResult(null);
    setLastMergeAuditId(null);
    setKeepSide("a");
    onClose();
  };

  if (!pair) return null;

  const keepName = keepSide === "a" ? pair.company_a_name : pair.company_b_name;
  const discardName = keepSide === "a" ? pair.company_b_name : pair.company_a_name;

  return (
    <Dialog open={pair !== null} onOpenChange={(next) => !next && resetAndClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-qep-orange" />
            Merge companies
          </DialogTitle>
          <DialogDescription>
            Schema-driven cascade. Reassigns every FK row (deals, activities,
            equipment, invoices, etc.) from discard → keep. Fully auditable and
            reversible for 7 days.
          </DialogDescription>
        </DialogHeader>

        {/* Keep / discard toggle */}
        <div className="space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Which side survives?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKeepSide("a")}
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                keepSide === "a" ? "border-qep-orange bg-qep-orange/10" : "border-border hover:border-foreground/20"
              }`}
            >
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {keepSide === "a" ? "Keeping" : "Discarding"}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-foreground truncate">{pair.company_a_name}</p>
            </button>
            <button
              type="button"
              onClick={() => setKeepSide("b")}
              className={`rounded-md border p-3 text-left text-sm transition-colors ${
                keepSide === "b" ? "border-qep-orange bg-qep-orange/10" : "border-border hover:border-foreground/20"
              }`}
            >
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {keepSide === "b" ? "Keeping" : "Discarding"}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-foreground truncate">{pair.company_b_name}</p>
            </button>
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Notes (optional, stored in audit)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Why this merge? Ticket ref, context..."
              className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            />
          </div>

          {/* Dry run preview */}
          {dryRunResult && (
            <Card className="border-blue-500/30 bg-blue-500/5 p-3">
              <p className="text-[10px] uppercase tracking-wider text-blue-400">Dry run preview</p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {dryRunResult.total_rows_affected} rows would be reassigned
              </p>
              <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                {Object.entries(dryRunResult.table_row_counts).map(([tbl, n]) => (
                  <div key={tbl} className="flex justify-between">
                    <span className="font-mono">{tbl}</span>
                    <span className="tabular-nums">{n}</span>
                  </div>
                ))}
                {Object.keys(dryRunResult.table_row_counts).length === 0 && (
                  <span className="italic">No rows to reassign.</span>
                )}
              </div>
            </Card>
          )}

          {/* Post-merge success */}
          {lastMergeAuditId && !undoMutation.isSuccess && (
            <Card className="border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-sm font-semibold text-emerald-400">✓ Merge complete</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                "{discardName}" was soft-deleted and all references point to "{keepName}".
                Undo available for 7 days.
              </p>
            </Card>
          )}

          {/* Errors */}
          {mergeMutation.isError && (
            <Card className="border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{(mergeMutation.error as Error).message}</p>
              </div>
            </Card>
          )}
          {undoMutation.isError && (
            <Card className="border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs text-red-400">Undo failed: {(undoMutation.error as Error).message}</p>
            </Card>
          )}

          {/* Confirmation gate (only shown when ready to commit) */}
          {dryRunResult && !lastMergeAuditId && (
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Type <code className="rounded bg-muted px-1 text-[10px]">MERGE</code> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {lastMergeAuditId ? (
            <>
              <Button variant="outline" onClick={resetAndClose}>Close</Button>
              <Button
                variant="destructive"
                onClick={() => undoMutation.mutate(lastMergeAuditId)}
                disabled={undoMutation.isPending}
              >
                {undoMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                Undo
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={resetAndClose}>Cancel</Button>
              {!dryRunResult ? (
                <Button
                  onClick={() => mergeMutation.mutate({ dryRun: true })}
                  disabled={mergeMutation.isPending}
                >
                  {mergeMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  Preview merge (dry run)
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setConfirmText("");
                    mergeMutation.mutate({ dryRun: false });
                  }}
                  disabled={confirmText !== "MERGE" || mergeMutation.isPending}
                >
                  {mergeMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <GitMerge className="mr-1 h-3 w-3" />}
                  Confirm merge
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
