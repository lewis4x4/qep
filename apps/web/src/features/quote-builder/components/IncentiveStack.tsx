import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, X, RefreshCw, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface IncentiveStackProps {
  quotePackageId: string;
  className?: string;
}

interface AppliedIncentive {
  id: string;
  incentive_id: string;
  applied_amount: number;
  auto_applied: boolean;
  removed_at: string | null;
  manufacturer_incentives: {
    program_name: string;
    manufacturer: string;
    discount_type: string;
    requires_approval: boolean;
    stackable: boolean;
  } | null;
}

const RESOLVER_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quote-incentive-resolver`;

/**
 * Manufacturer incentive stack on the quote builder. Shows every
 * auto-applied incentive with a toggle to remove (writes a removal
 * audit row, never hard-deletes). "Re-resolve" re-runs the matcher.
 */
export function IncentiveStack({ quotePackageId, className = "" }: IncentiveStackProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["quote", "incentives", quotePackageId],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { is: (c: string, v: null) => Promise<{ data: AppliedIncentive[] | null; error: unknown }> } } };
      }).from("quote_incentive_applications")
        .select("id, incentive_id, applied_amount, auto_applied, removed_at, manufacturer_incentives(program_name, manufacturer, discount_type, requires_approval, stackable)")
        .eq("quote_package_id", quotePackageId)
        .is("removed_at", null);
      if (error) return [] as AppliedIncentive[];
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(RESOLVER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ quote_package_id: quotePackageId }),
      });
      if (!res.ok) throw new Error("Resolver failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote", "incentives", quotePackageId] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (applicationId: string) => {
      const userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
      const { error } = await (supabase as unknown as {
        from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } };
      }).from("quote_incentive_applications")
        .update({ removed_at: new Date().toISOString(), removed_by: userId, removal_reason: "manually toggled off" })
        .eq("id", applicationId);
      if (error) throw new Error("Remove failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quote", "incentives", quotePackageId] }),
  });

  const items = data ?? [];
  const totalSavings = items.reduce((sum, i) => sum + Number(i.applied_amount ?? 0), 0);

  if (isLoading) {
    return <Card className={`h-20 animate-pulse ${className}`} />;
  }

  return (
    <Card className={`p-3 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
          <h3 className="text-sm font-bold text-foreground">Manufacturer incentives</h3>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px]"
          onClick={() => resolveMutation.mutate()}
          disabled={resolveMutation.isPending}
        >
          <RefreshCw className={`mr-1 h-3 w-3 ${resolveMutation.isPending ? "animate-spin" : ""}`} />
          {resolveMutation.isPending ? "Re-resolving…" : "Re-resolve"}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active incentives match the manufacturers on this quote. Click "Re-resolve" after editing line items.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {items.map((item) => {
              const inc = item.manufacturer_incentives;
              if (!inc) return null;
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold text-foreground truncate">{inc.program_name}</p>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                        {inc.manufacturer}
                      </span>
                      {inc.stackable && (
                        <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                          stackable
                        </span>
                      )}
                      {inc.requires_approval && (
                        <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                          <Lock className="h-2 w-2" /> approval
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {inc.discount_type === "pct"
                        ? `${item.applied_amount}% off`
                        : inc.discount_type === "apr_buydown"
                          ? `APR buydown ($${item.applied_amount.toLocaleString()} value)`
                          : `$${item.applied_amount.toLocaleString()} ${inc.discount_type === "cash_back" ? "cash back" : "off"}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-400 tabular-nums">
                      −${item.applied_amount.toLocaleString()}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(item.id)}
                      disabled={removeMutation.isPending}
                      className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-2.5 w-2.5" /> remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-xs font-semibold text-foreground">Total customer savings</span>
            <span className="text-sm font-bold text-emerald-400 tabular-nums">
              −${totalSavings.toLocaleString()}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
