import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PartsSubNav } from "../components/PartsSubNav";

const STATUS_PILLS = [
  "All",
  "open",
  "submitted",
  "picking",
  "ordered",
  "shipped",
  "closed",
  "cancelled",
] as const;

export function PartsFulfillmentPage() {
  const [filter, setFilter] = useState("All");

  const q = useQuery({
    queryKey: ["parts-fulfillment-runs-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_fulfillment_runs")
        .select("id, status, workspace_id, created_at, updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const all = q.data ?? [];
    if (filter === "All") return all;
    return all.filter((r) => r.status === filter);
  }, [q.data, filter]);

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fulfillment runs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Canonical audit trail for parts fulfillment (portal + shop + internal orders).
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUS_PILLS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:bg-muted"
            }`}
          >
            {s === "All" ? "All" : s}
            {s !== "All" && q.data && (
              <span className="ml-1 tabular-nums opacity-70">
                ({q.data.filter((r) => r.status === s).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {q.isLoading && (
        <div className="flex justify-center py-16" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading fulfillment runs</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      )}
      {q.isError && (
        <Card className="p-4 text-sm text-destructive">
          {(q.error as Error)?.message ?? "Failed to load runs."}
        </Card>
      )}

      {!q.isLoading && !q.isError && (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-[120px]">Audit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length > 0 ? (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.updated_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <ButtonLink to={`/parts/fulfillment/${r.id}`}>Open</ButtonLink>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-xs text-muted-foreground text-center py-6">
                    No runs match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function ButtonLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="text-xs text-primary font-medium underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}
