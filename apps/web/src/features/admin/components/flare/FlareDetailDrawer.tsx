import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ExternalLink, Check, AlertOctagon, XCircle, GitMerge, Loader2,
} from "lucide-react";
import { AskIronAdvisorButton, StatusChipStack } from "@/components/primitives";
import { supabase } from "@/lib/supabase";
import type { Database, Json } from "@/lib/database.types";
import { notifyFlareFixed } from "@/lib/flare/flareClient";

const db = supabase as SupabaseClient<Database>;

type FlareReportDbRow = Database["public"]["Tables"]["flare_reports"]["Row"];
type FlareReportUpdate = Database["public"]["Tables"]["flare_reports"]["Update"];

export interface FlareReportRow {
  id: string;
  workspace_id: string;
  reporter_email: string | null;
  reporter_role: string | null;
  severity: "blocker" | "bug" | "annoyance" | "idea" | "aha_moment";
  screenshot_path: string | null;
  dom_snapshot_path: string | null;
  status: "new" | "triaged" | "in_progress" | "fixed" | "wontfix" | "duplicate";
  user_description: string;
  url: string;
  route: string | null;
  page_title: string | null;
  visible_entities: Array<{ type: string; id: string }>;
  click_trail: Array<{ ts: number; selector: string; text: string | null; x: number; y: number }>;
  network_trail: Array<{ ts: number; url: string; method: string; status: number | null; duration_ms: number | null; error: string | null }>;
  console_errors: Array<{ ts: number; level: string; message: string; stack: string | null }>;
  route_trail: Array<{ ts: number; from: string; to: string }>;
  reproducer_steps: string | null;
  ai_severity_recommendation: string | null;
  ai_severity_reasoning: string | null;
  hypothesis_pattern: string | null;
  linear_issue_url: string | null;
  paperclip_issue_url: string | null;
  exception_queue_id: string | null;
  dispatch_errors: Record<string, string>;
  browser: string | null;
  os: string | null;
  viewport: { width: number; height: number; dpr: number } | null;
  created_at: string;
  fixed_at: string | null;
  fix_deploy_sha: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toSeverity(value: string): FlareReportRow["severity"] {
  if (value === "blocker" || value === "bug" || value === "annoyance" || value === "idea" || value === "aha_moment") {
    return value;
  }
  return "bug";
}

function toStatus(value: string): FlareReportRow["status"] {
  if (value === "triaged" || value === "in_progress" || value === "fixed" || value === "wontfix" || value === "duplicate") {
    return value;
  }
  return "new";
}

function toVisibleEntities(value: Json): FlareReportRow["visible_entities"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{ type: stringValue(item.type), id: stringValue(item.id) }];
  }).filter((item) => item.type && item.id);
}

function toClickTrail(value: Json): FlareReportRow["click_trail"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      ts: numberValue(item.ts),
      selector: stringValue(item.selector),
      text: typeof item.text === "string" ? item.text : null,
      x: numberValue(item.x),
      y: numberValue(item.y),
    }];
  });
}

function toNetworkTrail(value: Json): FlareReportRow["network_trail"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      ts: numberValue(item.ts),
      url: stringValue(item.url),
      method: stringValue(item.method, "GET"),
      status: nullableNumberValue(item.status),
      duration_ms: nullableNumberValue(item.duration_ms),
      error: typeof item.error === "string" ? item.error : null,
    }];
  });
}

function toConsoleErrors(value: Json): FlareReportRow["console_errors"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      ts: numberValue(item.ts),
      level: stringValue(item.level, "error"),
      message: stringValue(item.message),
      stack: typeof item.stack === "string" ? item.stack : null,
    }];
  }).filter((item) => item.message);
}

function toRouteTrail(value: Json): FlareReportRow["route_trail"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      ts: numberValue(item.ts),
      from: stringValue(item.from),
      to: stringValue(item.to),
    }];
  });
}

function toDispatchErrors(value: Json): FlareReportRow["dispatch_errors"] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, error]) => (typeof error === "string" ? [[key, error]] : [])),
  );
}

function toViewport(value: Json | null): FlareReportRow["viewport"] {
  if (!isRecord(value)) return null;
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  const dpr = numberValue(value.dpr, 1);
  return width > 0 && height > 0 ? { width, height, dpr } : null;
}

export function toFlareReportRow(row: FlareReportDbRow): FlareReportRow {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    reporter_email: row.reporter_email,
    reporter_role: row.reporter_role,
    severity: toSeverity(row.severity),
    screenshot_path: row.screenshot_path,
    dom_snapshot_path: row.dom_snapshot_path,
    status: toStatus(row.status),
    user_description: row.user_description,
    url: row.url,
    route: row.route,
    page_title: row.page_title,
    visible_entities: toVisibleEntities(row.visible_entities),
    click_trail: toClickTrail(row.click_trail),
    network_trail: toNetworkTrail(row.network_trail),
    console_errors: toConsoleErrors(row.console_errors),
    route_trail: toRouteTrail(row.route_trail),
    reproducer_steps: row.reproducer_steps,
    ai_severity_recommendation: row.ai_severity_recommendation,
    ai_severity_reasoning: row.ai_severity_reasoning,
    hypothesis_pattern: row.hypothesis_pattern,
    linear_issue_url: row.linear_issue_url,
    paperclip_issue_url: row.paperclip_issue_url,
    exception_queue_id: row.exception_queue_id,
    dispatch_errors: toDispatchErrors(row.dispatch_errors),
    browser: row.browser,
    os: row.os,
    viewport: toViewport(row.viewport),
    created_at: row.created_at,
    fixed_at: row.fixed_at,
    fix_deploy_sha: row.fix_deploy_sha,
  };
}

interface FlareDetailDrawerProps {
  report: FlareReportRow | null;
  onClose: () => void;
}

const SEVERITY_TONE: Record<FlareReportRow["severity"], "red" | "orange" | "yellow" | "blue" | "green"> = {
  blocker: "red",
  bug: "orange",
  annoyance: "yellow",
  idea: "blue",
  aha_moment: "green",
};

const STATUS_TONE: Record<FlareReportRow["status"], "blue" | "purple" | "orange" | "green" | "neutral" | "red"> = {
  new: "blue",
  triaged: "purple",
  in_progress: "orange",
  fixed: "green",
  wontfix: "neutral",
  duplicate: "neutral",
};

const EMPTY_ARTIFACT_URLS: { screenshotUrl: string | null; domUrl: string | null } = {
  screenshotUrl: null,
  domUrl: null,
};

export function FlareDetailDrawer({ report, onClose }: FlareDetailDrawerProps) {
  const queryClient = useQueryClient();
  const [deploySha, setDeploySha] = useState("");
  const [domHtml, setDomHtml] = useState<string | null>(null);

  // Fetch signed URLs for screenshot + DOM snapshot artifacts (1 hour expiry).
  const artifactsQuery = useQuery({
    enabled: !!report?.id && !!(report.screenshot_path || report.dom_snapshot_path),
    queryKey: ["flare-artifacts", report?.id],
    queryFn: async () => {
      if (!report) return EMPTY_ARTIFACT_URLS;
      const bucket = supabase.storage.from("flare-artifacts");
      const [shot, dom] = await Promise.all([
        report.screenshot_path ? bucket.createSignedUrl(report.screenshot_path, 3600) : Promise.resolve({ data: null }),
        report.dom_snapshot_path ? bucket.createSignedUrl(report.dom_snapshot_path, 3600) : Promise.resolve({ data: null }),
      ]);
      return { screenshotUrl: shot.data?.signedUrl ?? null, domUrl: dom.data?.signedUrl ?? null };
    },
  });

  // Lazy-decompress the DOM snapshot when the user expands the iframe section.
  useEffect(() => {
    setDomHtml(null);
  }, [report?.id]);
  async function loadDomSnapshot() {
    if (!artifactsQuery.data?.domUrl || domHtml) return;
    try {
      const res = await fetch(artifactsQuery.data.domUrl);
      const buf = new Uint8Array(await res.arrayBuffer());
      const pako = await import("pako");
      const html = pako.ungzip(buf, { to: "string" });
      setDomHtml(html);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[flare] failed to decompress DOM snapshot", err);
      setDomHtml("<!-- failed to load DOM snapshot -->");
    }
  }

  const updateMutation = useMutation({
    mutationFn: async (input: { status: FlareReportRow["status"]; fix_deploy_sha?: string }) => {
      if (!report) throw new Error("no report");
      const patch: FlareReportUpdate = {
        status: input.status,
        triaged_at: new Date().toISOString(),
      };
      if (input.status === "fixed") {
        patch.fixed_at = new Date().toISOString();
        if (input.fix_deploy_sha) patch.fix_deploy_sha = input.fix_deploy_sha;
      }
      const { error } = await db.from("flare_reports").update(patch).eq("id", report.id);
      if (error) throw new Error(error.message || "Update failed");
      // Fire close-the-loop notify on transitions to fixed
      if (input.status === "fixed") {
        await notifyFlareFixed(report.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flare-admin-queue"] });
      setDeploySha("");
    },
  });

  if (!report) return null;

  return (
    <Sheet open={!!report} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Flare detail
            <AskIronAdvisorButton contextType="flare" contextId={report.id} variant="inline" />
          </SheetTitle>
          <SheetDescription>
            Reported {new Date(report.created_at).toLocaleString()} by {report.reporter_email ?? "unknown"} ({report.reporter_role ?? "unknown"})
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Severity + status row */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusChipStack chips={[
              { label: report.severity, tone: SEVERITY_TONE[report.severity] },
              { label: report.status.replace(/_/g, " "), tone: STATUS_TONE[report.status] },
            ]} />
            {report.linear_issue_url && (
              <a href={report.linear_issue_url} target="_blank" rel="noopener noreferrer"
                 className="text-[10px] text-blue-400 hover:underline inline-flex items-center gap-1">
                Linear <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {report.paperclip_issue_url && (
              <a href={report.paperclip_issue_url} target="_blank" rel="noopener noreferrer"
                 className="text-[10px] text-violet-400 hover:underline inline-flex items-center gap-1">
                Paperclip <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>

          {/* Screenshot + DOM snapshot artifacts (spec §11) */}
          {(report.screenshot_path || report.dom_snapshot_path) && (
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Captured artifacts</p>
              {artifactsQuery.isPending && <p className="text-[10px] text-muted-foreground">Loading signed URLs…</p>}
              {artifactsQuery.data?.screenshotUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artifactsQuery.data.screenshotUrl}
                  alt="Flare screenshot"
                  className="w-full rounded-md border border-border"
                  style={{ maxHeight: "60vh", objectFit: "contain" }}
                />
              )}
              {artifactsQuery.data?.domUrl && (
                <div className="mt-2">
                  {!domHtml ? (
                    <Button size="sm" variant="outline" onClick={loadDomSnapshot}>
                      Load DOM snapshot (sandboxed)
                    </Button>
                  ) : (
                    <iframe
                      title="Flare DOM snapshot"
                      sandbox="allow-same-origin"
                      srcDoc={domHtml}
                      className="mt-1 h-[50vh] w-full rounded-md border border-border bg-white"
                    />
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Description */}
          <Card className="p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</p>
            <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{report.user_description}</p>
          </Card>

          {/* AI hints */}
          {(report.ai_severity_recommendation || report.hypothesis_pattern) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {report.ai_severity_recommendation && (
                <Card className="border-blue-500/30 bg-blue-500/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-blue-400">AI severity</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {report.ai_severity_recommendation}
                    {report.ai_severity_recommendation !== report.severity && " (override suggested)"}
                  </p>
                  {report.ai_severity_reasoning && (
                    <p className="mt-1 text-[11px] italic text-muted-foreground">"{report.ai_severity_reasoning}"</p>
                  )}
                </Card>
              )}
              {report.hypothesis_pattern && (
                <Card className="border-violet-500/30 bg-violet-500/5 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-violet-400">Hypothesis</p>
                  <p className="mt-1 text-xs text-foreground">{report.hypothesis_pattern}</p>
                </Card>
              )}
            </div>
          )}

          {/* Reproducer steps */}
          {report.reproducer_steps && (
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Steps to reproduce (auto-generated)</p>
              <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-foreground">{report.reproducer_steps}</pre>
            </Card>
          )}

          {/* Location + environment */}
          <Card className="p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Location + environment</p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div><span className="text-muted-foreground">Route:</span> <code className="text-foreground">{report.route ?? "—"}</code></div>
              <div><span className="text-muted-foreground">Page:</span> {report.page_title ?? "—"}</div>
              <div><span className="text-muted-foreground">Browser:</span> {report.browser} / {report.os}</div>
              <div><span className="text-muted-foreground">Viewport:</span> {report.viewport?.width}×{report.viewport?.height}@{report.viewport?.dpr}x</div>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">URL: {report.url}</p>
          </Card>

          {/* Console errors */}
          {report.console_errors.length > 0 && (
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Console errors ({report.console_errors.length})</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {report.console_errors.slice(-10).reverse().map((e, i) => (
                  <div key={i} className="rounded bg-muted/30 p-1.5 text-[10px] font-mono">
                    <span className={e.level === "error" ? "text-red-400" : "text-amber-400"}>[{e.level}]</span>{" "}
                    {e.message}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Click trail */}
          {report.click_trail.length > 0 && (
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Click trail ({report.click_trail.length})</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {report.click_trail.map((c, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground">
                    {i + 1}. {c.text ? `"${c.text}"` : `<${c.selector.slice(0, 50)}>`}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Network trail */}
          {report.network_trail.length > 0 && (
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Network trail ({report.network_trail.length})</p>
              <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-[10px]">
                {report.network_trail.map((n, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className={n.error ? "text-red-400" : (n.status && n.status >= 400) ? "text-amber-400" : "text-emerald-400"}>
                      {n.status ?? "ERR"}
                    </span>
                    <span className="text-muted-foreground">{n.method}</span>
                    <span className="text-foreground truncate">{n.url}</span>
                    {n.duration_ms != null && <span className="text-muted-foreground">{n.duration_ms}ms</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Dispatch errors */}
          {Object.keys(report.dispatch_errors ?? {}).length > 0 && (
            <Card className="border-amber-500/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Dispatch errors</p>
              <div className="space-y-0.5 text-[10px]">
                {Object.entries(report.dispatch_errors).map(([lane, err]) => (
                  <div key={lane}><code className="text-amber-400">{lane}</code>: {err}</div>
                ))}
              </div>
            </Card>
          )}

          {/* Status transition actions */}
          {report.status !== "fixed" && report.status !== "wontfix" && (
            <Card className="p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Triage actions</p>
              <div className="flex flex-wrap gap-2">
                {report.status === "new" && (
                  <Button size="sm" variant="outline"
                    onClick={() => updateMutation.mutate({ status: "triaged" })}
                    disabled={updateMutation.isPending}>
                    <Check className="mr-1 h-3 w-3" /> Mark triaged
                  </Button>
                )}
                {(report.status === "new" || report.status === "triaged") && (
                  <Button size="sm" variant="outline"
                    onClick={() => updateMutation.mutate({ status: "in_progress" })}
                    disabled={updateMutation.isPending}>
                    Start fixing
                  </Button>
                )}
                <Button size="sm" variant="ghost"
                  onClick={() => updateMutation.mutate({ status: "wontfix" })}
                  disabled={updateMutation.isPending}>
                  <XCircle className="mr-1 h-3 w-3" /> Won't fix
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => updateMutation.mutate({ status: "duplicate" })}
                  disabled={updateMutation.isPending}>
                  <GitMerge className="mr-1 h-3 w-3" /> Duplicate
                </Button>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  aria-label="Deploy SHA for fix"
                  value={deploySha}
                  onChange={(e) => setDeploySha(e.target.value)}
                  placeholder="Deploy SHA (optional)"
                  className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-mono"
                />
                <Button size="sm"
                  onClick={() => updateMutation.mutate({ status: "fixed", fix_deploy_sha: deploySha || undefined })}
                  disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                  Mark fixed
                </Button>
              </div>
              {updateMutation.isError && (
                <p className="mt-2 text-xs text-destructive">
                  {errorMessage(updateMutation.error, "Update failed")}
                </p>
              )}
            </Card>
          )}

          {report.status === "fixed" && report.fixed_at && (
            <Card className="border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-xs text-emerald-400">
                <Check className="inline h-3 w-3" /> Fixed {new Date(report.fixed_at).toLocaleString()}
                {report.fix_deploy_sha && <> · deploy <code>{report.fix_deploy_sha}</code></>}
              </p>
            </Card>
          )}

          {report.exception_queue_id && (
            <Card className="border-red-500/30 bg-red-500/5 p-3">
              <p className="text-[11px] text-red-400 flex items-center gap-1">
                <AlertOctagon className="h-3 w-3" />
                Auto-routed to Exception Inbox (ID: {report.exception_queue_id.slice(0, 8)}…)
              </p>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
