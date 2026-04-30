import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Database, FileSpreadsheet, Loader2, ShieldCheck } from "lucide-react";
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
}

interface UntypedSupabase {
  from<T = unknown>(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): TableQuery<T>;
  };
}

const db = supabase as unknown as UntypedSupabase;

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
  latestRun: ImportRunRow | null;
  counts: CountSummary | null;
  errors: ImportErrorRow[];
}

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

export function IntelliDealerImportDashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ["admin", "intellidealer-import-dashboard"],
    queryFn: fetchDashboardData,
    staleTime: 30_000,
  });

  const latest = dashboardQuery.data?.latestRun ?? null;
  const counts = dashboardQuery.data?.counts ?? null;
  const stagePerfect = useMemo(() => {
    if (!latest || !counts) return false;
    return latest.master_rows === counts.masterStage
      && latest.contact_rows === counts.contactsStage
      && latest.contact_memo_rows === counts.contactMemosStage
      && latest.ar_agency_rows === counts.arAgencyStage
      && latest.profitability_rows === counts.profitabilityStage;
  }, [counts, latest]);

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
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Memo note: all staged memo rows are retained. The mapped memo figure is intentionally the nonblank source text count, not the total blank-inclusive row count.
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
                        <Badge variant="outline" className="capitalize">{run.status}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{run.id}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDate(run.created_at)} · errors {run.error_count.toLocaleString()} · warnings {run.warning_count.toLocaleString()}
                      </p>
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
    .from<DashboardRunRow[]>("qrm_intellidealer_customer_import_dashboard")
    .select("id, status, source_file_name, source_file_hash, master_rows, contact_rows, contact_memo_rows, ar_agency_rows, profitability_rows, error_count, warning_count, created_at, completed_at, master_stage_count, contacts_stage_count, contact_memos_stage_count, contact_memos_nonblank_count, ar_agency_stage_count, profitability_stage_count, mapped_master_count, mapped_contacts_count, mapped_ar_agency_count, mapped_profitability_count, canonical_ar_agencies_count, canonical_profitability_facts_count, raw_card_rows_count, redacted_card_rows_count, import_errors_count")
    .order("created_at", { ascending: false })
    .limit(10);
  if (runsResult.error) throw new Error(runsResult.error.message ?? "Failed to load import runs");

  const runs = runsResult.data ?? [];
  const latestRun = runs[0] ?? null;
  if (!latestRun) return { runs, latestRun: null, counts: null, errors: [] };

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
