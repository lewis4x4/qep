import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wrench } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

type PendingTradeRecon = {
  id: string;
  disposition: string | null;
  reconditioning_approval_status: string;
  crm_equipment_id: string | null;
  trade_valuation_id: string | null;
  created_at: string;
};

const QUERY_KEY = ["sales", "trade-recon-approvals"] as const;

/**
 * N1.1: manager surface for the m766 keep-and-recondition gate —
 * record_trade_recondition_manager_approval had zero callers before this.
 * 'pending' = first approval needed; 'stale' = actual recon costs moved
 * beyond the 10%/$2,500 material-change threshold and need re-approval.
 */
export function TradeReconApprovalsCard() {
  const qc = useQueryClient();
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const pendingQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<PendingTradeRecon[]> => {
      const { data, error } = await supabase
        .from("qb_trade_ins")
        .select("id, disposition, reconditioning_approval_status, crm_equipment_id, trade_valuation_id, created_at")
        .eq("disposition", "keep_recondition")
        .in("reconditioning_approval_status", ["pending", "stale"])
        .order("created_at", { ascending: true })
        .limit(25);
      if (error) throw new Error(error.message);
      return (data ?? []) as PendingTradeRecon[];
    },
  });

  const approve = useMutation({
    mutationFn: async (input: { tradeInId: string; reason: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const { error } = await supabase.rpc("record_trade_recondition_manager_approval", {
        p_qb_trade_in_id: input.tradeInId,
        p_approved_by: auth.user.id,
        p_reason: input.reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast({ title: "Reconditioning approved", description: "Approval recorded to the audit trail." });
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) =>
      toast({
        title: "Approval failed",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

  const rows = pendingQuery.data ?? [];
  if (!pendingQuery.isLoading && !pendingQuery.isError && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" aria-hidden="true" />
          Trade reconditioning approvals
        </CardTitle>
        <CardDescription>
          Keep-and-recondition trades whose economics need a manager sign-off — 'stale' means actual
          recon costs moved past the material-change threshold since the last approval.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingQuery.isLoading && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading trade approvals…
          </div>
        )}
        {pendingQuery.isError && (
          <p role="alert" className="text-sm text-destructive">
            {pendingQuery.error instanceof Error ? pendingQuery.error.message : "Failed to load trade approvals."}
          </p>
        )}
        {rows.map((row) => {
          const reason = reasonById[row.id] ?? "";
          return (
            <div key={row.id} className="flex flex-col gap-2 rounded-md border border-border/60 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>
                  <Badge variant={row.reconditioning_approval_status === "stale" ? "destructive" : "outline"}>
                    {row.reconditioning_approval_status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Keep &amp; recondition · submitted {new Date(row.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-56 text-xs"
                  placeholder="Approval reason (min 5 chars)"
                  value={reason}
                  onChange={(e) => setReasonById((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  disabled={approve.isPending || reason.trim().length < 5}
                  onClick={() => approve.mutate({ tradeInId: row.id, reason: reason.trim() })}
                >
                  {approve.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />}
                  Approve
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
