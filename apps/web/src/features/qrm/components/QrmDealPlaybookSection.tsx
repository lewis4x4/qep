import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import {
  generatePlaybook,
  updatePlaybookStatus,
  type PlaybookRow,
} from "@/features/parts-companion/lib/post-sale-api";
import { DeckSurface } from "./command-deck";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type DealPlaybookRow = Pick<PlaybookRow, "id" | "status" | "total_revenue" | "equipment_id"> & {
  created_at: string;
};

/**
 * N2.1: the 30/60/90 post-sale parts plan (m280) surfaced where the deal
 * lives. Generate on demand for the deal's subject unit; review-and-send
 * drives the same status machine as the Parts Companion page.
 */
export function QrmDealPlaybookSection({ dealId }: { dealId: string }) {
  const qc = useQueryClient();
  const queryKey = ["qrm", "deal-playbook", dealId] as const;

  const subjectQuery = useQuery({
    queryKey: ["qrm", "deal-subject-equipment", dealId] as const,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("crm_deal_equipment")
        .select("equipment_id")
        .eq("deal_id", dealId)
        .eq("role", "subject")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.equipment_id as string | null) ?? null;
    },
  });
  const equipmentId = subjectQuery.data ?? null;

  const playbookQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<DealPlaybookRow | null> => {
      const { data, error } = await supabase
        .from("post_sale_parts_playbooks")
        .select("id, status, total_revenue, equipment_id, created_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as DealPlaybookRow | null) ?? null;
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!equipmentId) throw new Error("Link a subject machine to the deal first.");
      return generatePlaybook(dealId, equipmentId);
    },
    onSuccess: () => {
      toast({ title: "Parts plan generated", description: "30/60/90 playbook drafted for review." });
      qc.invalidateQueries({ queryKey });
    },
    onError: (error) =>
      toast({
        title: "Playbook generation failed",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      }),
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: PlaybookRow["status"] }) =>
      updatePlaybookStatus(input.id, input.status),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const playbook = playbookQuery.data;

  return (
    <DeckSurface>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-qep-orange" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Post-sale parts plan</h2>
            <p className="text-xs text-muted-foreground">
              30/60/90-day maintenance parts, grounded in live catalog SKUs.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {playbookQuery.isLoading ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading…
            </span>
          ) : playbookQuery.isError ? (
            <span role="alert" className="text-xs text-destructive">Failed to load parts plan.</span>
          ) : playbook ? (
            <>
              <Badge variant={playbook.status === "draft" ? "destructive" : "outline"}>{playbook.status}</Badge>
              <span className="font-mono text-xs tabular-nums">{usd.format(playbook.total_revenue ?? 0)}</span>
              {playbook.status === "draft" && (
                <Button size="sm" variant="outline" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: playbook.id, status: "reviewed" })}>
                  Mark reviewed
                </Button>
              )}
              {playbook.status === "reviewed" && (
                <Button size="sm" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: playbook.id, status: "sent" })}>
                  <Send className="mr-1 h-3 w-3" aria-hidden="true" /> Send to customer
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={generate.isPending || !equipmentId}
              title={equipmentId ? undefined : "Link a subject machine to the deal first"}
              onClick={() => generate.mutate()}>
              {generate.isPending
                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                : <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />}
              Generate plan
            </Button>
          )}
        </div>
      </div>
    </DeckSurface>
  );
}
