/**
 * Pending approval queue for the Flow Engine admin page.
 *
 * Lists all flow_approvals where status='pending' and exposes
 * approve/reject buttons that call decide_flow_approval(). On approval
 * the parent run is resumed via flow_resume_run() (mig 196).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2, Check, X, Clock } from "lucide-react";
import { StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";

interface ApprovalRow {
  id: string;
  workflow_slug: string;
  subject: string;
  detail: string | null;
  assigned_role: string | null;
  status: string;
  due_at: string | null;
  escalate_at: string | null;
  requested_at: string;
}

export function FlowApprovalsPanel() {
  const queryClient = useQueryClient();
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ["flow-approvals-pending"],
    queryFn: async (): Promise<ApprovalRow[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (col: string, vals: string[]) => {
              order: (c: string, o: { ascending: boolean }) => Promise<{ data: ApprovalRow[] | null; error: unknown }>;
            };
          };
        };
      }).from("flow_approvals")
        .select("id, workflow_slug, subject, detail, assigned_role, status, due_at, escalate_at, requested_at")
        .in("status", ["pending", "escalated"])
        .order("requested_at", { ascending: true });
      if (error) throw new Error("approvals load failed");
      return data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const decide = useMutation({
    mutationFn: async (input: { id: string; decision: "approved" | "rejected"; reason: string }) => {
      const { error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
      }).rpc("decide_flow_approval", {
        p_approval_id: input.id,
        p_decision: input.decision,
        p_reason: input.reason || null,
      });
      if (error) throw new Error(error.message ?? "decide failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flow-approvals-pending"] });
      queryClient.invalidateQueries({ queryKey: ["flow-admin-recent-runs"] });
    },
  });

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-purple-400" />
        <p className="text-[11px] uppercase tracking-wider font-semibold text-foreground">Pending approvals</p>
        <span className="ml-auto text-[10px] text-muted-foreground">{approvals.length}</span>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : approvals.length === 0 ? (
        <p className="text-xs text-emerald-400">No pending approvals.</p>
      ) : (
        <div className="space-y-2">
          {approvals.map((a) => {
            const overdue = a.due_at && new Date(a.due_at).getTime() < Date.now();
            return (
              <div key={a.id} className="rounded border border-border/60 bg-muted/10 p-2.5">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">{a.subject}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      <code>{a.workflow_slug}</code>
                      {a.assigned_role && <> · role: {a.assigned_role}</>}
                    </p>
                  </div>
                  <StatusChipStack chips={[
                    { label: a.status, tone: a.status === "escalated" ? "red" : "purple" },
                    ...(overdue ? [{ label: "overdue", tone: "red" as const }] : []),
                  ]} />
                </div>
                {a.detail && <p className="text-[11px] text-muted-foreground">{a.detail}</p>}
                {a.due_at && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-2.5 w-2.5" /> due {new Date(a.due_at).toLocaleString()}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={reasonById[a.id] ?? ""}
                    onChange={(e) => setReasonById((p) => ({ ...p, [a.id]: e.target.value }))}
                    placeholder="Decision reason (optional)"
                    className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
                  />
                  <Button
                    size="sm"
                    variant="default"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: a.id, decision: "approved", reason: reasonById[a.id] ?? "" })}
                  >
                    <Check className="mr-1 h-2.5 w-2.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: a.id, decision: "rejected", reason: reasonById[a.id] ?? "" })}
                  >
                    <X className="mr-1 h-2.5 w-2.5" /> Reject
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
