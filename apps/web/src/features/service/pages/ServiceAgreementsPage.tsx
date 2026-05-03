import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardList, Plus, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  deriveServiceAgreementStatus,
  formatAgreementWindow,
  matchesAgreementSearch,
  normalizeServiceAgreementCompanyOptions,
  normalizeServiceAgreementEquipmentOptions,
  normalizeServiceAgreementRows,
  one,
  type ServiceAgreementStatus,
} from "../lib/service-agreement-utils";

const STATUS_STYLES: Record<ServiceAgreementStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expired: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-300",
};

export function ServiceAgreementsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showExpired, setShowExpired] = useState(false);
  const [contractNumber, setContractNumber] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [programName, setProgramName] = useState("");
  const [category, setCategory] = useState("");
  const [termMonths, setTermMonths] = useState("12");

  const companiesQuery = useQuery({
    queryKey: ["service-agreements", "companies"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: unknown[] | null; error: unknown }> };
        };
      })
        .from("qrm_companies")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return normalizeServiceAgreementCompanyOptions(data);
    },
  });

  const equipmentQuery = useQuery({
    queryKey: ["service-agreements", "equipment"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: unknown[] | null; error: unknown }> };
        };
      })
        .from("qrm_equipment")
        .select("id, name, stock_number, serial_number, make, model")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return normalizeServiceAgreementEquipmentOptions(data);
    },
  });

  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");

  const agreementsQuery = useQuery({
    queryKey: ["service-agreements"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => { order: (column: string, opts?: Record<string, boolean>) => Promise<{ data: unknown[] | null; error: unknown }> };
        };
      })
        .from("service_agreements")
        .select("id, contract_number, status, customer_id, equipment_id, location_code, program_name, category, coverage_summary, starts_on, expires_on, renewal_date, billing_cycle, term_months, included_pm_services, estimated_contract_value, notes, qrm_companies(name), qrm_equipment(stock_number, serial_number, make, model, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return normalizeServiceAgreementRows(data);
    },
  });

  const createAgreement = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as unknown as {
        from: (table: string) => {
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      })
        .from("service_agreements")
        .insert({
          contract_number: contractNumber.trim(),
          customer_id: selectedCompanyId || null,
          equipment_id: selectedEquipmentId || null,
          location_code: locationCode.trim() || null,
          program_name: programName.trim(),
          category: category.trim() || null,
          status: "active",
          starts_on: new Date().toISOString().slice(0, 10),
          expires_on: new Date(new Date().setMonth(new Date().getMonth() + Number(termMonths || "12"))).toISOString().slice(0, 10),
          term_months: Number(termMonths || "12"),
          created_by: profile?.id ?? null,
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-agreements"] });
      setContractNumber("");
      setSelectedCompanyId("");
      setSelectedEquipmentId("");
      setLocationCode("");
      setProgramName("");
      setCategory("");
      setTermMonths("12");
    },
  });

  const visible = useMemo(() => {
    const rows = agreementsQuery.data ?? [];
    return rows.filter((row) => {
      const derivedStatus = deriveServiceAgreementStatus(row.status, row.expires_on);
      if (!showExpired && derivedStatus === "expired") return false;
      return matchesAgreementSearch(row, search);
    });
  }, [agreementsQuery.data, search, showExpired]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <ServiceSubNav />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Phase 4 · Service Agreements
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                Preventive maintenance contracts
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Dedicated agreement register for PM contracts with contract number, covered machine,
                customer, program, category, and expiry tracking. This is separate from `maintenance_schedules`,
                which remain the downstream schedule engine.
              </p>
            </div>
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <ClipboardList className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Active", value: visible.filter((row) => deriveServiceAgreementStatus(row.status, row.expires_on) === "active").length },
              { label: "Expired", value: (agreementsQuery.data ?? []).filter((row) => deriveServiceAgreementStatus(row.status, row.expires_on) === "expired").length },
              { label: "Programs", value: new Set((agreementsQuery.data ?? []).map((row) => row.program_name)).size },
              { label: "With machine", value: (agreementsQuery.data ?? []).filter((row) => row.equipment_id).length },
            ].map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {metric.label}
                </p>
                <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{metric.value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                New agreement
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Add contract</h2>
            </div>
            <Button size="sm" className="rounded-xl" onClick={() => createAgreement.mutate()} disabled={createAgreement.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Create
            </Button>
          </div>

          <div className="mt-4 grid gap-3">
            <input
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              placeholder="Contract number"
              className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />
            <select
              value={selectedEquipmentId}
              onChange={(e) => setSelectedEquipmentId(e.target.value)}
              className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="">Select machine</option>
              {(equipmentQuery.data ?? []).map((equipment) => (
                <option key={equipment.id} value={equipment.id}>
                  {equipment.stock_number ?? "No stock"} · {equipment.serial_number ?? "No serial"} · {equipment.make ?? "Unknown"} {equipment.model ?? ""}
                </option>
              ))}
            </select>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="">Select customer</option>
              {(companiesQuery.data ?? []).map((company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={programName}
                onChange={(e) => setProgramName(e.target.value)}
                placeholder="Program"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Category"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={locationCode}
                onChange={(e) => setLocationCode(e.target.value)}
                placeholder="Location"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
                placeholder="Term months"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
            {createAgreement.isError ? (
              <p className="text-sm text-destructive">{(createAgreement.error as Error).message}</p>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Contract register
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Service agreements</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contract, machine, customer, program"
              className="min-w-[260px] rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />
            <label className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
              <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
              Show expired
            </label>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {agreementsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading agreements…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service agreements match the current filters.</p>
          ) : (
            visible.map((agreement) => {
              const company = one(agreement.qrm_companies);
              const equipment = one(agreement.qrm_equipment);
              const status = deriveServiceAgreementStatus(agreement.status, agreement.expires_on);
              return (
                <Link
                  key={agreement.id}
                  to={`/service/agreements/${agreement.id}`}
                  className="block rounded-2xl border border-border/60 bg-background/60 p-4 transition hover:border-primary/25 hover:bg-background"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{agreement.contract_number}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status]}`}>
                          {status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {company?.name ?? "No customer"} · {agreement.program_name} · {agreement.category ?? "No category"}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {equipment?.stock_number ?? "No stock"} · {equipment?.serial_number ?? "No serial"} · {equipment?.make ?? "Unknown"} {equipment?.model ?? ""}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{formatAgreementWindow(agreement.starts_on, agreement.expires_on)}</p>
                      <p className="mt-1">{agreement.location_code ?? "No location"}</p>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
