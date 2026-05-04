import { captureEdgeException } from "../_shared/sentry.ts";
import { optionsResponse, safeCorsHeaders, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";

type ExportFormat = "csv" | "json";
type SummaryBy = "detail" | "premium_code" | "labor_date" | "employee";

interface PayrollReportRow {
  payroll_entry_id: string;
  employee_id: string;
  technician_id: string | null;
  employee_name: string | null;
  branch_id: string | null;
  labor_date: string;
  billing_run_date: string | null;
  premium_code_id: string;
  premium_code: string;
  premium_description: string | null;
  multiplier: number;
  hours: number;
  source_module: string | null;
  source_record_id: string | null;
}

type PayrollOutputRow = PayrollReportRow | Record<string, unknown>;

const REPORT_KIND = "service_payroll_hours";
const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 10000;
const DETAIL_HEADERS = [
  "payroll_entry_id",
  "employee_id",
  "technician_id",
  "employee_name",
  "branch_id",
  "labor_date",
  "billing_run_date",
  "premium_code_id",
  "premium_code",
  "premium_description",
  "multiplier",
  "hours",
  "source_module",
  "source_record_id",
];

const SUMMARY_HEADERS: Record<Exclude<SummaryBy, "detail">, string[]> = {
  premium_code: ["premium_code", "premium_description", "entry_count", "employee_count", "first_labor_date", "last_labor_date", "hours"],
  labor_date: ["labor_date", "entry_count", "employee_count", "hours"],
  employee: ["employee_id", "employee_name", "entry_count", "first_labor_date", "last_labor_date", "hours"],
};

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function parseFormat(value: unknown): ExportFormat {
  return value === "json" ? "json" : "csv";
}

function parseSummaryBy(value: unknown): SummaryBy {
  return value === "premium_code" || value === "labor_date" || value === "employee" ? value : "detail";
}

function stringFilter(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function toCsv(headers: string[], rows: PayrollOutputRow[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = headers.map((header) => csvEscape((row as Record<string, unknown>)[header]));
    lines.push(values.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function dateMin(a: string | null, b: string): string {
  return a == null || b < a ? b : a;
}

function dateMax(a: string | null, b: string): string {
  return a == null || b > a ? b : a;
}

function summarizeRows(rows: PayrollReportRow[], summaryBy: SummaryBy): PayrollOutputRow[] {
  if (summaryBy === "detail") return rows;

  const grouped = new Map<string, Record<string, unknown> & { employee_ids?: Set<string> }>();
  for (const row of rows) {
    const key =
      summaryBy === "premium_code" ? row.premium_code
      : summaryBy === "labor_date" ? row.labor_date
      : row.employee_id;

    const current = grouped.get(key) ?? {
      ...(summaryBy === "premium_code" ? {
        premium_code: row.premium_code,
        premium_description: row.premium_description,
        first_labor_date: null,
        last_labor_date: null,
      } : {}),
      ...(summaryBy === "labor_date" ? { labor_date: row.labor_date } : {}),
      ...(summaryBy === "employee" ? {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        first_labor_date: null,
        last_labor_date: null,
      } : {}),
      entry_count: 0,
      employee_count: 0,
      hours: 0,
      employee_ids: new Set<string>(),
    };

    current.entry_count = Number(current.entry_count) + 1;
    current.hours = Number(current.hours) + Number(row.hours ?? 0);
    current.employee_ids?.add(row.employee_id);
    if (summaryBy !== "labor_date") {
      current.first_labor_date = dateMin(current.first_labor_date as string | null, row.labor_date);
      current.last_labor_date = dateMax(current.last_labor_date as string | null, row.labor_date);
    }
    current.employee_count = current.employee_ids?.size ?? 0;
    grouped.set(key, current);
  }

  return [...grouped.values()].map(({ employee_ids: _employeeIds, ...row }) => row);
}

function buildSummary(rows: PayrollReportRow[]) {
  const totalHours = rows.reduce((sum, row) => sum + Number(row.hours ?? 0), 0);
  return {
    row_count: rows.length,
    hours: totalHours,
    employee_count: new Set(rows.map((row) => row.employee_id)).size,
    premium_code_count: new Set(rows.map((row) => row.premium_code)).size,
  };
}

function filename(format: ExportFormat, summaryBy: SummaryBy): string {
  const day = new Date().toISOString().slice(0, 10);
  return `service-payroll-hours-${summaryBy}-${day}.${format}`;
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
    const summaryBy = parseSummaryBy(input.summary_by);
    const limit = clampLimit(input.limit);
    const filters = {
      summary_by: summaryBy,
      branch_id: stringFilter(input.branch_id),
      employee_id: stringFilter(input.employee_id),
      premium_code: stringFilter(input.premium_code),
      labor_date_from: stringFilter(input.labor_date_from),
      labor_date_to: stringFilter(input.labor_date_to),
      billing_run_date_from: stringFilter(input.billing_run_date_from),
      billing_run_date_to: stringFilter(input.billing_run_date_to),
      limit,
    };

    requestId = await createRequestRow(auth, format, filters);

    let query = auth.supabase
      .from("v_deal_genome_service_payroll_hours_analysis")
      .select(DETAIL_HEADERS.join(","))
      .eq("workspace_id", auth.workspaceId)
      .order("labor_date", { ascending: false })
      .limit(limit);

    if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
    if (filters.employee_id) query = query.eq("employee_id", filters.employee_id);
    if (filters.premium_code) query = query.eq("premium_code", filters.premium_code);
    if (filters.labor_date_from) query = query.gte("labor_date", filters.labor_date_from);
    if (filters.labor_date_to) query = query.lte("labor_date", filters.labor_date_to);
    if (filters.billing_run_date_from) query = query.gte("billing_run_date", filters.billing_run_date_from);
    if (filters.billing_run_date_to) query = query.lte("billing_run_date", filters.billing_run_date_to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const detailRows = (data ?? []) as unknown as PayrollReportRow[];
    const outputRows = summarizeRows(detailRows, summaryBy);
    const headers = summaryBy === "detail" ? DETAIL_HEADERS : SUMMARY_HEADERS[summaryBy];
    const outName = filename(format, summaryBy);
    const contentType = format === "json" ? "application/json" : "text/csv";

    await finishRequestRow(auth, requestId, {
      status: "completed",
      row_count: outputRows.length,
      file_name: outName,
      content_type: contentType,
    });

    if (format === "json") {
      return safeJsonOk({
        report_request_id: requestId,
        report_kind: REPORT_KIND,
        filters,
        truncated: detailRows.length === limit,
        source_row_count: detailRows.length,
        summary: buildSummary(detailRows),
        rows: outputRows,
      }, origin);
    }

    return new Response(toCsv(headers, outputRows), {
      status: 200,
      headers: {
        ...safeCorsHeaders(origin),
        "Access-Control-Expose-Headers": "Content-Disposition, X-QEP-Report-Request-Id, X-QEP-Report-Row-Count",
        "Content-Disposition": `attachment; filename="${outName}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-QEP-Report-Request-Id": requestId,
        "X-QEP-Report-Row-Count": String(outputRows.length),
      },
    });
  } catch (err) {
    if (auth?.ok && requestId) {
      await finishRequestRow(auth, requestId, {
        status: "error",
        error_message: err instanceof Error ? err.message : "Unknown export error",
      }).catch(() => undefined);
    }
    captureEdgeException(err, { fn: "service-payroll-report-export", req });
    if (err instanceof Error && err.message === "method_not_allowed") {
      return safeJsonError("Use GET or POST", 405, origin);
    }
    return safeJsonError(err instanceof Error ? err.message : "Internal server error", 500, origin);
  }
});
