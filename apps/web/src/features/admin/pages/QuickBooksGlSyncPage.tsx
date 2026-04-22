import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, FileCog, PlugZap, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type IntegrationRow = {
  integration_key: string;
  display_name: string;
  status: string;
  last_test_success: boolean | null;
  last_test_error: string | null;
  last_sync_error: string | null;
  updated_at: string;
};

type SyncJobRow = {
  id: string;
  invoice_id: string;
  status: string;
  quickbooks_txn_id: string | null;
  error_message: string | null;
  last_attempt_at: string | null;
  customer_invoices?: {
    invoice_number?: string | null;
    total?: number | null;
    quickbooks_gl_status?: string | null;
  } | {
    invoice_number?: string | null;
    total?: number | null;
    quickbooks_gl_status?: string | null;
  }[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function QuickBooksGlSyncPage() {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [realmId, setRealmId] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [arAccountId, setArAccountId] = useState("");
  const [serviceRevenueAccountId, setServiceRevenueAccountId] = useState("");
  const [partsRevenueAccountId, setPartsRevenueAccountId] = useState("");
  const [haulRevenueAccountId, setHaulRevenueAccountId] = useState("");
  const [shopSuppliesAccountId, setShopSuppliesAccountId] = useState("");
  const [miscRevenueAccountId, setMiscRevenueAccountId] = useState("");
  const [taxLiabilityAccountId, setTaxLiabilityAccountId] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");

  const integrationQuery = useQuery({
    queryKey: ["integration-status", "quickbooks"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: IntegrationRow | null; error: unknown }> } };
        };
      })
        .from("integration_status")
        .select("integration_key, display_name, status, last_test_success, last_test_error, last_sync_error, updated_at")
        .eq("integration_key", "quickbooks")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const invoiceQuery = useQuery({
    queryKey: ["quickbooks-gl-sync", "invoices"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { in: (column: string, values: string[]) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: Array<{ id: string; invoice_number: string; total: number; quickbooks_gl_status: string | null }> | null; error: unknown }> } };
        };
      })
        .from("customer_invoices")
        .select("id, invoice_number, total, quickbooks_gl_status")
        .in("quickbooks_gl_status", ["not_synced", "queued", "failed"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsQuery = useQuery({
    queryKey: ["quickbooks-gl-sync", "jobs"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: SyncJobRow[] | null; error: unknown }> };
        };
      })
        .from("quickbooks_gl_sync_jobs")
        .select("id, invoice_id, status, quickbooks_txn_id, error_message, last_attempt_at, customer_invoices(invoice_number, total, quickbooks_gl_status)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveCredentials = useMutation({
    mutationFn: async () => {
      const credentials = JSON.stringify({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        refresh_token: refreshToken.trim(),
        realm_id: realmId.trim(),
        environment,
        ar_account_id: arAccountId.trim(),
        service_revenue_account_id: serviceRevenueAccountId.trim(),
        parts_revenue_account_id: partsRevenueAccountId.trim(),
        haul_revenue_account_id: haulRevenueAccountId.trim(),
        shop_supplies_account_id: shopSuppliesAccountId.trim(),
        misc_revenue_account_id: miscRevenueAccountId.trim(),
        tax_liability_account_id: taxLiabilityAccountId.trim(),
      });
      const { error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "update_integration",
          integration_key: "quickbooks",
          credentials,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integration-status", "quickbooks"] }),
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("quickbooks-gl-sync", {
        body: { action: "test_connection" },
      });
      if (error) throw error;
      return data;
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

  const pendingCount = useMemo(
    () => (invoiceQuery.data ?? []).length,
    [invoiceQuery.data],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Phase 8 · QuickBooks GL
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            QuickBooks GL posting
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Configure QuickBooks credentials, test the connection, and post QEP invoices into QuickBooks Online
            journal entries. This is the finance sync surface for row 4.
          </p>
        </div>
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">
          <FileCog className="h-5 w-5" />
        </div>
      </div>

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Connection
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">QuickBooks credentials</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Stored through the encrypted `integration_status` credential path.
            </p>
          </div>
          <div className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            {integrationQuery.data?.status ?? "pending_credentials"}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="QuickBooks Client ID" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="QuickBooks Client Secret" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} placeholder="QuickBooks Refresh Token" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={realmId} onChange={(e) => setRealmId(e.target.value)} placeholder="QuickBooks Realm ID" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
            <option value="production">Production</option>
            <option value="sandbox">Sandbox</option>
          </select>
          <div className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground">
            Updated: {integrationQuery.data?.updated_at ? new Date(integrationQuery.data.updated_at).toLocaleString() : "—"}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <input value={arAccountId} onChange={(e) => setArAccountId(e.target.value)} placeholder="A/R account id" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={serviceRevenueAccountId} onChange={(e) => setServiceRevenueAccountId(e.target.value)} placeholder="Service revenue account id" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={partsRevenueAccountId} onChange={(e) => setPartsRevenueAccountId(e.target.value)} placeholder="Parts revenue account id" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={haulRevenueAccountId} onChange={(e) => setHaulRevenueAccountId(e.target.value)} placeholder="Haul revenue account id" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={shopSuppliesAccountId} onChange={(e) => setShopSuppliesAccountId(e.target.value)} placeholder="Shop supplies account id" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={miscRevenueAccountId} onChange={(e) => setMiscRevenueAccountId(e.target.value)} placeholder="Misc revenue account id" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
          <input value={taxLiabilityAccountId} onChange={(e) => setTaxLiabilityAccountId(e.target.value)} placeholder="Tax liability account id" className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => saveCredentials.mutate()} disabled={saveCredentials.isPending}>
            Save encrypted credentials
          </Button>
          <Button variant="outline" onClick={() => testConnection.mutate()} disabled={testConnection.isPending}>
            <PlugZap className="mr-1 h-4 w-4" />
            Test connection
          </Button>
        </div>

        {integrationQuery.data?.last_test_error ? (
          <p className="mt-3 text-sm text-destructive">Last test error: {integrationQuery.data.last_test_error}</p>
        ) : null}
        {testConnection.data ? (
          <pre className="mt-3 overflow-x-auto rounded-xl border border-border/60 bg-background p-3 text-xs text-muted-foreground">
            {JSON.stringify(testConnection.data, null, 2)}
          </pre>
        ) : null}
      </Card>

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Sync queue
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Pending invoice postings</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              {pendingCount} pending
            </span>
            <Button variant="outline" onClick={() => syncPending.mutate()} disabled={syncPending.isPending}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Sync pending
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <select
            value={selectedInvoiceId}
            onChange={(e) => setSelectedInvoiceId(e.target.value)}
            className="min-w-[260px] rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
          >
            <option value="">Select invoice</option>
            {(invoiceQuery.data ?? []).map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoice_number} · ${Number(invoice.total ?? 0).toLocaleString()} · {invoice.quickbooks_gl_status ?? "not_synced"}
              </option>
            ))}
          </select>
          <Button onClick={() => selectedInvoiceId && syncInvoice.mutate(selectedInvoiceId)} disabled={!selectedInvoiceId || syncInvoice.isPending}>
            Sync invoice now
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
                        Status: {job.status} · Invoice status: {invoice?.quickbooks_gl_status ?? "—"}
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
                        Retry / sync
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

      <div className="text-sm text-muted-foreground">
        <Link to="/service" className="text-primary hover:underline">Back to service</Link>
      </div>
    </div>
  );
}
