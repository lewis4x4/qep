import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, ClipboardList, FileText, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ServiceSubNav } from "../components/ServiceSubNav";
import {
  enrollServicePlanEquipment,
  getServicePlanEnrollmentForAgreement,
  listServicePlanEntitlementBalances,
  listServicePlanPrograms,
  setServicePlanEnrollmentStatus,
} from "../lib/service-plan-api";
import {
  canMutateServicePlans,
  getAgreementEnrollmentReadiness,
  parseBaselineHoursInput,
} from "../lib/service-plan-utils";
import {
  deriveServiceAgreementStatus,
  formatAgreementWindow,
  normalizeServiceAgreementMaintenanceRows,
  normalizeServiceAgreementRow,
  one,
  type ServiceAgreementStatus,
} from "../lib/service-agreement-utils";

const STATUS_STYLES: Record<ServiceAgreementStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expired: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-300",
};

export function ServiceAgreementDetailPage() {
  const { agreementId = "" } = useParams<{ agreementId: string }>();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const canMutate = canMutateServicePlans(profile?.role);
  const workspaceId = profile?.active_workspace_id?.trim() || "default";
  const [enrolledOn, setEnrolledOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [baselineHours, setBaselineHours] = useState("");
  const [endReason, setEndReason] = useState("");

  const agreementQuery = useQuery({
    queryKey: ["service-agreement", agreementId],
    enabled: agreementId.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_agreements")
        .select("id, contract_number, status, customer_id, equipment_id, location_code, program_id, program_name, category, coverage_summary, starts_on, expires_on, renewal_date, billing_cycle, term_months, included_pm_services, estimated_contract_value, notes, qrm_companies(name), qrm_equipment(stock_number, serial_number, make, model, name)")
        .eq("id", agreementId)
        .maybeSingle();
      if (error) throw error;
      return normalizeServiceAgreementRow(data);
    },
  });

  const programsQuery = useQuery({
    queryKey: ["service-plan-programs"],
    queryFn: listServicePlanPrograms,
  });

  const enrollmentQuery = useQuery({
    queryKey: ["service-plan-enrollment", agreementId],
    enabled: agreementId.length > 0,
    queryFn: () => getServicePlanEnrollmentForAgreement(agreementId),
  });

  const balancesQuery = useQuery({
    queryKey: ["service-plan-entitlement-balances", agreementId],
    enabled: agreementId.length > 0,
    queryFn: () => listServicePlanEntitlementBalances(agreementId),
  });

  const maintenanceQuery = useQuery({
    queryKey: ["service-agreement-maintenance", agreementQuery.data?.equipment_id],
    enabled: Boolean(agreementQuery.data?.equipment_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_schedules")
        .select("id, label, scheduled_date, status")
        .eq("equipment_id", agreementQuery.data!.equipment_id!)
        .order("scheduled_date", { ascending: true });
      if (error) throw error;
      return normalizeServiceAgreementMaintenanceRows(data);
    },
  });

  const updateAgreement = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase
        .from("service_agreements")
        .update(payload)
        .eq("id", agreementId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-agreement", agreementId] });
    },
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error("Sign in required to enroll equipment.");
      const baseline = parseBaselineHoursInput(baselineHours);
      return enrollServicePlanEquipment({
        workspaceId,
        serviceAgreementId: agreementId,
        enrolledOn,
        baselineHours: baseline,
        actorId: profile.id,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["service-plan-enrollment", agreementId] }),
        qc.invalidateQueries({ queryKey: ["service-plan-entitlement-balances", agreementId] }),
      ]);
    },
  });

  const enrollmentStatusMutation = useMutation({
    mutationFn: async (status: "active" | "paused" | "ended") => {
      if (!profile?.id) throw new Error("Sign in required to update enrollment.");
      const enrollment = enrollmentQuery.data;
      if (!enrollment) throw new Error("No enrollment to update.");
      if (status === "ended" && !endReason.trim()) {
        throw new Error("End reason is required.");
      }
      return setServicePlanEnrollmentStatus({
        workspaceId,
        enrollmentId: enrollment.id,
        status,
        actorId: profile.id,
        reason: status === "ended" ? endReason.trim() : null,
      });
    },
    onSuccess: async () => {
      setEndReason("");
      await qc.invalidateQueries({ queryKey: ["service-plan-enrollment", agreementId] });
    },
  });

  const header = agreementQuery.data;
  const company = one(header?.qrm_companies);
  const equipment = one(header?.qrm_equipment);
  const boundProgram = useMemo(
    () => (programsQuery.data ?? []).find((program) => program.id === header?.program_id) ?? null,
    [programsQuery.data, header?.program_id],
  );
  const derivedStatus = useMemo(
    () => (header ? deriveServiceAgreementStatus(header.status, header.expires_on) : "draft"),
    [header],
  );
  const enrollmentReadiness = header
    ? getAgreementEnrollmentReadiness({
        status: header.status,
        program_id: header.program_id,
        equipment_id: header.equipment_id,
        starts_on: header.starts_on,
        expires_on: header.expires_on,
        enrolled_on: enrolledOn,
        programIsActive: boundProgram?.is_active,
        programReviewed: boundProgram ? boundProgram.review_status === "reviewed" : undefined,
        programProvisional: boundProgram?.is_provisional,
      })
    : null;

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
        <Link
          to="/service/plans"
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          Service plans
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
              <select
                value={header.program_id ?? ""}
                onChange={(e) => {
                  const nextId = e.target.value || null;
                  const program = (programsQuery.data ?? []).find((row) => row.id === nextId) ?? null;
                  updateAgreement.mutate({
                    program_id: nextId,
                    program_name: program?.name ?? header.program_name,
                  });
                }}
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="">No catalog program</option>
                {(programsQuery.data ?? []).map((program) => {
                  const enrollReady = program.is_active && program.review_status === "reviewed" && !program.is_provisional;
                  return (
                    <option key={program.id} value={program.id}>
                      {program.name}{enrollReady ? "" : " (not enrollment-ready)"}
                    </option>
                  );
                })}
              </select>
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
                <ClipboardList className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Service-plan enrollment
                </p>
              </div>

              {enrollmentQuery.isLoading ? (
                <p className="mt-3 text-sm text-muted-foreground">Loading enrollment…</p>
              ) : enrollmentQuery.data ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-foreground">
                    Status: <span className="font-semibold">{enrollmentQuery.data.status}</span>
                    {" · "}baseline {enrollmentQuery.data.baseline_hours ?? "—"} ({enrollmentQuery.data.baseline_source})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Enrolled {enrollmentQuery.data.enrolled_on}
                    {enrollmentQuery.data.end_reason ? ` · ${enrollmentQuery.data.end_reason}` : ""}
                  </p>
                  <div className="space-y-2">
                    {enrollmentQuery.data.schedules.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No cadence schedules yet.</p>
                    ) : (
                      enrollmentQuery.data.schedules.map((schedule) => (
                        <div key={schedule.id} className="rounded-xl border border-border/50 bg-background/70 p-3 text-sm">
                          <p className="font-medium text-foreground">Cycle {schedule.cycle_number}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Next due: {schedule.next_due_on ?? "—"}
                            {schedule.next_due_hours != null ? ` / ${schedule.next_due_hours}h` : ""}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                  {(balancesQuery.data ?? []).length > 0 ? (
                    <div className="rounded-xl border border-border/50 bg-background/70 p-3 text-xs text-muted-foreground">
                      {(balancesQuery.data ?? []).map((balance) => (
                        <p key={`${balance.unit_code}-${balance.service_agreement_id}`}>
                          {balance.unit_code}: available {balance.available_quantity}, reserved {balance.reserved_quantity}, consumed {balance.consumed_quantity}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {canMutate && enrollmentQuery.data.status !== "ended" ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {enrollmentQuery.data.status === "paused" ? (
                          <Button
                            variant="outline"
                            className="min-h-11"
                            disabled={enrollmentStatusMutation.isPending}
                            onClick={() => enrollmentStatusMutation.mutate("active")}
                          >
                            Resume
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            className="min-h-11"
                            disabled={enrollmentStatusMutation.isPending}
                            onClick={() => enrollmentStatusMutation.mutate("paused")}
                          >
                            Pause
                          </Button>
                        )}
                      </div>
                      <input
                        value={endReason}
                        onChange={(e) => setEndReason(e.target.value)}
                        placeholder="End reason"
                        className="min-h-11 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                      />
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={enrollmentStatusMutation.isPending}
                        onClick={() => enrollmentStatusMutation.mutate("ended")}
                      >
                        End enrollment
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Enroll this agreement&apos;s machine into the bound catalog program to create hour/calendar schedules.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="date"
                      value={enrolledOn}
                      onChange={(e) => setEnrolledOn(e.target.value)}
                      className="min-h-11 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                    />
                    <input
                      value={baselineHours}
                      onChange={(e) => setBaselineHours(e.target.value)}
                      placeholder="Baseline hours (blank = meter)"
                      className="min-h-11 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  {enrollmentReadiness && !enrollmentReadiness.ready ? (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {enrollmentReadiness.reasons.map((reason) => (
                        <li key={reason}>• {reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  {canMutate ? (
                    <Button
                      className="min-h-11"
                      disabled={enrollMutation.isPending || !enrollmentReadiness?.ready}
                      onClick={() => enrollMutation.mutate()}
                    >
                      Enroll equipment
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">Elevated role required to enroll.</p>
                  )}
                </div>
              )}
              {enrollMutation.isError ? (
                <p className="mt-2 text-sm text-destructive">{(enrollMutation.error as Error).message}</p>
              ) : null}
              {enrollmentStatusMutation.isError ? (
                <p className="mt-2 text-sm text-destructive">{(enrollmentStatusMutation.error as Error).message}</p>
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
