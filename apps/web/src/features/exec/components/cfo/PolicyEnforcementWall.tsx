/**
 * CFO Policy Enforcement Wall — surfaces same-day policy issues from the
 * exception_queue scoped to finance sources (deposit, payment, refund).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import { resolvePolicyWallActions } from "../../lib/policy-wall-actions";

interface ExceptionRow {
  id: string;
  source: string;
  severity: "info" | "warn" | "error" | "critical";
  title: string;
  detail: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const FINANCE_SOURCES = ["analytics_alert", "tax_failed", "stripe_mismatch", "ar_override_pending"];

export function PolicyEnforcementWall() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["cfo", "policy-wall"],
    queryFn: async (): Promise<ExceptionRow[]> => {
      const res = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (col: string, vals: string[]) => {
              eq: (c: string, v: string) => {
                order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: ExceptionRow[] | null; error: unknown }> };
              };
            };
          };
        };
      }).from("exception_queue")
        .select("id, source, severity, title, detail, payload, created_at")
        .in("source", FINANCE_SOURCES)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(20);
      if (res.error) return [];
      return res.data ?? [];
    },
    staleTime: 60_000,
  });

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
          <p className="text-[11px] uppercase tracking-wider font-semibold text-foreground">Policy enforcement wall</p>
        </div>
        <span className="text-[10px] text-muted-foreground">{rows.length} open</span>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading policy issues…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-emerald-400">All policies in compliance. No open finance exceptions.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {rows.map((row) => (
            <div key={row.id} className="rounded-md border border-border/60 bg-muted/10 p-2.5">
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="flex-1 text-xs font-semibold text-foreground">{row.title}</p>
                <StatusChipStack chips={[
                  { label: row.source.replace(/_/g, " "), tone: "neutral" },
                  { label: row.severity, tone: row.severity === "critical" ? "red" : row.severity === "error" ? "orange" : "yellow" },
                ]} />
              </div>
              {row.detail && <p className="text-[11px] text-muted-foreground line-clamp-2">{row.detail}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-7 text-[10px]">
                  <Link to={resolvePolicyWallActions(row.source).primary.href}>
                    {resolvePolicyWallActions(row.source).primary.label}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="h-7 text-[10px]">
                  <Link to={resolvePolicyWallActions(row.source).secondary.href}>
                    {resolvePolicyWallActions(row.source).secondary.label}
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
