import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert, AlertTriangle, AlertCircle, Info, Check, X, RefreshCw,
} from "lucide-react";
import { AskIronAdvisorButton } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import type { Database, Json } from "@/lib/database.types";
import { resolveDataQualityPlaybook, resolveEntityAction } from "../lib/action-links";

const db = supabase as SupabaseClient<Database>;

type DataIssueRow = Database["public"]["Tables"]["admin_data_issues"]["Row"];
type DataIssueUpdate = Database["public"]["Tables"]["admin_data_issues"]["Update"];

interface DataIssue {
  id: string;
  issue_class: string;
  severity: "info" | "warn" | "error";
  entity_table: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  status: "open" | "resolved" | "ignored";
  first_seen: string;
  last_checked: string;
}

function toDetail(value: Json): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toSeverity(value: string): DataIssue["severity"] {
  return value === "error" || value === "warn" || value === "info" ? value : "info";
}

function toStatus(value: string): DataIssue["status"] {
  return value === "resolved" || value === "ignored" ? value : "open";
}

function toDataIssue(row: DataIssueRow): DataIssue {
  return {
    id: row.id,
    issue_class: row.issue_class,
    severity: toSeverity(row.severity),
    entity_table: row.entity_table,
    entity_id: row.entity_id,
    detail: toDetail(row.detail),
    status: toStatus(row.status),
    first_seen: row.first_seen,
    last_checked: row.last_checked,
  };
}

const ISSUE_LABELS: Record<string, string> = {
  equipment_no_owner:         "Equipment without owner",
  equipment_no_make_model:    "Missing make/model",
  equipment_no_geocoords:     "No geocoordinates",
  equipment_stale_telematics: "Stale telematics (7d+)",
  equipment_duplicate_serial: "Duplicate serial",
  equipment_no_intervals:     "No service intervals",
  documents_unclassified:     "Unclassified documents",
  quotes_no_tax_jurisdiction: "Quotes missing tax",
  account_no_budget_cycle:    "Company without budget cycle",
  account_no_tax_treatment:   "Company without tax treatment",
  contact_stale_ownership:    "Contact stale ownership",
  quote_no_validity_window:   "Quote without validity window",
};

const SEVERITY: Record<string, { icon: React.ReactNode; color: string }> = {
  error: { icon: <AlertCircle className="h-3 w-3" />, color: "text-red-400 border-red-500/30" },
  warn:  { icon: <AlertTriangle className="h-3 w-3" />, color: "text-amber-400 border-amber-500/30" },
  info:  { icon: <Info className="h-3 w-3" />, color: "text-blue-400 border-blue-500/30" },
};

export function DataQualityPage() {
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "data-quality"],
    queryFn: async () => {
      const { data, error } = await db
        .from("admin_data_issues")
        .select("*")
        .eq("status", "open")
        .order("severity", { ascending: false })
        .limit(500);
      if (error) throw new Error("Failed to load issues");
      return (data ?? []).map(toDataIssue);
    },
    staleTime: 30_000,
  });

  const runAuditMutation = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("run_data_quality_audit");
      if (error) throw new Error(String((error as { message?: string }).message ?? "Audit failed"));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "data-quality"] }),
  });

  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; status: "resolved" | "ignored" }) => {
      const patch: DataIssueUpdate = {
        status: input.status,
        resolved_at: new Date().toISOString(),
      };
      const { error } = await db
        .from("admin_data_issues")
        .update(patch)
        .eq("id", input.id);
      if (error) throw new Error("Update failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "data-quality"] }),
  });

  const grouped = useMemo(() => {
    const out = new Map<string, DataIssue[]>();
    for (const issue of data) {
      if (!out.has(issue.issue_class)) out.set(issue.issue_class, []);
      out.get(issue.issue_class)!.push(issue);
    }
    return out;
  }, [data]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Data Quality</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Nightly audit punch list. Resolve to fix the underlying record, ignore to suppress.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AskIronAdvisorButton contextType="data_quality" variant="inline" />
          <Button
            size="sm"
            onClick={() => runAuditMutation.mutate()}
            disabled={runAuditMutation.isPending}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${runAuditMutation.isPending ? "animate-spin" : ""}`} />
            {runAuditMutation.isPending ? "Running…" : "Run audit now"}
          </Button>
        </div>
      </div>

      {(runAuditMutation.isError || updateMutation.isError) && (
        <p className="text-xs text-destructive">
          {((runAuditMutation.error ?? updateMutation.error) as Error)?.message ?? "Operation failed"}
        </p>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-16 animate-pulse" />)}
        </div>
      )}

      {!isLoading && data.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <Check className="mx-auto h-8 w-8 text-emerald-400 mb-2" aria-hidden />
          <p className="text-sm text-foreground">All clean.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No open data-quality issues. Click "Run audit now" to re-scan.
          </p>
        </Card>
      )}

      {!isLoading && grouped.size > 0 && (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([cls, issues]) => (
            <div key={cls}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-bold text-foreground">{ISSUE_LABELS[cls] ?? cls}</h2>
                <span className="text-[10px] text-muted-foreground">({issues.length})</span>
              </div>
              <div className="space-y-2">
                {issues.slice(0, 25).map((issue) => {
                  const sev = SEVERITY[issue.severity];
                  const entityAction = resolveEntityAction(issue);
                  const playbookAction = resolveDataQualityPlaybook(issue.issue_class, issue);
                  return (
                    <Card key={issue.id} className={`p-3 ${sev?.color ?? ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          {sev?.icon}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">
                              {(issue.detail as { name?: string }).name ?? issue.entity_table}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {issue.entity_table} · first seen {new Date(issue.first_seen).toLocaleDateString()}
                            </p>
                            {Object.keys(issue.detail).length > 0 && (
                              <pre className="mt-1 overflow-x-auto text-[9px] text-muted-foreground">
                                {JSON.stringify(issue.detail, null, 0)}
                              </pre>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {entityAction && (
                            <Button asChild size="sm" variant="ghost" className="h-7 text-[10px]">
                              <Link to={entityAction.href}>{entityAction.label}</Link>
                            </Button>
                          )}
                          {playbookAction && (
                            <Button asChild size="sm" variant="outline" className="h-7 text-[10px]">
                              <Link to={playbookAction.href}>{playbookAction.label}</Link>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10px]"
                            onClick={() => updateMutation.mutate({ id: issue.id, status: "ignored" })}
                          >
                            <X className="mr-0.5 h-3 w-3" /> Ignore
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px]"
                            onClick={() => updateMutation.mutate({ id: issue.id, status: "resolved" })}
                          >
                            <Check className="mr-0.5 h-3 w-3" /> Resolve
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
                {issues.length > 25 && (
                  <p className="text-[10px] text-muted-foreground">+{issues.length - 25} more — paginate after first review pass.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
