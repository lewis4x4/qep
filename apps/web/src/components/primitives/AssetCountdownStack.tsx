import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { CountdownBar, type CountdownTone } from "./CountdownBar";
import { supabase } from "@/lib/supabase";

interface CountdownRow {
  label: string;
  current: number;
  target: number;
  unit: string;
  tone: CountdownTone;
  sort_order?: number;
}

interface AssetCountdownStackProps {
  equipmentId: string;
  className?: string;
}

/**
 * Composite stack of every "time-until" or "hours-until" countdown for a
 * single piece of equipment: service intervals, warranty expiration,
 * manufacturer price-increase deadlines, customer budget cycle,
 * replacement cost crossover, lease/finance maturity, rental contract end.
 *
 * Pulls from the get_asset_countdowns(p_equipment_id) RPC introduced in
 * migration 161.
 */
export function AssetCountdownStack({ equipmentId, className = "" }: AssetCountdownStackProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["asset", "countdowns", equipmentId],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: CountdownRow[] | null; error: unknown }>;
      }).rpc("get_asset_countdowns", { p_equipment_id: equipmentId });
      if (error) throw new Error(String((error as { message?: string }).message ?? "RPC failed"));
      return data ?? [];
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <Card className={`h-48 animate-pulse ${className}`} />;
  }

  if (isError) {
    return (
      <Card className={`p-3 ${className}`}>
        <p className="text-xs text-red-400">Failed to load countdowns.</p>
      </Card>
    );
  }

  const rows = (data ?? []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  if (rows.length === 0) {
    return (
      <Card className={`p-3 ${className}`}>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Countdowns</p>
        <p className="mt-1 text-xs text-muted-foreground">
          No active countdowns — service intervals, warranties, and price-change deadlines will appear here as they're configured.
        </p>
      </Card>
    );
  }

  return (
    <Card className={`p-3 ${className}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Countdowns
      </p>
      <div className="space-y-2.5">
        {rows.map((row, i) => (
          <CountdownBar key={`${row.label}-${i}`} {...row} />
        ))}
      </div>
    </Card>
  );
}
