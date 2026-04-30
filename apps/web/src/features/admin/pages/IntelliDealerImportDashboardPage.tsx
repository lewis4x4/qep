import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, Database, Download, FileSpreadsheet, Fingerprint, Loader2, RefreshCcw, ShieldCheck, UploadCloud } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

type QueryError = { message?: string };

interface TableQuery<T> extends PromiseLike<{ data: T | null; error: QueryError | null; count?: number | null }> {
  eq(column: string, value: unknown): TableQuery<T>;
  order(column: string, options?: { ascending?: boolean }): TableQuery<T>;
  limit(count: number): TableQuery<T>;
  range(from: number, to: number): TableQuery<T>;
}

interface RpcQuery<T> extends PromiseLike<{ data: T | null; error: QueryError | null }> {}

interface UntypedSupabase {
  from<T = unknown>(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): TableQuery<T>;
  };
  rpc<T = unknown>(functionName: string, args?: Record<string, unknown>): RpcQuery<T>;
}

interface WritableTable {
  insert(rows: StageRow[]): PromiseLike<{ error: QueryError | null }>;
}

interface WritableSupabase {
  from(table: string): WritableTable;
}

const db = supabase as unknown as UntypedSupabase;
const writableDb = supabase as unknown as WritableSupabase;

interface ImportRunRow {
  id: string;
  status: string;
  source_file_name: string | null;
  source_file_hash: string | null;
  master_rows: number;
  contact_rows: number;
  contact_memo_rows: number;
  ar_agency_rows: number;
  profitability_rows: number;
  error_count: number;
  warning_count: number;
  metadata: { preview_only?: boolean; audit_source?: string; staging_source?: string } | null;
  created_at: string;
  completed_at: string | null;
}

interface DashboardRunRow extends ImportRunRow {
  master_stage_count: number;
  contacts_stage_count: number;
  contact_memos_stage_count: number;
  contact_memos_nonblank_count: number;
  ar_agency_stage_count: number;
  profitability_stage_count: number;
  mapped_master_count: number;
  mapped_contacts_count: number;
  mapped_ar_agency_count: number;
  mapped_profitability_count: number;
  canonical_ar_agencies_count: number;
  canonical_profitability_facts_count: number;
  raw_card_rows_count: number;
  redacted_card_rows_count: number;
  import_errors_count: number;
}

type DashboardRunCountsRow = Omit<DashboardRunRow, keyof ImportRunRow>;

interface ImportErrorRow {
  id: string;
  source_sheet: string | null;
  row_number: number | null;
  severity: string;
  reason_code: string;
  message: string;
  created_at: string;
}

interface CountSummary {
  masterStage: number;
  contactsStage: number;
  contactMemosStage: number;
  contactMemosNonblank: number;
  arAgencyStage: number;
  profitabilityStage: number;
  mappedMaster: number;
  mappedContacts: number;
  mappedArAgency: number;
  mappedProfitability: number;
  canonicalArAgencies: number;
  canonicalProfitabilityFacts: number;
  rawCardRows: number;
  redactedCardRows: number;
  importErrors: number;
}

interface DashboardData {
  runs: ImportRunRow[];
  latestRun: DashboardRunRow | null;
  counts: CountSummary | null;
  errors: ImportErrorRow[];
}

interface PreviewAuditSheet {
  name: string;
  expected_rows: number;
  actual_rows: number;
  ok: boolean;
}

interface PreviewAuditIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

interface PreviewAudit {
  ok: boolean;
  sheets: PreviewAuditSheet[];
  errors: PreviewAuditIssue[];
  warnings: PreviewAuditIssue[];
  counts: {
    master_rows: number;
    contact_rows: number;
    contact_memo_rows: number;
    ar_agency_rows: number;
    profitability_rows: number;
  };
}

interface PreviewResponse {
  run_id: string;
  status: string;
  source_file_hash: string;
  file_size_bytes: number;
  audit: PreviewAudit;
}

type WorkbookRow = Record<string, string>;
type StageTableKey = "master" | "contacts" | "memos" | "arAgencies" | "profitability";
type StageRow = Record<string, unknown>;

interface IntelliDealerWorkbookRows {
  master: WorkbookRow[];
  contactMemos: WorkbookRow[];
  arAgencies: WorkbookRow[];
  contacts: WorkbookRow[];
  profitability: WorkbookRow[];
}

interface IntelliDealerStageRows {
  master: StageRow[];
  contacts: StageRow[];
  memos: StageRow[];
  arAgencies: StageRow[];
  profitability: StageRow[];
}

interface StageResponse {
  run_id: string;
  status: string;
  workspace_id?: string;
  counts?: Record<StageTableKey, number>;
}

interface ImportActionResponse {
  run_id: string;
  status?: string;
  result?: Record<string, unknown>;
  discarded_counts?: Record<StageTableKey, number>;
}

interface ImportPreflightResponse {
  run_id: string;
  status: string;
  ok: boolean;
  preflight_token: string | null;
  preflight_expires_in_seconds: number;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  warnings: string[];
  expected_counts: Record<StageTableKey, number>;
  staged_counts: Record<StageTableKey, number>;
}

type ExportKey = "master" | "contacts" | "memos" | "arAgencies" | "profitability" | "errors";

type ExportRow = Record<string, unknown>;

interface ExportColumn {
  header: string;
  value: (row: ExportRow) => unknown;
}

interface ExportDefinition {
  key: ExportKey;
  label: string;
  description: string;
  table: string;
  select: string;
  filenameSuffix: string;
  columns: ExportColumn[];
}

const EXPORT_BATCH_SIZE = 1_000;
const STAGE_CHUNK_SIZE = 100;

const EMPTY_COUNTS: CountSummary = {
  masterStage: 0,
  contactsStage: 0,
  contactMemosStage: 0,
  contactMemosNonblank: 0,
  arAgencyStage: 0,
  profitabilityStage: 0,
  mappedMaster: 0,
  mappedContacts: 0,
  mappedArAgency: 0,
  mappedProfitability: 0,
  canonicalArAgencies: 0,
  canonicalProfitabilityFacts: 0,
  rawCardRows: 0,
  redactedCardRows: 0,
  importErrors: 0,
};

const EXPECTED_PREVIEW_SHEETS = {
  MAST: 5_136,
  "Cust Contact Memos": 1_179,
  "AR AGENCY": 19_466,
  CONTACTS: 4_657,
  PROFITABILITY: 9_894,
} as const;

const VALID_PROFITABILITY_AREAS = new Set(["L", "S", "P", "R", "E", "T"]);
const YES_NO_VALUES = new Set(["", "Y", "N"]);
const STAGE_TABLES_FOR_UPLOAD: Array<{ key: StageTableKey; label: string }> = [
  { key: "master", label: "customer master" },
  { key: "contacts", label: "contacts" },
  { key: "memos", label: "contact memos" },
  { key: "arAgencies", label: "A/R agencies" },
  { key: "profitability", label: "profitability" },
];
const STAGE_TABLE_NAMES: Record<StageTableKey, string> = {
  master: "qrm_intellidealer_customer_master_stage",
  contacts: "qrm_intellidealer_customer_contacts_stage",
  memos: "qrm_intellidealer_customer_contact_memos_stage",
  arAgencies: "qrm_intellidealer_customer_ar_agency_stage",
  profitability: "qrm_intellidealer_customer_profitability_stage",
};

const EXPORT_DEFINITIONS: ExportDefinition[] = [
  {
    key: "master",
    label: "Customer master",
    description: "Source keys, customer identity, address, status, sales ownership, canonical company mapping.",
    table: "qrm_intellidealer_customer_master_stage",
    select: "source_sheet, row_number, company_code, division_code, customer_number, customer_name, status_code, branch_code, city, state, postal_code, country, terms_code, territory_code, salesperson_code, canonical_company_id, validation_errors",
    filenameSuffix: "customer-master",
    columns: [
      column("source_sheet"),
      column("row_number"),
      column("company_code"),
      column("division_code"),
      column("customer_number"),
      column("customer_name"),
      column("status_code"),
      column("branch_code"),
      column("city"),
      column("state"),
      column("postal_code"),
      column("country"),
      column("terms_code"),
      column("territory_code"),
      column("salesperson_code"),
      column("canonical_company_id"),
      column("validation_errors"),
    ],
  },
  {
    key: "contacts",
    label: "Contacts",
    description: "Safe contact profile fields, source contact numbers, canonical contact/company mappings.",
    table: "qrm_intellidealer_customer_contacts_stage",
    select: "source_sheet, row_number, company_code, division_code, customer_number, contact_number, first_name, last_name, job_title, business_email, business_phone, business_cell, status_code, canonical_contact_id, canonical_company_id, validation_errors",
    filenameSuffix: "contacts",
    columns: [
      column("source_sheet"),
      column("row_number"),
      column("company_code"),
      column("division_code"),
      column("customer_number"),
      column("contact_number"),
      column("first_name"),
      column("last_name"),
      column("job_title"),
      column("business_email"),
      column("business_phone"),
      column("business_cell"),
      column("status_code"),
      column("canonical_contact_id"),
      column("canonical_company_id"),
      column("validation_errors"),
    ],
  },
  {
    key: "memos",
    label: "Contact memos",
    description: "Memo row numbers, contact keys, memo text, and canonical company/memo mappings.",
    table: "qrm_intellidealer_customer_contact_memos_stage",
    select: "source_sheet, row_number, company_code, division_code, customer_number, contact_number, sequence_number, memo, canonical_memo_id, canonical_company_id, validation_errors",
    filenameSuffix: "contact-memos",
    columns: [
      column("source_sheet"),
      column("row_number"),
      column("company_code"),
      column("division_code"),
      column("customer_number"),
      column("contact_number"),
      column("sequence_number"),
      column("memo"),
      column("canonical_memo_id"),
      column("canonical_company_id"),
      column("validation_errors"),
    ],
  },
  {
    key: "arAgencies",
    label: "A/R agencies",
    description: "Safe A/R assignment fields only. Raw card identifiers and raw source JSON are not selected.",
    table: "qrm_intellidealer_customer_ar_agency_stage",
    select: "source_sheet, row_number, company_code, division_code, customer_number, agency_code, expiration_date_raw, status_code, is_default_agency, credit_rating, default_promotion_code, credit_limit, transaction_limit, canonical_company_id, canonical_agency_id, validation_errors",
    filenameSuffix: "ar-agencies-safe",
    columns: [
      column("source_sheet"),
      column("row_number"),
      column("company_code"),
      column("division_code"),
      column("customer_number"),
      column("agency_code"),
      column("expiration_date_raw"),
      column("status_code"),
      column("is_default_agency"),
      column("credit_rating"),
      column("default_promotion_code"),
      column("credit_limit"),
      column("transaction_limit"),
      column("canonical_company_id"),
      column("canonical_agency_id"),
      column("validation_errors"),
    ],
  },
  {
    key: "profitability",
    label: "Profitability",
    description: "Area-level sales, cost, margin, territory, salesperson, and canonical company mapping.",
    table: "qrm_intellidealer_customer_profitability_stage",
    select: "source_sheet, row_number, company_code, division_code, customer_number, area_code, ytd_sales_last_month_end, ytd_costs_last_month_end, current_month_sales, current_month_costs, ytd_margin, ytd_margin_pct, current_month_margin, current_month_margin_pct, fiscal_last_year_sales, fiscal_last_year_costs, fiscal_last_year_margin, fiscal_last_year_margin_pct, territory_code, salesperson_code, county_code, business_class_code, canonical_company_id, validation_errors",
    filenameSuffix: "profitability",
    columns: [
      column("source_sheet"),
      column("row_number"),
      column("company_code"),
      column("division_code"),
      column("customer_number"),
      column("area_code"),
      column("ytd_sales_last_month_end"),
      column("ytd_costs_last_month_end"),
      column("current_month_sales"),
      column("current_month_costs"),
      column("ytd_margin"),
      column("ytd_margin_pct"),
      column("current_month_margin"),
      column("current_month_margin_pct"),
      column("fiscal_last_year_sales"),
      column("fiscal_last_year_costs"),
      column("fiscal_last_year_margin"),
      column("fiscal_last_year_margin_pct"),
      column("territory_code"),
      column("salesperson_code"),
      column("county_code"),
      column("business_class_code"),
      column("canonical_company_id"),
      column("validation_errors"),
    ],
  },
  {
    key: "errors",
    label: "Import errors",
    description: "Blocking and warning rows with source sheet, row number, reason code, and message.",
    table: "qrm_intellidealer_customer_import_errors",
    select: "source_sheet, row_number, company_code, division_code, customer_number, severity, reason_code, message, created_at",
    filenameSuffix: "import-errors",
    columns: [
      column("source_sheet"),
      column("row_number"),
      column("company_code"),
      column("division_code"),
      column("customer_number"),
      column("severity"),
      column("reason_code"),
      column("message"),
      column("created_at"),
    ],
  },
];

export function IntelliDealerImportDashboardPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewWorkbookRowsRef = useRef<IntelliDealerWorkbookRows | null>(null);
  const [exportState, setExportState] = useState<{
    key: ExportKey;
    status: "loading" | "success" | "error";
    message: string;
  } | null>(null);
  const [previewState, setPreviewState] = useState<{
    status: "idle" | "uploading" | "success" | "error";
    message: string;
    result?: PreviewResponse;
  }>({
    status: "idle",
    message: "Choose the IntelliDealer Customer Master workbook to audit it before staging.",
  });
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [stageState, setStageState] = useState<{
    status: "idle" | "staging" | "success" | "error";
    message: string;
    result?: StageResponse;
  }>({
    status: "idle",
    message: "Staging is available after a passing upload preview.",
  });
  const [runActionState, setRunActionState] = useState<{
    runId: string;
    action: "preflight" | "commit" | "discard";
    status: "loading" | "success" | "error";
    message: string;
  } | null>(null);
  const [commitPreflight, setCommitPreflight] = useState<ImportPreflightResponse | null>(null);
  const dashboardQuery = useQuery({
    queryKey: ["admin", "intellidealer-import-dashboard"],
    queryFn: fetchDashboardData,
    staleTime: 30_000,
  });

  const latest = dashboardQuery.data?.latestRun ?? null;
  const counts = dashboardQuery.data?.counts ?? null;
  const sourceTotal = latest
    ? latest.master_rows + latest.contact_rows + latest.contact_memo_rows + latest.ar_agency_rows + latest.profitability_rows
    : 0;
  const stagedTotal = counts
    ? counts.masterStage + counts.contactsStage + counts.contactMemosStage + counts.arAgencyStage + counts.profitabilityStage
    : 0;
  const mappedTotal = counts
    ? counts.mappedMaster + counts.mappedContacts + counts.mappedArAgency + counts.mappedProfitability + counts.contactMemosNonblank
    : 0;
  const stagePerfect = useMemo(() => {
    if (!latest || !counts) return false;
    return latest.master_rows === counts.masterStage
      && latest.contact_rows === counts.contactsStage
      && latest.contact_memo_rows === counts.contactMemosStage
      && latest.ar_agency_rows === counts.arAgencyStage
      && latest.profitability_rows === counts.profitabilityStage;
  }, [counts, latest]);
  const canStagePreview = previewState.result?.audit.ok === true && previewFile !== null && stageState.status !== "staging";
  const operationalChecks = useMemo(() => {
    if (!latest || !counts) return [];
    return [
      {
        label: "Run committed",
        ok: latest.status === "committed",
        detail: latest.status === "committed" ? "Canonical tables are populated" : `Current status is ${latest.status}`,
      },
      {
        label: "Stage counts match source",
        ok: stagePerfect,
        detail: stagePerfect ? "All source row totals landed in staging" : "One or more source totals differ from staging",
      },
      {
        label: "No import errors",
        ok: counts.importErrors === 0,
        detail: `${counts.importErrors.toLocaleString()} blocking import error${counts.importErrors === 1 ? "" : "s"}`,
      },
      {
        label: "Card data redacted",
        ok: counts.rawCardRows === 0,
        detail: `${counts.rawCardRows.toLocaleString()} raw card row${counts.rawCardRows === 1 ? "" : "s"} remain`,
      },
      {
        label: "Memo text reconciled",
        ok: counts.contactMemosNonblank > 0,
        detail: `${counts.contactMemosNonblank.toLocaleString()} nonblank memo row${counts.contactMemosNonblank === 1 ? "" : "s"} represented`,
      },
    ];
  }, [counts, latest, stagePerfect]);

  async function handleExport(definition: ExportDefinition) {
    if (!latest) return;
    setExportState({ key: definition.key, status: "loading", message: `Preparing ${definition.label.toLowerCase()} CSV...` });
    try {
      const rows = await fetchRowsForExport(definition, latest.id);
      const csv = buildCsv(definition.columns, rows);
      downloadCsv(csv, buildExportFilename(latest, definition));
      setExportState({
        key: definition.key,
        status: "success",
        message: `Exported ${rows.length.toLocaleString()} ${definition.label.toLowerCase()} row${rows.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setExportState({
        key: definition.key,
        status: "error",
        message: error instanceof Error ? error.message : "Export failed.",
      });
    }
  }

  async function handlePreviewFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setPreviewFile(null);
      previewWorkbookRowsRef.current = null;
      setPreviewState({ status: "error", message: "Only .xlsx IntelliDealer customer workbooks are supported." });
      return;
    }

    setPreviewFile(null);
    previewWorkbookRowsRef.current = null;
    setStageState({ status: "idle", message: "Staging is available after a passing upload preview." });
    setPreviewState({ status: "uploading", message: `Auditing and uploading ${file.name}...` });
    try {
      const audited = await auditIntelliDealerWorkbook(file);
      const uploaded = await uploadIntelliDealerWorkbook(file);
      const result = await startIntelliDealerPreview({
        ...uploaded,
        audit: audited.audit,
        source_file_hash: audited.source_file_hash,
        file_size_bytes: file.size,
      });
      setPreviewState({
        status: "success",
        message: result.audit.ok
          ? "Preview audit passed. Rows are ready for protected staging; canonical commit remains locked."
          : "Preview audit completed with blocking errors. No rows were staged or committed.",
        result,
      });
      setPreviewFile(file);
      previewWorkbookRowsRef.current = audited.rows;
      await dashboardQuery.refetch();
    } catch (error) {
      setPreviewFile(null);
      previewWorkbookRowsRef.current = null;
      setPreviewState({
        status: "error",
        message: error instanceof Error ? error.message : "Preview upload failed.",
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleStagePreview() {
    const runId = previewState.result?.run_id;
    if (!runId || !previewFile || previewState.result?.audit.ok !== true) {
      setStageState({ status: "error", message: "A passing upload preview is required before staging." });
      return;
    }

    setStageState({ status: "staging", message: "Preparing audited workbook rows for staging..." });
    try {
      const workbookRows = previewWorkbookRowsRef.current ?? (await readIntelliDealerWorkbook(previewFile)).rows;
      const stageRows = mapIntelliDealerRowsToStageRows(workbookRows);
      const totalRows = countStageRows(stageRows);
      const started = await startIntelliDealerStage(runId);
      if (!started.workspace_id) throw new Error("Staging start did not return a workspace id.");

      let stagedRows = 0;
      for (const table of STAGE_TABLES_FOR_UPLOAD) {
        const rows = stageRows[table.key];
        for (let index = 0; index < rows.length; index += STAGE_CHUNK_SIZE) {
          const chunk = rows.slice(index, index + STAGE_CHUNK_SIZE);
          setStageState({
            status: "staging",
            message: `Staging ${table.label}: ${(index + chunk.length).toLocaleString()} of ${rows.length.toLocaleString()} rows. Total ${stagedRows.toLocaleString()} of ${totalRows.toLocaleString()}.`,
          });
          await stageIntelliDealerChunk(runId, started.workspace_id, table.key, chunk);
          stagedRows += chunk.length;
        }
      }

      const result = await completeIntelliDealerStage(runId);
      setStageState({
        status: "success",
        message: `Staging complete. ${totalRows.toLocaleString()} source rows are loaded into staging. Use the staged-run controls below to commit or discard this run.`,
        result,
      });
      await dashboardQuery.refetch();
    } catch (error) {
      setStageState({
        status: "error",
        message: error instanceof Error ? error.message : "Staging failed.",
      });
    }
  }

  async function handlePreflightRun(run: ImportRunRow) {
    if (run.status !== "staged") return;
    setRunActionState({ runId: run.id, action: "preflight", status: "loading", message: "Running commit preflight..." });
    setCommitPreflight(null);
    try {
      const result = await preflightIntelliDealerCommit(run.id);
      setCommitPreflight(result);
      setRunActionState({
        runId: run.id,
        action: "preflight",
        status: result.ok ? "success" : "error",
        message: result.ok
          ? `Preflight passed with ${result.warnings.length.toLocaleString()} warning${result.warnings.length === 1 ? "" : "s"}.`
          : "Preflight found blockers. Commit remains disabled.",
      });
    } catch (error) {
      setRunActionState({
        runId: run.id,
        action: "preflight",
        status: "error",
        message: error instanceof Error ? error.message : "Preflight failed.",
      });
    }
  }

  async function handleCommitRun(run: ImportRunRow) {
    if (run.status !== "staged") return;
    if (commitPreflight?.run_id !== run.id || commitPreflight.ok !== true || !commitPreflight.preflight_token) {
      setRunActionState({
        runId: run.id,
        action: "commit",
        status: "error",
        message: "Run commit preflight successfully before committing.",
      });
      return;
    }
    const typedRunId = window.prompt(
      `This will commit staged IntelliDealer rows into canonical QRM tables for run ${run.id}.\n\nType the full run id to continue.`,
    );
    if (typedRunId !== run.id) {
      setRunActionState({
        runId: run.id,
        action: "commit",
        status: "error",
        message: "Commit cancelled because the run id did not match.",
      });
      return;
    }

    setRunActionState({ runId: run.id, action: "commit", status: "loading", message: "Committing staged rows to canonical QRM tables..." });
    try {
      const result = await commitIntelliDealerRun(run.id, commitPreflight.preflight_token);
      setCommitPreflight(null);
      setRunActionState({
        runId: run.id,
        action: "commit",
        status: "success",
        message: `Committed run ${result.run_id}. Refreshing reconciliation...`,
      });
      await dashboardQuery.refetch();
    } catch (error) {
      setRunActionState({
        runId: run.id,
        action: "commit",
        status: "error",
        message: error instanceof Error ? error.message : "Commit failed.",
      });
    }
  }

  async function handleDiscardRun(run: ImportRunRow) {
    if (!isBrowserStagedRun(run)) return;
    const confirmed = window.confirm(
      `Discard staged IntelliDealer run ${run.id}?\n\nThis clears staging rows and marks the run cancelled. Canonical customer data is not changed.`,
    );
    if (!confirmed) return;

    setRunActionState({ runId: run.id, action: "discard", status: "loading", message: "Discarding staged rows..." });
    try {
      const result = await discardIntelliDealerStage(run.id);
      if (commitPreflight?.run_id === run.id) setCommitPreflight(null);
      setRunActionState({
        runId: run.id,
        action: "discard",
        status: "success",
        message: `Discarded staged run ${result.run_id}. Canonical data was not changed.`,
      });
      await dashboardQuery.refetch();
    } catch (error) {
      setRunActionState({
        runId: run.id,
        action: "discard",
        status: "error",
        message: error instanceof Error ? error.message : "Discard failed.",
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-400">Admin control room</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">IntelliDealer Customer Import</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Read-only production reconciliation for customer master, contacts, memos, A/R agencies, profitability, and redaction controls.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin">Back to admin</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md border border-amber-400/25 bg-amber-400/10 p-2 text-amber-300">
                <UploadCloud className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Upload preview</h2>
                <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                  Preview audits the workbook, then protected staging loads the exact audited rows. Canonical commit remains locked until final approval.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handlePreviewFile(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={previewState.status === "uploading"}
                onClick={() => fileInputRef.current?.click()}
              >
                {previewState.status === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Choose workbook
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canStagePreview}
                onClick={() => void handleStagePreview()}
              >
                {stageState.status === "staging" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Stage rows
              </Button>
              <Button type="button" variant="outline" disabled title="Commit appears on staged runs in Recent runs after protected staging completes.">
                Commit gated
              </Button>
            </div>
          </div>
          <div className={`mt-4 rounded-md border p-3 text-xs ${previewState.status === "error" ? "border-red-500/25 bg-red-500/5 text-red-300" : previewState.status === "success" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-300" : "border-border/70 bg-background/40 text-muted-foreground"}`}>
            {previewState.message}
          </div>
          {previewState.result ? (
            <div className={`mt-3 rounded-md border p-3 text-xs ${stageState.status === "error" ? "border-red-500/25 bg-red-500/5 text-red-300" : stageState.status === "success" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-300" : "border-border/70 bg-background/40 text-muted-foreground"}`}>
              {stageState.message}
            </div>
          ) : null}
          {previewState.result ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-md border border-border/70 bg-background/40 p-3">
                <p className="text-xs font-semibold text-foreground">Preview result</p>
                <div className="mt-3 grid gap-2">
                  <DetailRow label="Run id" value={previewState.result.run_id} mono />
                  <DetailRow label="Status" value={previewState.result.status} />
                  <DetailRow label="SHA-256 hash" value={formatHash(previewState.result.source_file_hash)} mono />
                  <DetailRow label="File size" value={`${previewState.result.file_size_bytes.toLocaleString()} bytes`} />
                  <DetailRow label="Errors" value={previewState.result.audit.errors.length.toLocaleString()} />
                  <DetailRow label="Warnings" value={previewState.result.audit.warnings.length.toLocaleString()} />
                </div>
              </div>
              <div className="rounded-md border border-border/70 bg-background/40 p-3">
                <p className="text-xs font-semibold text-foreground">Workbook audit counts</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {previewState.result.audit.sheets.map((sheet) => (
                    <div key={sheet.name} className="rounded border border-border/60 bg-background/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-foreground">{sheet.name}</p>
                        {sheet.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {sheet.actual_rows.toLocaleString()} of {sheet.expected_rows.toLocaleString()} expected rows
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Staging writes only to import staging tables. Canonical commit requires the staged-run gate in Recent runs and exact run-id confirmation.
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {dashboardQuery.isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
          Loading IntelliDealer import status...
        </Card>
      ) : dashboardQuery.isError ? (
        <Card className="border-red-500/30 bg-red-500/5 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-red-400" />
            <div>
              <p className="text-sm font-semibold text-red-400">Import dashboard unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">{dashboardQuery.error.message}</p>
            </div>
          </div>
        </Card>
      ) : !latest || !counts ? (
        <Card className="p-5 text-sm text-muted-foreground">No IntelliDealer customer import runs found.</Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <StatusCard
              label="Latest run"
              value={latest.status}
              detail={latest.source_file_name ?? "unknown source"}
              tone={latest.status === "committed" ? "green" : "amber"}
            />
            <StatusCard
              label="Stage count match"
              value={stagePerfect ? "Perfect" : "Mismatch"}
              detail={stagePerfect ? "Source and staging row counts align" : "Review staging row counts"}
              tone={stagePerfect ? "green" : "red"}
            />
            <StatusCard
              label="Import errors"
              value={counts.importErrors.toLocaleString()}
              detail={`${latest.warning_count.toLocaleString()} source warning${latest.warning_count === 1 ? "" : "s"}`}
              tone={counts.importErrors === 0 ? "green" : "red"}
            />
            <StatusCard
              label="A/R card redaction"
              value={counts.rawCardRows === 0 ? "Clean" : "Review"}
              detail={`${counts.rawCardRows.toLocaleString()} raw / ${counts.redactedCardRows.toLocaleString()} redacted`}
              tone={counts.rawCardRows === 0 ? "green" : "red"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-sky-400/25 bg-sky-400/10 p-2 text-sky-300">
                    <Fingerprint className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-foreground">Source fingerprint</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Exact file identity and run timing used for rerun comparison.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  <DetailRow label="Source file" value={latest.source_file_name ?? "Unknown source"} />
                  <DetailRow label="SHA-256 hash" value={formatHash(latest.source_file_hash)} mono />
                  <DetailRow label="Run id" value={latest.id} mono />
                  <DetailRow label="Started" value={formatDate(latest.created_at)} />
                  <DetailRow label="Completed" value={latest.completed_at ? formatDate(latest.completed_at) : "Not completed"} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-emerald-400/25 bg-emerald-400/10 p-2 text-emerald-300">
                    <RefreshCcw className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Operational readiness</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      These checks should remain green before another import or customer-data release.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {operationalChecks.map((check) => (
                    <OperationalCheck key={check.label} label={check.label} detail={check.detail} ok={check.ok} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Row-level export controls</h2>
                  <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                    Export safe staged rows and import errors for audit review. These browser exports intentionally exclude raw source JSON and A/R card numbers.
                  </p>
                </div>
                {exportState ? (
                  <Badge
                    variant="outline"
                    className={exportState.status === "error" ? "border-red-500/40 text-red-400" : exportState.status === "success" ? "border-emerald-500/40 text-emerald-400" : ""}
                  >
                    {exportState.status === "loading" ? "Exporting" : exportState.status}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {EXPORT_DEFINITIONS.map((definition) => {
                  const busy = exportState?.status === "loading";
                  const current = exportState?.key === definition.key;
                  return (
                    <div key={definition.key} className="rounded-md border border-border/70 bg-background/40 p-3">
                      <p className="text-xs font-semibold text-foreground">{definition.label}</p>
                      <p className="mt-1 min-h-8 text-[11px] text-muted-foreground">{definition.description}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 h-8 w-full text-[11px]"
                        disabled={busy}
                        onClick={() => void handleExport(definition)}
                      >
                        {busy && current ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        Export CSV
                      </Button>
                    </div>
                  );
                })}
              </div>
              {exportState ? (
                <p className={`mt-3 text-xs ${exportState.status === "error" ? "text-red-400" : "text-muted-foreground"}`}>
                  {exportState.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Source to canonical reconciliation</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Latest run `{latest.id}`</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{latest.status}</Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pr-4">Dataset</th>
                        <th className="py-2 pr-4 text-right">Source</th>
                        <th className="py-2 pr-4 text-right">Staged</th>
                        <th className="py-2 pr-4 text-right">Mapped</th>
                        <th className="py-2 pr-4 text-right">Delta</th>
                        <th className="py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <CountRow label="Customer master" source={latest.master_rows} staged={counts.masterStage} mapped={counts.mappedMaster} />
                      <CountRow label="Contacts" source={latest.contact_rows} staged={counts.contactsStage} mapped={counts.mappedContacts} />
                      <CountRow label="Contact memo rows" source={latest.contact_memo_rows} staged={counts.contactMemosStage} mapped={counts.contactMemosNonblank} mappedLabel="nonblank" />
                      <CountRow label="A/R agencies" source={latest.ar_agency_rows} staged={counts.arAgencyStage} mapped={counts.mappedArAgency} />
                      <CountRow label="Profitability" source={latest.profitability_rows} staged={counts.profitabilityStage} mapped={counts.mappedProfitability} />
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h2 className="text-sm font-semibold text-foreground">Canonical facts</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Metric label="Customer A/R agency rows" value={counts.canonicalArAgencies} icon={ShieldCheck} />
                  <Metric label="Profitability facts" value={counts.canonicalProfitabilityFacts} icon={Database} />
                  <Metric label="Nonblank staged memos" value={counts.contactMemosNonblank} icon={FileSpreadsheet} />
                  <Metric label="Raw card rows" value={counts.rawCardRows} icon={AlertCircle} danger={counts.rawCardRows > 0} />
                  <Metric label="Source rows loaded" value={sourceTotal} icon={Clock3} />
                  <Metric label="Staged rows loaded" value={stagedTotal} icon={Database} />
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Memo note: all staged memo rows are retained. The mapped memo figure is intentionally the nonblank source text count, not the total blank-inclusive row count. Total operationally mapped rows: {mappedTotal.toLocaleString()}.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardContent className="p-5">
                <h2 className="text-sm font-semibold text-foreground">Recent runs</h2>
                <div className="mt-3 space-y-2">
                  {(dashboardQuery.data?.runs ?? []).map((run) => (
                    <div key={run.id} className="rounded-md border border-border/70 bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-semibold text-foreground">{run.source_file_name ?? "Unknown source"}</p>
                        <Badge variant="outline" className="capitalize">
                          {isPreviewRun(run) ? `${run.status} preview` : run.status}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{run.id}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDate(run.created_at)} · errors {run.error_count.toLocaleString()} · warnings {run.warning_count.toLocaleString()}
                      </p>
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                        hash {formatHash(run.source_file_hash)}
                      </p>
                      {run.status === "staged" ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-[11px]"
                            disabled={runActionState?.status === "loading"}
                            onClick={() => void handlePreflightRun(run)}
                          >
                            {runActionState?.runId === run.id && runActionState.status === "loading" && runActionState.action === "preflight"
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Clock3 className="h-3.5 w-3.5" />}
                            Preflight commit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-[11px]"
                            disabled={runActionState?.status === "loading" || commitPreflight?.run_id !== run.id || commitPreflight.ok !== true || !commitPreflight.preflight_token}
                            onClick={() => void handleCommitRun(run)}
                          >
                            {runActionState?.runId === run.id && runActionState.status === "loading" && runActionState.action === "commit"
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <ShieldCheck className="h-3.5 w-3.5" />}
                            Commit staged
                          </Button>
                          {isBrowserStagedRun(run) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 border-amber-500/40 text-[11px] text-amber-300 hover:text-amber-200"
                              disabled={runActionState?.status === "loading"}
                              onClick={() => void handleDiscardRun(run)}
                            >
                              {runActionState?.runId === run.id && runActionState.status === "loading" && runActionState.action === "discard"
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCcw className="h-3.5 w-3.5" />}
                              Discard staged
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {runActionState?.runId === run.id ? (
                        <p className={`mt-2 text-[11px] ${runActionState.status === "error" ? "text-red-400" : runActionState.status === "success" ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {runActionState.message}
                        </p>
                      ) : null}
                      {commitPreflight?.run_id === run.id ? (
                        <div className="mt-3 rounded-md border border-border/70 bg-background/40 p-2">
                          <p className="text-[11px] font-semibold text-foreground">
                            Commit preflight: {commitPreflight.ok ? "passed" : "blocked"}
                          </p>
                          {commitPreflight.ok ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Token expires in {Math.round(commitPreflight.preflight_expires_in_seconds / 60).toLocaleString()} minutes.
                            </p>
                          ) : null}
                          <div className="mt-2 grid gap-1">
                            {commitPreflight.checks.map((check) => (
                              <div key={check.name} className="flex items-center justify-between gap-2 text-[10px]">
                                <span className={check.ok ? "text-muted-foreground" : "text-red-400"}>{check.name}</span>
                                <span className="font-mono text-muted-foreground">{check.detail}</span>
                              </div>
                            ))}
                          </div>
                          {commitPreflight.warnings.length > 0 ? (
                            <p className="mt-2 text-[10px] text-amber-300">{commitPreflight.warnings.join(" ")}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h2 className="text-sm font-semibold text-foreground">Recent import errors</h2>
                {dashboardQuery.data?.errors.length === 0 ? (
                  <div className="mt-4 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-400">
                    No import errors recorded for the latest run.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {(dashboardQuery.data?.errors ?? []).map((error) => (
                      <div key={error.id} className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                        <p className="text-xs font-semibold text-red-400">{error.reason_code}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {error.source_sheet ?? "unknown sheet"} row {error.row_number ?? "n/a"} · {error.severity}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

async function fetchDashboardData(): Promise<DashboardData> {
  const runsResult = await db
    .from<ImportRunRow[]>("qrm_intellidealer_customer_import_runs")
    .select("id, status, source_file_name, source_file_hash, master_rows, contact_rows, contact_memo_rows, ar_agency_rows, profitability_rows, error_count, warning_count, metadata, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(10);
  if (runsResult.error) throw new Error(runsResult.error.message ?? "Failed to load import runs");

  const runs = runsResult.data ?? [];
  const latestRunBase = runs.find((run) => run.status === "committed" && !isPreviewRun(run))
    ?? runs.find((run) => !isPreviewRun(run))
    ?? null;
  if (!latestRunBase) return { runs, latestRun: null, counts: null, errors: [] };

  const countsResult = await db.rpc<DashboardRunCountsRow[]>("qrm_intellidealer_customer_import_run_counts", {
    p_run_id: latestRunBase.id,
  });
  if (countsResult.error) throw new Error(countsResult.error.message ?? "Failed to load import reconciliation");
  const runCounts = countsResult.data?.[0] ?? null;
  if (!runCounts) return { runs, latestRun: null, counts: null, errors: [] };
  const latestRun: DashboardRunRow = {
    ...latestRunBase,
    ...runCounts,
  };

  const errorsResult = await db
    .from<ImportErrorRow[]>("qrm_intellidealer_customer_import_errors")
    .select("id, source_sheet, row_number, severity, reason_code, message, created_at")
    .eq("run_id", latestRun.id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (errorsResult.error) throw new Error(errorsResult.error.message ?? "Failed to load import errors");

  return {
    runs,
    latestRun,
    counts: {
      ...EMPTY_COUNTS,
      masterStage: latestRun.master_stage_count,
      contactsStage: latestRun.contacts_stage_count,
      contactMemosStage: latestRun.contact_memos_stage_count,
      contactMemosNonblank: latestRun.contact_memos_nonblank_count,
      arAgencyStage: latestRun.ar_agency_stage_count,
      profitabilityStage: latestRun.profitability_stage_count,
      mappedMaster: latestRun.mapped_master_count,
      mappedContacts: latestRun.mapped_contacts_count,
      mappedArAgency: latestRun.mapped_ar_agency_count,
      mappedProfitability: latestRun.mapped_profitability_count,
      canonicalArAgencies: latestRun.canonical_ar_agencies_count,
      canonicalProfitabilityFacts: latestRun.canonical_profitability_facts_count,
      rawCardRows: latestRun.raw_card_rows_count,
      redactedCardRows: latestRun.redacted_card_rows_count,
      importErrors: latestRun.import_errors_count,
    },
    errors: errorsResult.data ?? [],
  };
}

async function fetchRowsForExport(definition: ExportDefinition, runId: string): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  for (let from = 0; ; from += EXPORT_BATCH_SIZE) {
    const to = from + EXPORT_BATCH_SIZE - 1;
    const result = await db
      .from<ExportRow[]>(definition.table)
      .select(definition.select)
      .eq("run_id", runId)
      .order("row_number", { ascending: true })
      .range(from, to);

    if (result.error) {
      throw new Error(result.error.message ?? `Failed to export ${definition.label}`);
    }

    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length < EXPORT_BATCH_SIZE) break;
  }
  return rows;
}

function isPreviewRun(run: Pick<ImportRunRow, "metadata">): boolean {
  return run.metadata?.preview_only === true;
}

function isBrowserStagedRun(run: Pick<ImportRunRow, "status" | "metadata">): boolean {
  return run.status === "staged" && run.metadata?.audit_source === "browser_xlsx";
}

async function readIntelliDealerWorkbook(file: File): Promise<{
  rows: IntelliDealerWorkbookRows;
  source_file_hash: string;
  sheetMap: Map<string, string>;
}> {
  const buffer = await file.arrayBuffer();
  const [xlsxModule, source_file_hash] = await Promise.all([
    import("xlsx"),
    sha256Hex(buffer),
  ]);
  const XLSX = xlsxModule as typeof import("xlsx");
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const sheetMap = new Map(workbook.SheetNames.map((name) => [name.toLowerCase(), name]));
  const readSheet = (name: string): WorkbookRow[] => {
    const sheetName = sheetMap.get(name.toLowerCase());
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false }).map((row) => {
      const normalized: WorkbookRow = {};
      for (const [key, value] of Object.entries(row)) normalized[String(key).trim()] = String(value ?? "").trim();
      return normalized;
    });
  };

  return {
    source_file_hash,
    sheetMap,
    rows: {
      master: readSheet("MAST"),
      contactMemos: readSheet("Cust Contact Memos"),
      arAgencies: readSheet("AR AGENCY"),
      contacts: readSheet("CONTACTS"),
      profitability: readSheet("PROFITABILITY"),
    },
  };
}

async function auditIntelliDealerWorkbook(file: File): Promise<{ audit: PreviewAudit; source_file_hash: string; rows: IntelliDealerWorkbookRows }> {
  const { rows, source_file_hash, sheetMap } = await readIntelliDealerWorkbook(file);
  const errors: PreviewAuditIssue[] = [];
  const warnings: PreviewAuditIssue[] = [];
  const sheets = [
    previewSheetAudit("MAST", rows.master.length, sheetMap.has("mast")),
    previewSheetAudit("Cust Contact Memos", rows.contactMemos.length, sheetMap.has("cust contact memos")),
    previewSheetAudit("AR AGENCY", rows.arAgencies.length, sheetMap.has("ar agency")),
    previewSheetAudit("CONTACTS", rows.contacts.length, sheetMap.has("contacts")),
    previewSheetAudit("PROFITABILITY", rows.profitability.length, sheetMap.has("profitability")),
  ];

  for (const sheet of sheets) {
    if (sheet.actual_rows === 0 && !sheet.ok) {
      errors.push(previewIssue("error", "missing_or_empty_sheet", `${sheet.name} is missing, empty, or has an unexpected row count.`));
    } else if (!sheet.ok) {
      errors.push(previewIssue("error", "row_count_mismatch", `${sheet.name} expected ${sheet.expected_rows} rows but found ${sheet.actual_rows}.`));
    }
  }

  const masterKeys = countPreviewKeys(rows.master, ["Company", "Division", "Customer Number:"]);
  addPreviewDuplicateErrors(errors, masterKeys, "duplicate_master_key", "MAST duplicate Company/Division/Customer Number key");
  const contactKeys = countPreviewKeys(rows.contacts, ["Company", "Division", "Customer #", "Contact #"]);
  addPreviewDuplicateErrors(errors, contactKeys, "duplicate_contact_key", "CONTACTS duplicate Company/Division/Customer/Contact key");

  const masterKeySet = new Set(masterKeys.keys());
  checkPreviewForeignKeys(errors, rows.contacts, ["Company", "Division", "Customer #"], masterKeySet, "contacts_missing_master", "CONTACTS row does not match a MAST customer");
  checkPreviewForeignKeys(errors, rows.contactMemos, ["Company", "Division", "Customer #"], masterKeySet, "memo_missing_master", "Cust Contact Memos row does not match a MAST customer");
  checkPreviewForeignKeys(errors, rows.arAgencies, ["Co", "Div", "Cus#"], masterKeySet, "ar_agency_missing_master", "AR AGENCY row does not match a MAST customer");
  checkPreviewForeignKeys(errors, rows.profitability, ["Company", "Division", "Customer Number"], masterKeySet, "profitability_missing_master", "PROFITABILITY row does not match a MAST customer");
  checkPreviewForeignKeys(errors, rows.contactMemos, ["Company", "Division", "Customer #", "Contact #"], new Set(contactKeys.keys()), "memo_missing_contact", "Cust Contact Memos row does not match a CONTACTS row");

  addPreviewDuplicateErrors(errors, countPreviewKeys(rows.arAgencies, ["Co", "Div", "Cus#", "Agency Code", "Card#"]), "duplicate_ar_agency_key", "AR AGENCY duplicate Co/Div/Cus#/Agency/Card key");
  addPreviewDuplicateErrors(errors, countPreviewKeys(rows.profitability, ["Company", "Division", "Customer Number", "Area"]), "duplicate_profitability_key", "PROFITABILITY duplicate Company/Division/Customer/Area key");

  for (const area of distinctPreview(rows.profitability.map((row) => previewCell(row, "Area")).filter((area) => area && !VALID_PROFITABILITY_AREAS.has(area)))) {
    errors.push(previewIssue("error", "unknown_profitability_area", `PROFITABILITY contains unknown Area code ${area}.`));
  }
  for (const value of distinctPreview(rows.master.map((row) => previewCell(row, "MyDealer Allow Payments")).filter((value) => !YES_NO_VALUES.has(value)))) {
    warnings.push(previewIssue("warning", "unexpected_mydealer_allow_payments", `Unexpected MyDealer Allow Payments value ${value}.`));
  }
  for (const value of distinctPreview(rows.master.map((row) => previewCell(row, "PO Number/Required")).filter((value) => !YES_NO_VALUES.has(value)))) {
    warnings.push(previewIssue("warning", "unexpected_po_required", `Unexpected PO Number/Required value ${value}.`));
  }

  return {
    source_file_hash,
    rows,
    audit: {
      ok: errors.length === 0,
      sheets,
      errors,
      warnings,
      counts: {
        master_rows: rows.master.length,
        contact_rows: rows.contacts.length,
        contact_memo_rows: rows.contactMemos.length,
        ar_agency_rows: rows.arAgencies.length,
        profitability_rows: rows.profitability.length,
      },
    },
  };
}

function mapIntelliDealerRowsToStageRows(rows: IntelliDealerWorkbookRows): IntelliDealerStageRows {
  return {
    master: rows.master.map((row, index) => ({
      source_sheet: "MAST",
      row_number: index + 2,
      company_code: cleanCell(row, "Company"),
      division_code: cleanCell(row, "Division"),
      customer_number: cleanCell(row, "Customer Number:"),
      status_code: cleanCell(row, "Status"),
      branch_code: cleanCell(row, "Branch"),
      ar_type_code: cleanCell(row, "A/R Type"),
      category_code: cleanCell(row, "Category"),
      business_class_code: cleanCell(row, "Bus Cls"),
      customer_name: cleanCell(row, "Sold To Customer Name") ?? "Unknown customer",
      sold_to_address_1: cleanCell(row, "Sold To Address 1"),
      sold_to_address_2: cleanCell(row, "Sold To Address 2"),
      city: cleanCell(row, "City"),
      state: cleanCell(row, "Prv/St"),
      postal_code: cleanCell(row, "Sold To Postal/Zip Code"),
      country: cleanCell(row, "Country"),
      phone: cleanCell(row, "Phone #"),
      fax: cleanCell(row, "Fax Number"),
      cell: cleanCell(row, "Cell Phone Number"),
      terms_code: cleanCell(row, "Terms Code"),
      county_code: cleanCell(row, "County"),
      territory_code: cleanCell(row, "Territory"),
      salesperson_code: cleanCell(row, "Salesman"),
      search_1: cleanCell(row, "Search 1"),
      search_2: cleanCell(row, "Search 2"),
      pricing_level: parseIntegerCell(row, "Pricing Level"),
      pricing_group_code: cleanCell(row, "Pricing Group"),
      opt_out_pi: parseBooleanCell(row, "Opt Out PI"),
      do_not_call: parseBooleanCell(row, "Do Not Call"),
      date_added_raw: cleanCell(row, "Date Added"),
      date_last_modified_raw: cleanCell(row, "Date Last Modified"),
      date_last_billed_raw: cleanCell(row, "Date Last Billed"),
      last_payment_date_raw: cleanCell(row, "Last Payment Date"),
      raw_row: row,
    })),
    contacts: rows.contacts.map((row, index) => ({
      source_sheet: "CONTACTS",
      row_number: index + 2,
      company_code: cleanCell(row, "Company"),
      division_code: cleanCell(row, "Division"),
      customer_number: cleanCell(row, "Customer #"),
      contact_number: cleanCell(row, "Contact #"),
      job_title: cleanCell(row, "Job Title"),
      first_name: cleanCell(row, "First Name") ?? "Unknown",
      middle_initial: cleanCell(row, "Middle Initial"),
      last_name: cleanCell(row, "Last Name") ?? "Contact",
      comment: cleanCell(row, "Comment"),
      business_address_1: cleanCell(row, "Business Address 1"),
      business_address_2: cleanCell(row, "Business Address 2"),
      business_address_3: cleanCell(row, "Business Address 3"),
      business_postal_code: cleanCell(row, "Business Postal/ Zip Code"),
      business_phone: cleanCell(row, "Business Phone #"),
      business_phone_extension: cleanCell(row, "Business Phone Extension"),
      business_fax: cleanCell(row, "Business Fax #"),
      business_cell: cleanCell(row, "Business Cell Phone #"),
      business_email: cleanCell(row, "Business Email Address"),
      business_web_address: cleanCell(row, "Business Web Address"),
      home_phone: cleanCell(row, "Home Phone #"),
      home_cell: cleanCell(row, "Home Cell Phone #"),
      home_email: cleanCell(row, "Home Email Address"),
      user_id: cleanCell(row, "User ID"),
      birth_date_raw: cleanCell(row, "Birth Date"),
      status_code: cleanCell(row, "Status"),
      salesperson_code: cleanCell(row, "Salesperson"),
      mydealer_user: parseBooleanCell(row, "MyDealer User"),
      raw_row: row,
    })),
    memos: rows.contactMemos.map((row, index) => ({
      source_sheet: "Cust Contact Memos",
      row_number: index + 2,
      company_code: cleanCell(row, "Company"),
      division_code: cleanCell(row, "Division"),
      customer_number: cleanCell(row, "Customer #"),
      contact_number: cleanCell(row, "Contact #"),
      sequence_number: parseIntegerCell(row, "Sequence #") ?? 0,
      memo: cleanCell(row, "Memo"),
      raw_row: row,
    })),
    arAgencies: rows.arAgencies.map((row, index) => ({
      source_sheet: "AR AGENCY",
      row_number: index + 2,
      company_code: cleanCell(row, "Co"),
      division_code: cleanCell(row, "Div"),
      customer_number: cleanCell(row, "Cus#"),
      agency_code: cleanCell(row, "Agency Code"),
      card_number: cleanCell(row, "Card#"),
      expiration_date_raw: cleanCell(row, "Exp Date"),
      status_code: cleanCell(row, "Sta"),
      is_default_agency: parseBooleanCell(row, "Default Agency") === true,
      credit_rating: cleanCell(row, "Credit Rating"),
      default_promotion_code: cleanCell(row, "Default Promotion Code"),
      credit_limit: parseDecimalCell(row, "Credit Limit"),
      transaction_limit: parseDecimalCell(row, "Trans Limit"),
      raw_row: row,
    })),
    profitability: rows.profitability.map((row, index) => ({
      source_sheet: "PROFITABILITY",
      row_number: index + 2,
      company_code: cleanCell(row, "Company"),
      division_code: cleanCell(row, "Division"),
      customer_number: cleanCell(row, "Customer Number"),
      area_code: cleanCell(row, "Area"),
      ytd_sales_last_month_end: parseDecimalCell(row, "YTD Sales Last Month End"),
      ytd_costs_last_month_end: parseDecimalCell(row, "YTD Costs Last Month End"),
      current_month_sales: parseDecimalCell(row, "Current Month Sales"),
      current_month_costs: parseDecimalCell(row, "Current Month Costs"),
      ytd_margin: parseDecimalCell(row, "YTD Margin $"),
      ytd_margin_pct: parseDecimalCell(row, "YTD Margin %"),
      current_month_margin: parseDecimalCell(row, "Current Month Margin $"),
      current_month_margin_pct: parseDecimalCell(row, "Current Month Margin %"),
      last_11_sales_last_month_end: parseDecimalCell(row, "L11 Sales Last Month End"),
      last_11_costs_last_month_end: parseDecimalCell(row, "L11 Costs Last Month End"),
      last_12_margin: parseDecimalCell(row, "L12 Margin $"),
      last_12_margin_pct: parseDecimalCell(row, "L12 Margin %"),
      last_ytd_sales_last_month_end: parseDecimalCell(row, "LYTD Sales Last Month End"),
      last_ytd_costs_last_month_end: parseDecimalCell(row, "LYTD Costs Last Month End"),
      current_month_sales_last_year: parseDecimalCell(row, "Current Month Sales Last Year"),
      current_month_costs_last_year: parseDecimalCell(row, "Current Month Costs Last Year"),
      last_ytd_margin: parseDecimalCell(row, "LYTD Margin $"),
      last_ytd_margin_pct: parseDecimalCell(row, "LYTD Margin %"),
      fiscal_last_year_sales: parseDecimalCell(row, "Fiscal Last Year Sal es"),
      fiscal_last_year_costs: parseDecimalCell(row, "Fiscal Last Year Cos ts"),
      fiscal_last_year_margin: parseDecimalCell(row, "Fiscal Last Year Mar gin $"),
      fiscal_last_year_margin_pct: parseDecimalCell(row, "Fiscal Last Year Mar gin %"),
      territory_code: cleanCell(row, "Territory"),
      salesperson_code: cleanCell(row, "Salesperson"),
      county_code: cleanCell(row, "County"),
      business_class_code: cleanCell(row, "Business Class"),
      type_code: cleanCell(row, "Type"),
      owner_code: cleanCell(row, "Owner"),
      equipment_code: cleanCell(row, "Equipment"),
      dunn_bradstreet: cleanCell(row, "Dunn & Bradstreet"),
      location_code: cleanCell(row, "Location"),
      country: cleanCell(row, "Country"),
      raw_row: row,
    })),
  };
}

function countStageRows(rows: IntelliDealerStageRows): number {
  return rows.master.length + rows.contacts.length + rows.memos.length + rows.arAgencies.length + rows.profitability.length;
}

function cleanCell(row: WorkbookRow, columnName: string): string | null {
  const text = String(row[columnName] ?? "").trim();
  return text || null;
}

function parseBooleanCell(row: WorkbookRow, columnName: string): boolean | null {
  const text = cleanCell(row, columnName)?.toUpperCase();
  if (!text) return null;
  if (["Y", "YES", "TRUE", "1"].includes(text)) return true;
  if (["N", "NO", "FALSE", "0"].includes(text)) return false;
  return null;
}

function parseIntegerCell(row: WorkbookRow, columnName: string): number | null {
  const text = cleanCell(row, columnName)?.replace(/,/g, "");
  if (!text || !/^-?\d+(\.0+)?$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

function parseDecimalCell(row: WorkbookRow, columnName: string): string | null {
  const text = cleanCell(row, columnName)?.replace(/\$/g, "").replace(/,/g, "");
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  return text;
}

function previewSheetAudit(name: keyof typeof EXPECTED_PREVIEW_SHEETS, actualRows: number, exists: boolean): PreviewAuditSheet {
  const expectedRows = EXPECTED_PREVIEW_SHEETS[name];
  return { name, expected_rows: expectedRows, actual_rows: exists ? actualRows : 0, ok: exists && actualRows === expectedRows };
}

function countPreviewKeys(rows: Array<Record<string, string>>, columns: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = columns.map((columnName) => previewCell(row, columnName)).join("\u001f");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function addPreviewDuplicateErrors(errors: PreviewAuditIssue[], counts: Map<string, number>, code: string, message: string): void {
  for (const [key, count] of counts.entries()) {
    if (count > 1) errors.push(previewIssue("error", code, `${message}: ${formatPreviewKey(key)} appears ${count} times.`));
  }
}

function checkPreviewForeignKeys(
  errors: PreviewAuditIssue[],
  rows: Array<Record<string, string>>,
  columns: string[],
  parentKeys: Set<string>,
  code: string,
  message: string,
): void {
  const missing = new Map<string, number>();
  for (const row of rows) {
    const key = columns.map((columnName) => previewCell(row, columnName)).join("\u001f");
    if (!parentKeys.has(key)) missing.set(key, (missing.get(key) ?? 0) + 1);
  }
  for (const [key, count] of missing.entries()) {
    errors.push(previewIssue("error", code, `${message}: ${formatPreviewKey(key)} appears ${count} times.`));
  }
}

function distinctPreview(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function previewCell(row: Record<string, string>, columnName: string): string {
  return row[columnName] ?? "";
}

function previewIssue(severity: "error" | "warning", code: string, message: string): PreviewAuditIssue {
  return { severity, code, message };
}

function formatPreviewKey(key: string): string {
  return key.split("\u001f").map((part) => part || "(blank)").join(" / ");
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadIntelliDealerWorkbook(file: File): Promise<{ storage_path: string; source_file_name: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error("Not authenticated");

  const bucket = "intellidealer-customer-imports";
  const uuid = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${Date.now()}-${uuid}-${safeName}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (error) throw new Error(`upload failed: ${error.message}`);

  return {
    storage_path: `${bucket}/${path}`,
    source_file_name: file.name,
  };
}

async function startIntelliDealerPreview(input: {
  storage_path: string;
  source_file_name: string;
  source_file_hash: string;
  file_size_bytes: number;
  audit: PreviewAudit;
}): Promise<PreviewResponse> {
  return invokeIntelliDealerImport<PreviewResponse>({ action: "preview", ...input }, "IntelliDealer preview failed");
}

async function startIntelliDealerStage(runId: string): Promise<StageResponse> {
  return invokeIntelliDealerImport<StageResponse>({ action: "init_stage", run_id: runId }, "IntelliDealer staging start failed");
}

async function stageIntelliDealerChunk(runId: string, workspaceId: string, tableKey: StageTableKey, rows: StageRow[]): Promise<void> {
  const safeRows = rows.map((row) => ({
    ...row,
    run_id: runId,
    workspace_id: workspaceId,
  }));
  await withRetry(async () => {
    const result = await writableDb.from(STAGE_TABLE_NAMES[tableKey]).insert(safeRows);
    if (result.error) throw new Error(result.error.message ?? `Failed to stage ${tableKey}`);
  }, `stage ${tableKey}`);
}

async function completeIntelliDealerStage(runId: string): Promise<StageResponse> {
  return invokeIntelliDealerImport<StageResponse>({ action: "complete_stage", run_id: runId }, "IntelliDealer staging completion failed");
}

async function preflightIntelliDealerCommit(runId: string): Promise<ImportPreflightResponse> {
  return invokeIntelliDealerImport<ImportPreflightResponse>({ action: "preflight_commit", run_id: runId }, "IntelliDealer commit preflight failed");
}

async function commitIntelliDealerRun(runId: string, preflightToken: string): Promise<ImportActionResponse> {
  return invokeIntelliDealerImport<ImportActionResponse>({ action: "commit", run_id: runId, preflight_token: preflightToken }, "IntelliDealer commit failed");
}

async function discardIntelliDealerStage(runId: string): Promise<ImportActionResponse> {
  return invokeIntelliDealerImport<ImportActionResponse>({ action: "discard_stage", run_id: runId }, "IntelliDealer staged discard failed");
}

async function invokeIntelliDealerImport<T>(body: Record<string, unknown>, fallbackMessage: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const { data, error } = await supabase.functions.invoke("intellidealer-customer-import", {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    const message =
      error.context instanceof Response
        ? await error.context.text().catch(() => error.message)
        : error.message;
    throw new Error(message || fallbackMessage);
  }
  return data as T;
}

async function withRetry(operation: () => Promise<void>, label: string, attempts = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1_000 * attempt);
    }
  }
  throw new Error(`Failed to ${label}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => window.setTimeout(resolveSleep, ms));
}

function column(key: string, header = key): ExportColumn {
  return {
    header,
    value: (row) => row[key],
  };
}

function buildCsv(columns: ExportColumn[], rows: ExportRow[]): string {
  const header = columns.map((col) => csvValue(col.header)).join(",");
  const body = rows.map((row) => columns.map((col) => csvValue(col.value(row))).join(","));
  return [header, ...body].join("\n");
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildExportFilename(run: ImportRunRow, definition: ExportDefinition): string {
  const source = sanitizeFilename(run.source_file_name?.replace(/\.[^.]+$/, "") ?? "unknown-source");
  return `intellidealer-${definition.filenameSuffix}-${source}-${run.id.slice(0, 8)}.csv`;
}

function sanitizeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "export";
}

function CountRow({
  label,
  source,
  staged,
  mapped,
  mappedLabel = "mapped",
}: {
  label: string;
  source: number;
  staged: number;
  mapped: number;
  mappedLabel?: string;
}) {
  const sourceMatchesStage = source === staged;
  const mappedOk = mapped > 0 || source === 0;
  return (
    <tr className="border-b border-border/60">
      <td className="py-2 pr-4 text-foreground">{label}</td>
      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{source.toLocaleString()}</td>
      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{staged.toLocaleString()}</td>
      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
        {mapped.toLocaleString()} <span className="text-[10px]">{mappedLabel}</span>
      </td>
      <td className={`py-2 pr-4 text-right tabular-nums ${sourceMatchesStage ? "text-muted-foreground" : "text-red-400"}`}>
        {(staged - source).toLocaleString()}
      </td>
      <td className="py-2 text-right">
        {sourceMatchesStage && mappedOk ? (
          <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" />
        ) : (
          <AlertCircle className="ml-auto h-4 w-4 text-red-400" />
        )}
      </td>
    </tr>
  );
}

function StatusCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "green" | "amber" | "red" }) {
  const toneClass = tone === "green" ? "text-emerald-400" : tone === "amber" ? "text-amber-400" : "text-red-400";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-bold capitalize ${toneClass}`}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 rounded-md border border-border/60 bg-background/40 p-3 sm:grid-cols-[120px_1fr]">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`min-w-0 break-words text-xs text-foreground ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function OperationalCheck({ label, detail, ok }: { label: string; detail: string; ok: boolean }) {
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div className={`rounded-md border p-3 ${ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${ok ? "text-emerald-400" : "text-red-400"}`} />
        <p className="text-xs font-semibold text-foreground">{label}</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function Metric({ label, value, icon: Icon, danger = false }: { label: string; value: number; icon: typeof Database; danger?: boolean }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/40 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <p className="text-[10px] uppercase tracking-wider">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${danger ? "text-red-400" : "text-foreground"}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatHash(value: string | null): string {
  if (!value) return "Not captured";
  return value.length > 18 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}
