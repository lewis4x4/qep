import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { AlertOctagon, ShieldCheck, Loader2 } from "lucide-react";
import { crmSupabase } from "../lib/qrm-supabase";

interface ARCreditBlockBannerProps {
  block: {
    id: string;
    block_reason: string;
    current_max_aging_days: number | null;
    status: "active" | "overridden" | "cleared";
  };
  /** The current user's id — populates approver picker default. */
  currentUserId?: string;
  currentUserRole?: string;
  onOverridden?: () => void;
}

interface Manager { id: string; full_name: string | null; role: string }

/**
 * AR Credit Block banner with embedded manager-override dialog.
 *
 * Banner is shown on Account 360 + Deal detail when an active block
 * exists. The "Override" action opens a Sheet with reason input
 * (min 5 chars), approver picker (manager+ only), window slider,
 * and accounting-notification checkbox. Calls the role-gated
 * apply_ar_override RPC (mig 168 + 172).
 */
export function ARCreditBlockBanner({
  block, currentUserId, currentUserRole, onOverridden,
}: ARCreditBlockBannerProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState<string>(currentUserId ?? "");
  const [windowDays, setWindowDays] = useState(14);
  const [notifyAccounting, setNotifyAccounting] = useState(true);

  const isManagerPlus = currentUserRole === "manager" || currentUserRole === "owner" || currentUserRole === "admin";

  // Pull eligible approvers (managers, owners, admins) for the picker
  const { data: approvers = [] } = useQuery({
    queryKey: ["ar-override-approvers"],
    queryFn: async () => {
      const { data, error } = await crmSupabase
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["manager", "owner", "admin"]);
      if (error) return [] as Manager[];
      return data ?? [];
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 5) throw new Error("Reason must be at least 5 characters");
      if (!approverId) throw new Error("Approver required");
      const { error } = await crmSupabase.rpc("apply_ar_override", {
        p_block_id: block.id,
        p_reason: reason.trim(),
        p_approver_id: approverId,
        p_window_days: windowDays,
      });
      if (error) throw new Error(String((error as { message?: string }).message ?? "Override failed"));
    },
    onSuccess: () => {
      setOpen(false);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["account-360"] });
      onOverridden?.();
    },
  });

  if (block.status !== "active") return null;

  return (
    <>
      <Card className="border-red-500/30 bg-red-500/5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertOctagon className="h-4 w-4 text-red-400 shrink-0" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-red-400">AR credit block active</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {block.block_reason} · {block.current_max_aging_days ?? "—"}d max aging
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Order progression blocked. Quotes still allowed. Manager override required.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!isManagerPlus}
            onClick={() => setOpen(true)}
            title={!isManagerPlus ? "Manager+ role required" : "Open override dialog"}
          >
            <ShieldCheck className="mr-1 h-3 w-3" /> Override
          </Button>
        </div>
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Override AR credit block</SheetTitle>
            <SheetDescription>
              Phase 2C v2 contract: reason, named approver, time window, accounting notification.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-3">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Override reason (min 5 chars)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why are we overriding this block?"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Named approver
              </label>
              <select
                value={approverId}
                onChange={(e) => setApproverId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="">Select approver…</option>
                {approvers.map((a) => (
                  <option key={a.id} value={a.id}>{a.full_name ?? a.id} ({a.role})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Override window: <span className="text-foreground">{windowDays} days</span>
              </label>
              <input
                type="range"
                min={1}
                max={30}
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className="mt-1 w-full"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={notifyAccounting}
                onChange={(e) => setNotifyAccounting(e.target.checked)}
              />
              Notify accounting (audit row stamped automatically)
            </label>

            {overrideMutation.isError && (
              <Card className="border-red-500/30 p-2">
                <p className="text-xs text-red-400">{(overrideMutation.error as Error).message}</p>
              </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => overrideMutation.mutate()}
                disabled={overrideMutation.isPending || reason.trim().length < 5 || !approverId}
              >
                {overrideMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                Apply override
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
