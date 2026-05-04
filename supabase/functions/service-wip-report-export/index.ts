import { captureEdgeException } from "../_shared/sentry.ts";
import { optionsResponse, safeCorsHeaders, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

type ExportFormat = "csv" | "json";

interface WipReportRow {
  service_job_id: string;
  wo_number: string | null;
  company_id: string | null;
  branch_id: string | null;
  current_stage: string | null;
  billed_status: string | null;
  ledger_unbilled_labor_cents: number;
  ledger_unbilled_parts_other_cents: number;
  wave4_labor_wip_cents: number;
  wave4_parts_wip_cents: number;
  analysis_wip_cents: number;
  wip_started_at: string | null;
  last_wip_activity_at: string | null;
  wip_age_days: number | null;
  wip_age_bucket: string | null;
}

const REPORT_KIND = "service_wip_aging";
const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 10000;
const CSV_HEADERS = [
  "service_job_id",
  "wo_number",
  "company_id",
  "branch_id",
  "current_stage",
  "billed_status",
  "ledger_unbilled_labor_cents",
  "ledger_unbilled_parts_other_cents",
  "wave4_labor_wip_cents",
  "wave4_parts_wip_cents",
  "analysis_wip_cents",
  "wip_started_at",
  "last_wip_activity_at",
  "wip_age_days",
  "wip_age_bucket",
];

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function parseFormat(value: unknown): ExportFormat {
  return value === "json" ? "json" : "csv";
}

function stringFilter(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberFilter(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readInput(req: Request): Promise<Record<string, unknown>> {
  const url = new URL(req.url);
  const fromQuery = Object.fromEntries(url.searchParams.entries());
  if (req.method === "GET") return fromQuery;
  if (req.method !== "POST") throw new Error("method_not_allowed");
  const body = await req.json().catch(() => ({}));
  return { ...fromQuery, ...(body && typeof body === "object" ? body : {}) };
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll("\"", "\"\"")}"` : raw;
}

function toCsv(rows: WipReportRow[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    const values = CSV_HEADERS.map((header) => csvEscape(row[header as keyof WipReportRow]));
    lines.push(values.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function buildSummary(rows: WipReportRow[]) {
  const buckets: Record<string, { row_count: number; analysis_wip_cents: number }> = {};
  let total = 0;
  for (const row of rows) {
    const bucket = row.wip_age_bucket ?? "unknown";
    buckets[bucket] ??= { row_count: 0, analysis_wip_cents: 0 };
    buckets[bucket].row_count += 1;
    buckets[bucket].analysis_wip_cents += Number(row.analysis_wip_cents ?? 0);
    total += Number(row.analysis_wip_cents ?? 0);
  }
  return { row_count: rows.length, analysis_wip_cents: total, buckets };
}

function filename(format: ExportFormat): string {
  const day = new Date().toISOString().slice(0, 10);
  return `service-wip-aging-${day}.${format}`;
}

async function createRequestRow(auth: { supabase: any; workspaceId: string; userId: string }, format: ExportFormat, filters: Record<string, unknown>) {
  const { data, error } = await auth.supabase
    .from("service_report_export_requests")
    .insert({
      workspace_id: auth.workspaceId,
      report_kind: REPORT_KIND,
      export_format: format,
      filters,
      status: "running",
      generated_by: auth.userId,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`report_request_insert_failed: ${error.message}`);
  return data.id as string;
}

async function finishRequestRow(auth: { supabase: any }, id: string, patch: Record<string, unknown>) {
  const { error } = await auth.supabase
    .from("service_report_export_requests")
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`report_request_update_failed: ${error.message}`);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  let auth: Awaited<ReturnType<typeof requireServiceUser>> | null = null;
  let requestId: string | null = null;

  try {
    auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const input = await readInput(req);
    const format = parseFormat(input.format);
    const limit = clampLimit(input.limit);
    const filters = {
      branch_id: stringFilter(input.branch_id),
      current_stage: stringFilter(input.current_stage),
      billed_status: stringFilter(input.billed_status),
      wip_age_bucket: stringFilter(input.wip_age_bucket),
      min_age_days: numberFilter(input.min_age_days),
      max_age_days: numberFilter(input.max_age_days),
      limit,
    };

    requestId = await createRequestRow(auth, format, filters);

    let query = auth.supabase
      .from("v_deal_genome_service_wip_aging")
      .select(CSV_HEADERS.join(","))
      .eq("workspace_id", auth.workspaceId)
      .order("wip_age_days", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
    if (filters.current_stage) query = query.eq("current_stage", filters.current_stage);
    if (filters.billed_status) query = query.eq("billed_status", filters.billed_status);
    if (filters.wip_age_bucket) query = query.eq("wip_age_bucket", filters.wip_age_bucket);
    if (filters.min_age_days != null) query = query.gte("wip_age_days", filters.min_age_days);
    if (filters.max_age_days != null) query = query.lte("wip_age_days", filters.max_age_days);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as WipReportRow[];
    const outName = filename(format);
    const contentType = format === "json" ? "application/json" : "text/csv";
    await finishRequestRow(auth, requestId, {
      status: "completed",
      row_count: rows.length,
      file_name: outName,
      content_type: contentType,
    });

    if (format === "json") {
      return safeJsonOk({
        report_request_id: requestId,
        report_kind: REPORT_KIND,
        filters,
        truncated: rows.length === limit,
        summary: buildSummary(rows),
        rows,
      }, origin);
    }

    return new Response(toCsv(rows), {
      status: 200,
      headers: {
        ...safeCorsHeaders(origin),
        "Access-Control-Expose-Headers": "Content-Disposition, X-QEP-Report-Request-Id, X-QEP-Report-Row-Count",
        "Content-Disposition": `attachment; filename="${outName}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-QEP-Report-Request-Id": requestId,
        "X-QEP-Report-Row-Count": String(rows.length),
      },
    });
  } catch (err) {
    if (auth?.ok && requestId) {
      await finishRequestRow(auth, requestId, {
        status: "error",
        error_message: err instanceof Error ? err.message : "Unknown export error",
      }).catch(() => undefined);
    }
    captureEdgeException(err, { fn: "service-wip-report-export", req });
    if (err instanceof Error && err.message === "method_not_allowed") {
      return safeJsonError("Use GET or POST", 405, origin);
    }
    return safeJsonError(err instanceof Error ? err.message : "Internal server error", 500, origin);
  }
});
