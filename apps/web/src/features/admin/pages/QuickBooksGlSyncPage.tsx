import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  FileCog,
  Link2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  buildDraftFromSummary,
  countMissingMappings,
  extractQuickBooksCompanyCard,
  quickBooksSetupHeadline,
  quickBooksSetupTone,
  type QuickBooksConfigDraft,
  type QuickBooksConfigSummary,
} from "../lib/quickbooks-config-utils";

type CustomerInvoiceTable = Database["public"]["Tables"]["customer_invoices"];
type CustomerInvoiceQuickBooksFields = {
  quickbooks_gl_status: string;
  quickbooks_gl_txn_id: string | null;
  quickbooks_gl_synced_at: string | null;
  quickbooks_gl_last_error: string | null;
};
type CustomerInvoiceWithQuickBooksRow = CustomerInvoiceTable["Row"] & CustomerInvoiceQuickBooksFields;
type CustomerInvoiceWithQuickBooksTable = Omit<CustomerInvoiceTable, "Row" | "Insert" | "Update"> & {
  Row: CustomerInvoiceWithQuickBooksRow;
  Insert: CustomerInvoiceTable["Insert"] & Partial<CustomerInvoiceQuickBooksFields>;
  Update: CustomerInvoiceTable["Update"] & Partial<CustomerInvoiceQuickBooksFields>;
};
type QuickBooksDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], "customer_invoices"> & {
      customer_invoices: CustomerInvoiceWithQuickBooksTable;
    };
  };
};

const db = supabase as SupabaseClient<QuickBooksDatabase>;

type PendingInvoiceRow = Pick<CustomerInvoiceWithQuickBooksRow, "id" | "invoice_number" | "total" | "quickbooks_gl_status">;
type JobInvoiceRow = Pick<CustomerInvoiceWithQuickBooksRow, "invoice_number" | "total" | "quickbooks_gl_status">;
type SyncJobRow = Pick<
  Database["public"]["Tables"]["quickbooks_gl_sync_jobs"]["Row"],
  "id" | "invoice_id" | "status" | "quickbooks_txn_id" | "error_message" | "last_attempt_at"
> & {
  customer_invoices?: JobInvoiceRow | JobInvoiceRow[] | null;
};

type ConfigSummaryResponse = {
  ok: boolean;
  summary: QuickBooksConfigSummary;
};

type TestConnectionResponse = {
  ok: boolean;
  company_info: Record<string, unknown>;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function cardToneClass(tone: "healthy" | "warning" | "critical"): string {
  if (tone === "healthy") return "border-emerald-400/30 bg-emerald-500/8";
  if (tone === "warning") return "border-amber-400/30 bg-amber-500/8";
  return "border-rose-400/30 bg-rose-500/8";
}

function timestampLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function quickBooksField(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toQuickBooksEnvironment(value: string): QuickBooksConfigDraft["environment"] {
  return value === "sandbox" ? "sandbox" : "production";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function buildSavePayload(draft: QuickBooksConfigDraft): QuickBooksConfigDraft {
  return {
    client_id: draft.client_id.trim(),
    client_secret: draft.client_secret.trim(),
    refresh_token: draft.refresh_token.trim(),
    realm_id: draft.realm_id.trim(),
    environment: draft.environment,
    ar_account_id: draft.ar_account_id.trim(),
    service_revenue_account_id: draft.service_revenue_account_id.trim(),
    parts_revenue_account_id: draft.parts_revenue_account_id.trim(),
    haul_revenue_account_id: draft.haul_revenue_account_id.trim(),
    shop_supplies_account_id: draft.shop_supplies_account_id.trim(),
    misc_revenue_account_id: draft.misc_revenue_account_id.trim(),
    tax_liability_account_id: draft.tax_liability_account_id.trim(),
  };
}

function maskedSecretHint(isStored: boolean, label: string): string {
  return isStored ? `${label} stored — leave blank to keep current value` : `Enter ${label}`;
}

export function QuickBooksGlSyncPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<QuickBooksConfigDraft>(buildDraftFromSummary(null));
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [latestTestCompany, setLatestTestCompany] = useState<Record<string, unknown> | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["quickbooks-gl-sync", "config-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<ConfigSummaryResponse>("quickbooks-gl-sync", {
        body: { action: "config_summary" },
      });
      if (error) throw error;
      if (!data?.summary) throw new Error("QuickBooks configuration summary missing.");
      return data.summary;
    },
    staleTime: 30_000,
  });

  const invoiceQuery = useQuery({
    queryKey: ["quickbooks-gl-sync", "invoices"],
    queryFn: async () => {
      const { data, error } = await db
        .from("customer_invoices")
        .select("id, invoice_number, total, quickbooks_gl_status")
        .in("quickbooks_gl_status", ["not_synced", "queued", "failed"])
        .order("created_at", { ascending: false })
        .returns<PendingInvoiceRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsQuery = useQuery({
    queryKey: ["quickbooks-gl-sync", "jobs"],
    queryFn: async () => {
      const { data, error } = await db
        .from("quickbooks_gl_sync_jobs")
        .select("id, invoice_id, status, quickbooks_txn_id, error_message, last_attempt_at, customer_invoices(invoice_number, total, quickbooks_gl_status)")
        .order("created_at", { ascending: false })
        .returns<SyncJobRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!summaryQuery.data || hasLocalEdits) return;
    setDraft(buildDraftFromSummary(summaryQuery.data));
  }, [summaryQuery.data, hasLocalEdits]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<ConfigSummaryResponse>("quickbooks-gl-sync", {
        body: { action: "save_config", config: buildSavePayload(draft) },
      });
      if (error) throw error;
      if (!data?.summary) throw new Error("QuickBooks config save returned no summary.");
      return data.summary;
    },
    onSuccess: (summary) => {
      setHasLocalEdits(false);
      setDraft(buildDraftFromSummary(summary));
      qc.setQueryData(["quickbooks-gl-sync", "config-summary"], summary);
    },
  });

  const clearConfig = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<ConfigSummaryResponse>("quickbooks-gl-sync", {
        body: { action: "clear_config" },
      });
      if (error) throw error;
      if (!data?.summary) throw new Error("QuickBooks clear returned no summary.");
      return data.summary;
    },
    onSuccess: (summary) => {
      setHasLocalEdits(false);
      setLatestTestCompany(null);
      setDraft(buildDraftFromSummary(summary));
      qc.setQueryData(["quickbooks-gl-sync", "config-summary"], summary);
    },
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<TestConnectionResponse>("quickbooks-gl-sync", {
        body: { action: "test_connection" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quickbooks-gl-sync", "config-summary"] });
    },
  });

  const syncInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase.functions.invoke("quickbooks-gl-sync", {
        body: { action: "sync_invoice", invoice_id: invoiceId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quickbooks-gl-sync", "jobs"] });
      qc.invalidateQueries({ queryKey: ["quickbooks-gl-sync", "invoices"] });
    },
  });

  const syncPending = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("quickbooks-gl-sync", {
        body: { action: "sync_pending", limit: 10 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quickbooks-gl-sync", "jobs"] });
      qc.invalidateQueries({ queryKey: ["quickbooks-gl-sync", "invoices"] });
    },
  });

  const summary = summaryQuery.data ?? null;
  const setupTone = quickBooksSetupTone(summary);
  const companyCard = extractQuickBooksCompanyCard(latestTestCompany);
  const pendingCount = (invoiceQuery.data ?? []).length;
  const missingMappings = countMissingMappings(summary);
  const connectionLabel =
    summary?.integration.last_test_success === true
      ? "Connection verified"
      : summary?.integration.last_test_error
      ? "Connection needs attention"
      : "Connection unverified";

  function setDraftField<K extends keyof QuickBooksConfigDraft>(key: K, value: QuickBooksConfigDraft[K]) {
    setHasLocalEdits(true);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Phase 8 · QuickBooks GL
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            QuickBooks GL command center
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Configure OAuth credentials, maintain account mappings, verify the QuickBooks company connection,
            and push invoice journal entries without leaving QEP. This is the operator surface that clears the
            row `4` setup blocker.
          </p>
        </div>
        <div className={`rounded-2xl border p-3 ${cardToneClass(setupTone)}`}>
          <FileCog className="h-5 w-5 text-primary" />
        </div>
      </div>

      <Card className={`border p-5 shadow-sm ${cardToneClass(setupTone)}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Setup posture
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{quickBooksSetupHeadline(summary)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary?.integration.display_name ?? "QuickBooks Online GL"} · {connectionLabel}
            </p>
          </div>
          <div className="rounded-full bg-background/80 px-3 py-1 text-xs font-semibold text-muted-foreground">
            {summary?.integration.status ?? "pending_credentials"}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MetricCard
            label="OAuth Core"
            value={`${summary?.config.credential_count ?? 0}/4`}
            detail={
              summary?.config.core_ready
                ? "Client, secret, refresh token, and realm are present."
                : "Complete client ID, client secret, refresh token, and realm ID."
            }
          />
          <MetricCard
            label="Account Map"
            value={`${summary?.config.account_mapping_count ?? 0}/7`}
            detail={
              missingMappings === 0
                ? "All revenue, tax, and receivable accounts are mapped."
                : `${missingMappings} account mapping${missingMappings === 1 ? "" : "s"} still missing.`
            }
          />
          <MetricCard
            label="Queue Backlog"
            value={String(pendingCount)}
            detail="Invoices currently waiting for QuickBooks posting or retry."
          />
        </div>

        {summary?.integration.last_test_error ? (
          <p className="mt-4 inline-flex items-center gap-1 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Last test error: {summary.integration.last_test_error}
          </p>
        ) : null}
        {summary?.integration.last_sync_error ? (
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Last sync error: {summary.integration.last_sync_error}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Configuration
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Credentials and account mapping</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Non-secret values are preloaded from the encrypted configuration. Secret fields can be rotated without
                re-entering unchanged values.
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              Updated
              <div className="mt-1 font-semibold text-foreground">{timestampLabel(summary?.integration.updated_at)}</div>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">OAuth credentials</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Client ID"
                  value={draft.client_id}
                  onChange={(value) => setDraftField("client_id", value)}
                  placeholder="Enter QuickBooks client ID"
                  helper={summary?.config.client_id ? "Stored value loaded" : "Required"}
                />
                <Field
                  label="Realm ID"
                  value={draft.realm_id}
                  onChange={(value) => setDraftField("realm_id", value)}
                  placeholder="Enter QuickBooks realm ID"
                  helper={summary?.config.realm_id ? "Stored value loaded" : "Required"}
                />
                <Field
                  label="Client Secret"
                  value={draft.client_secret}
                  onChange={(value) => setDraftField("client_secret", value)}
                  placeholder={maskedSecretHint(summary?.config.has_client_secret ?? false, "client secret")}
                  helper={summary?.config.has_client_secret ? "Stored securely" : "Required"}
                  type="password"
                />
                <Field
                  label="Refresh Token"
                  value={draft.refresh_token}
                  onChange={(value) => setDraftField("refresh_token", value)}
                  placeholder={maskedSecretHint(summary?.config.has_refresh_token ?? false, "refresh token")}
                  helper={summary?.config.has_refresh_token ? "Stored securely" : "Required"}
                  type="password"
                />
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">Environment</Label>
                  <select
                    value={draft.environment}
                    onChange={(event) => setDraftField("environment", toQuickBooksEnvironment(event.target.value))}
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  >
                    <option value="production">Production</option>
                    <option value="sandbox">Sandbox</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Posting account map</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="A/R account" value={draft.ar_account_id} onChange={(value) => setDraftField("ar_account_id", value)} placeholder="e.g. 100" />
                <Field label="Service revenue" value={draft.service_revenue_account_id} onChange={(value) => setDraftField("service_revenue_account_id", value)} placeholder="e.g. 200" />
                <Field label="Parts revenue" value={draft.parts_revenue_account_id} onChange={(value) => setDraftField("parts_revenue_account_id", value)} placeholder="e.g. 201" />
                <Field label="Haul revenue" value={draft.haul_revenue_account_id} onChange={(value) => setDraftField("haul_revenue_account_id", value)} placeholder="e.g. 202" />
                <Field label="Shop supplies" value={draft.shop_supplies_account_id} onChange={(value) => setDraftField("shop_supplies_account_id", value)} placeholder="e.g. 203" />
                <Field label="Misc revenue" value={draft.misc_revenue_account_id} onChange={(value) => setDraftField("misc_revenue_account_id", value)} placeholder="e.g. 299" />
                <Field label="Tax liability" value={draft.tax_liability_account_id} onChange={(value) => setDraftField("tax_liability_account_id", value)} placeholder="e.g. 300" />
              </div>
            </section>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending || summaryQuery.isLoading}>
              {saveConfig.isPending ? "Saving…" : "Save configuration"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                testConnection.mutate(undefined, {
                  onSuccess: (result) => setLatestTestCompany(result?.company_info ?? null),
                })
              }
              disabled={testConnection.isPending}
            >
              <BadgeCheck className="mr-1 h-4 w-4" />
              {testConnection.isPending ? "Testing…" : "Verify QuickBooks connection"}
            </Button>
            <Button variant="outline" onClick={() => clearConfig.mutate()} disabled={clearConfig.isPending}>
              <Trash2 className="mr-1 h-4 w-4" />
              {clearConfig.isPending ? "Clearing…" : "Clear stored config"}
            </Button>
          </div>

          {(saveConfig.error || clearConfig.error) ? (
            <p className="mt-3 text-sm text-destructive">
              {errorMessage(saveConfig.error ?? clearConfig.error, "QuickBooks configuration update failed")}
            </p>
          ) : null}
        </Card>

        <div className="space-y-6">
          <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Live probe
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">QuickBooks company handshake</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Runs the real OAuth refresh plus company info endpoint against the configured QuickBooks environment.
            </p>

            {companyCard.companyName ? (
              <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 p-4">
                <p className="text-sm font-semibold text-foreground">{companyCard.companyName}</p>
                {companyCard.legalName ? (
                  <p className="mt-1 text-xs text-muted-foreground">Legal name: {companyCard.legalName}</p>
                ) : null}
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>Country: {companyCard.country ?? "—"}</span>
                  <span>Website: {companyCard.webAddr ?? "—"}</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                No verified company info yet. Run a connection check after credentials are saved.
              </div>
            )}

            {testConnection.data ? (
              <pre className="mt-4 overflow-x-auto rounded-xl border border-border/60 bg-background p-3 text-xs text-muted-foreground">
                {JSON.stringify(testConnection.data, null, 2)}
              </pre>
            ) : null}
          </Card>

          <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Posting queue
                </p>
                <h2 className="mt-1 text-lg font-semibold text-foreground">Pending invoice postings</h2>
              </div>
              <Button variant="outline" onClick={() => syncPending.mutate()} disabled={syncPending.isPending}>
                <RefreshCw className="mr-1 h-4 w-4" />
                {syncPending.isPending ? "Syncing…" : "Sync pending"}
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <select
                value={selectedInvoiceId}
                onChange={(event) => setSelectedInvoiceId(event.target.value)}
                className="min-w-[280px] rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="">Select invoice</option>
                {(invoiceQuery.data ?? []).map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} · ${Number(invoice.total ?? 0).toLocaleString()} · {invoice.quickbooks_gl_status ?? "not_synced"}
                  </option>
                ))}
              </select>
              <Button onClick={() => selectedInvoiceId && syncInvoice.mutate(selectedInvoiceId)} disabled={!selectedInvoiceId || syncInvoice.isPending}>
                Post selected invoice
              </Button>
            </div>

            {(jobsQuery.data ?? []).length > 0 ? (
              <div className="mt-4 space-y-3">
                {(jobsQuery.data ?? []).map((job) => {
                  const invoice = one(job.customer_invoices);
                  return (
                    <div key={job.id} className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {invoice?.invoice_number ?? job.invoice_id}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Status: {job.status} · Invoice status: {invoice?.quickbooks_gl_status ?? "—"} · Last attempt: {timestampLabel(job.last_attempt_at)}
                          </p>
                          {job.quickbooks_txn_id ? (
                            <p className="mt-1 text-xs text-muted-foreground">QuickBooks Txn: {job.quickbooks_txn_id}</p>
                          ) : null}
                          {job.error_message ? (
                            <p className="mt-2 inline-flex items-center gap-1 text-xs text-destructive">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {job.error_message}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            ${Number(invoice?.total ?? 0).toLocaleString()}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => syncInvoice.mutate(job.invoice_id)}
                            disabled={syncInvoice.isPending}
                          >
                            Retry / post
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No QuickBooks sync jobs yet.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        <Link to="/admin" className="text-primary hover:underline">Back to admin</Link>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  helper,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  helper?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
      />
      {helper ? <p className="text-[11px] text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
