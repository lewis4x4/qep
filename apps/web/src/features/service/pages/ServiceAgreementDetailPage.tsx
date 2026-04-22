import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, FileText, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { deriveServiceAgreementStatus, formatAgreementWindow, type ServiceAgreementStatus } from "../lib/service-agreement-utils";

type AgreementHeader = {
  id: string;
  contract_number: string;
  status: ServiceAgreementStatus;
  customer_id: string | null;
  equipment_id: string | null;
  location_code: string | null;
  program_name: string;
  category: string | null;
  coverage_summary: string | null;
  starts_on: string | null;
  expires_on: string | null;
  renewal_date: string | null;
  billing_cycle: string | null;
  term_months: number | null;
  included_pm_services: number | null;
  estimated_contract_value: number | null;
  notes: string | null;
  qrm_companies?: { name?: string } | { name?: string }[] | null;
  qrm_equipment?: {
    stock_number?: string | null;
    serial_number?: string | null;
    make?: string | null;
    model?: string | null;
    name?: string | null;
  } | {
    stock_number?: string | null;
    serial_number?: string | null;
    make?: string | null;
    model?: string | null;
    name?: string | null;
  }[] | null;
};

type MaintenanceRow = {
  id: string;
  label: string | null;
  scheduled_date: string | null;
  status: string;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const STATUS_STYLES: Record<ServiceAgreementStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expired: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-300",
};

export function ServiceAgreementDetailPage() {
  const { agreementId = "" } = useParams<{ agreementId: string }>();
  const qc = useQueryClient();

  const agreementQuery = useQuery({
    queryKey: ["service-agreement", agreementId],
    enabled: agreementId.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: AgreementHeader | null; error: unknown }> } };
        };
      })
        .from("service_agreements")
        .select("id, contract_number, status, customer_id, equipment_id, location_code, program_name, category, coverage_summary, starts_on, expires_on, renewal_date, billing_cycle, term_months, included_pm_services, estimated_contract_value, notes, qrm_companies(name), qrm_equipment(stock_number, serial_number, make, model, name)")
        .eq("id", agreementId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const maintenanceQuery = useQuery({
    queryKey: ["service-agreement-maintenance", agreementQuery.data?.equipment_id],
    enabled: Boolean(agreementQuery.data?.equipment_id),
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: MaintenanceRow[] | null; error: unknown }> } };
        };
      })
        .from("maintenance_schedules")
        .select("id, label, scheduled_date, status")
        .eq("equipment_id", agreementQuery.data!.equipment_id!)
        .order("scheduled_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateAgreement = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          update: (row: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
        };
      })
        .from("service_agreements")
        .update(payload)
        .eq("id", agreementId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-agreement", agreementId] });
    },
  });

  const header = agreementQuery.data;
  const company = one(header?.qrm_companies);
  const equipment = one(header?.qrm_equipment);
  const derivedStatus = useMemo(
    () => (header ? deriveServiceAgreementStatus(header.status, header.expires_on) : "draft"),
    [header],
  );

  if (!agreementId) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <ServiceSubNav />

      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/service/agreements"
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All agreements
        </Link>
      </div>

      {agreementQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !header ? (
        <Card className="p-4 text-sm text-destructive">Agreement not found.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Service agreement
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{header.contract_number}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {company?.name ?? "No customer"} · {header.program_name}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[derivedStatus]}`}>
                {derivedStatus}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                defaultValue={header.program_name}
                onBlur={(e) => {
                  if (header.program_name !== e.target.value) {
                    updateAgreement.mutate({ program_name: e.target.value });
                  }
                }}
                placeholder="Program"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                defaultValue={header.category ?? ""}
                onBlur={(e) => {
                  if ((header.category ?? "") !== e.target.value) {
                    updateAgreement.mutate({ category: e.target.value || null });
                  }
                }}
                placeholder="Category"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                defaultValue={header.location_code ?? ""}
                onBlur={(e) => {
                  if ((header.location_code ?? "") !== e.target.value) {
                    updateAgreement.mutate({ location_code: e.target.value || null });
                  }
                }}
                placeholder="Location"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                defaultValue={header.billing_cycle ?? ""}
                onBlur={(e) => {
                  if ((header.billing_cycle ?? "") !== e.target.value) {
                    updateAgreement.mutate({ billing_cycle: e.target.value || null });
                  }
                }}
                placeholder="Billing cycle"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                type="date"
                defaultValue={header.starts_on ?? ""}
                onBlur={(e) => {
                  if ((header.starts_on ?? "") !== e.target.value) {
                    updateAgreement.mutate({ starts_on: e.target.value || null });
                  }
                }}
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                type="date"
                defaultValue={header.expires_on ?? ""}
                onBlur={(e) => {
                  if ((header.expires_on ?? "") !== e.target.value) {
                    updateAgreement.mutate({ expires_on: e.target.value || null });
                  }
                }}
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                type="number"
                defaultValue={header.term_months ?? undefined}
                onBlur={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null;
                  if ((header.term_months ?? null) !== next) {
                    updateAgreement.mutate({ term_months: next });
                  }
                }}
                placeholder="Term months"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                type="number"
                defaultValue={header.included_pm_services ?? undefined}
                onBlur={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null;
                  if ((header.included_pm_services ?? null) !== next) {
                    updateAgreement.mutate({ included_pm_services: next });
                  }
                }}
                placeholder="Included PM services"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>

            <textarea
              defaultValue={header.coverage_summary ?? ""}
              onBlur={(e) => {
                if ((header.coverage_summary ?? "") !== e.target.value) {
                  updateAgreement.mutate({ coverage_summary: e.target.value || null });
                }
              }}
              placeholder="Coverage summary"
              className="mt-4 min-h-[110px] w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />

            <textarea
              defaultValue={header.notes ?? ""}
              onBlur={(e) => {
                if ((header.notes ?? "") !== e.target.value) {
                  updateAgreement.mutate({ notes: e.target.value || null });
                }
              }}
              placeholder="Notes"
              className="mt-3 min-h-[110px] w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => updateAgreement.mutate({ status: "cancelled" })}>
                Cancel agreement
              </Button>
              <Button variant="outline" onClick={() => updateAgreement.mutate({ status: "active" })}>
                Mark active
              </Button>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Covered machine
              </p>
              <p className="mt-3 text-sm font-semibold text-foreground">
                {equipment?.make ?? "Unknown"} {equipment?.model ?? ""} {equipment?.serial_number ? `· ${equipment.serial_number}` : ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Stock: {equipment?.stock_number ?? "—"}
              </p>
              {header.equipment_id ? (
                <Link to={`/equipment/${header.equipment_id}`} className="mt-3 inline-flex text-sm font-semibold text-primary">
                  Open Asset 360
                </Link>
              ) : null}
            </Card>

            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Agreement window
                </p>
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">
                {formatAgreementWindow(header.starts_on, header.expires_on)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Renewal: {header.renewal_date ?? "—"} · Billing: {header.billing_cycle ?? "—"}
              </p>
              {header.estimated_contract_value != null ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Estimated contract value: ${Number(header.estimated_contract_value).toLocaleString()}
                </p>
              ) : null}
            </Card>

            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Downstream maintenance schedules
                </p>
              </div>
              {maintenanceQuery.isLoading ? (
                <p className="mt-3 text-sm text-muted-foreground">Loading maintenance schedules…</p>
              ) : (maintenanceQuery.data ?? []).length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No existing maintenance schedules are linked to this machine yet.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {(maintenanceQuery.data ?? []).slice(0, 5).map((row) => (
                    <div key={row.id} className="rounded-xl border border-border/50 bg-background/70 p-3">
                      <p className="text-sm font-medium text-foreground">{row.label ?? "Maintenance schedule"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.scheduled_date ?? "No date"} · {row.status}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Contract record
                </p>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Customer: {company?.name ?? "—"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Location: {header.location_code ?? "—"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Program: {header.program_name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Category: {header.category ?? "—"}
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
