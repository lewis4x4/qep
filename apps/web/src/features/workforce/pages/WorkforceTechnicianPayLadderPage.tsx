import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Award, BadgeCheck, CheckCircle2, Clock, KeyRound, Loader2, ShieldCheck, Wrench, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { WorkforceSubNav } from "../components/WorkforceSubNav";
import {
  fetchTechnicianInHouseCertifications,
  fetchTechnicianOemCertifications,
  fetchTechnicianProgression,
  fetchTechnicianVendorLogins,
  formatMoneyFromCents,
  formatPercent,
  formatRoleLabel,
  OEM_VENDORS,
  type CertificationStatus,
  type MissingRequirement,
  type RequiredOemCertification,
  type TechnicianInHouseCertification,
  type TechnicianOemCertification,
  type TechnicianProgression,
  type TechnicianVendorLogin,
} from "../lib/workforce-api";

function statusTone(status: string): string {
  if (status === "completed" || status === "active") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "started" || status === "pending") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (status === "expired" || status === "disabled") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  return "border-border bg-muted/40 text-muted-foreground";
}

function statusRank(status: string | null | undefined): number {
  if (status === "completed") return 2;
  if (status === "started") return 1;
  return 0;
}

function requiredRank(status: string | null | undefined): number {
  return status === "started" ? 1 : 2;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function LoadingBlock() {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading RLS-scoped technician progression…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Technician progression did not load.</p>
          <p className="mt-1 text-xs opacity-90">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export function WorkforceTechnicianPayLadderPage() {
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const progressionQuery = useQuery({ queryKey: ["workforce", "pay-ladder", "progression"], queryFn: fetchTechnicianProgression });
  const oemQuery = useQuery({ queryKey: ["workforce", "pay-ladder", "oem-certs"], queryFn: fetchTechnicianOemCertifications });
  const inHouseQuery = useQuery({ queryKey: ["workforce", "pay-ladder", "in-house-certs"], queryFn: fetchTechnicianInHouseCertifications });
  const vendorLoginQuery = useQuery({ queryKey: ["workforce", "pay-ladder", "vendor-logins"], queryFn: fetchTechnicianVendorLogins });

  const rows = progressionQuery.data ?? [];
  const selected = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.find((row) => row.technician_profile_id === selectedProfileId) ?? rows[0];
  }, [rows, selectedProfileId]);

  const profileId = selected?.technician_profile_id ?? "";
  const oemCerts = (oemQuery.data ?? []).filter((cert) => cert.technician_profile_id === profileId);
  const inHouseCerts = (inHouseQuery.data ?? []).filter((cert) => cert.technician_profile_id === profileId);
  const vendorLogins = (vendorLoginQuery.data ?? []).filter((login) => login.technician_profile_id === profileId);

  const loading = progressionQuery.isLoading || oemQuery.isLoading || inHouseQuery.isLoading || vendorLoginQuery.isLoading;
  const error = progressionQuery.error ?? oemQuery.error ?? inHouseQuery.error ?? vendorLoginQuery.error;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Technician pay ladder + certifications</h1>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Road, Shop, and Grapple progression with live H4 efficiency, H8 comeback accountability, tenure, tooling, OEM certs, and in-house requirements. Empty means no visible technician ladder data under RLS.
          </p>
        </div>
        <WorkforceSubNav />
      </div>

      {error ? <ErrorState message={error instanceof Error ? error.message : "Unknown error"} /> : null}
      {loading ? <LoadingBlock /> : null}

      {!loading && rows.length === 0 ? (
        <Card className="border-dashed p-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-sm font-bold text-foreground">No visible technician ladder records</h2>
          <p className="mt-1 text-xs text-muted-foreground">You either have nothing assigned or RLS has no pay-ladder records for your role.</p>
        </Card>
      ) : null}

      {selected ? (
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="h-fit p-4">
            <h2 className="text-sm font-bold text-foreground">Visible technicians</h2>
            <div className="mt-3 space-y-2">
              {rows.map((row) => (
                <button
                  key={row.technician_profile_id}
                  type="button"
                  onClick={() => setSelectedProfileId(row.technician_profile_id)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition hover:border-primary/50 hover:bg-primary/5",
                    selected.technician_profile_id === row.technician_profile_id ? "border-primary/50 bg-primary/10" : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{row.technician_name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{formatRoleLabel(row.pay_ladder_role)} · {row.current_tier_name ?? "No current tier"}</p>
                    </div>
                    {row.eligible_for_next_tier ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-5">
            <HeroProgression row={selected} />
            <GateGrid row={selected} />
            <CertificationReadiness row={selected} oemCerts={oemCerts} inHouseCerts={inHouseCerts} vendorLogins={vendorLogins} />
            <CertificationTracker oemCerts={oemCerts} inHouseCerts={inHouseCerts} vendorLogins={vendorLogins} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HeroProgression({ row }: { row: TechnicianProgression }) {
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-5 text-white dark:from-black dark:to-slate-950">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-qep-orange">{formatRoleLabel(row.pay_ladder_role)} ladder</p>
            <h2 className="mt-1 text-2xl font-black">{row.technician_name}</h2>
            <p className="mt-1 text-sm text-white/70">
              {row.current_tier_name ?? "No current tier assigned"} → {row.top_tier_reached ? "Top tier reached" : row.next_tier_name ?? "Next tier unavailable"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[560px]">
            <MetricCard label="Current wage" value={formatMoneyFromCents(row.hourly_wage_cents)} />
            <MetricCard label="Next band" value={row.next_compensation_min_cents == null ? "—" : `${formatMoneyFromCents(row.next_compensation_min_cents)}-${formatMoneyFromCents(row.next_compensation_max_cents)}`} />
            <MetricCard label="Efficiency" value={formatPercent(row.efficiency_pct_180d)} />
            <MetricCard label="Comebacks" value={String(row.comeback_gate_count ?? 0)} />
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-3">
        <StatusTile label="Eligibility" value={row.top_tier_reached ? "Top tier reached" : row.eligible_for_next_tier ? "Eligible for next tier" : "Requirements missing"} good={row.eligible_for_next_tier || row.top_tier_reached} />
        <StatusTile label="Tenure" value={row.tenure_months == null ? "Not recorded" : `${row.tenure_months} months since ${formatDate(row.tenure_start_date)}`} good={row.required_tenure_months == null || (row.tenure_months ?? 0) >= row.required_tenure_months} />
        <StatusTile label="Tooling" value={row.tool_count == null ? row.tooling_verified_at ? `Verified ${new Date(row.tooling_verified_at).toLocaleDateString()}` : "Not verified" : `${row.tool_count} tools recorded`} good={!row.tool_requirement_key || !row.missing_requirements.some((req) => req.key.includes("tool"))} />
      </div>
    </Card>
  );
}

function GateGrid({ row }: { row: TechnicianProgression }) {
  const missingKeys = new Set(row.missing_requirements.map((req) => req.key));
  const gates = [
    {
      label: "Efficiency",
      value: `${formatPercent(row.efficiency_pct_180d)} / ${formatPercent(row.required_efficiency_pct)}`,
      ok: row.required_efficiency_pct == null || !missingKeys.has("efficiency_pct"),
      detail: `${row.efficiency_job_count_180d ?? 0} jobs · ${row.efficiency_window_days ?? 180}d window`,
    },
    {
      label: "Comebacks",
      value: `${row.comeback_gate_count ?? 0} / max ${row.required_max_qep_fault_comebacks ?? "—"}`,
      ok: row.required_max_qep_fault_comebacks == null || !missingKeys.has("qep_fault_comebacks"),
      detail: `${row.comeback_window_days ?? 180}d QEP-fault window`,
    },
    {
      label: "Tenure",
      value: `${row.tenure_months ?? "—"} / ${row.required_tenure_months ?? "—"} months`,
      ok: row.required_tenure_months == null || !missingKeys.has("tenure_months"),
      detail: row.tenure_start_date ? `Started ${formatDate(row.tenure_start_date)}` : "No tenure anchor",
    },
    {
      label: "OEM certs",
      value: `${row.required_oem_certifications.length} required`,
      ok: !row.missing_requirements.some((req) => req.key === "oem_certification"),
      detail: "Cummins / ASV / Yanmar / Sennebogen / Develon / ASC",
    },
    {
      label: "In-house certs",
      value: `${row.required_in_house_cert_keys.length} required`,
      ok: !missingKeys.has("in_house_certifications"),
      detail: row.required_in_house_cert_keys.length ? row.required_in_house_cert_keys.join(", ") : "None for next tier",
    },
    {
      label: "Vendor logins",
      value: row.requires_vendor_logins ? `${row.vendor_login_required_vendors.length} required` : "Not required",
      ok: !missingKeys.has("vendor_logins"),
      detail: row.requires_vendor_logins ? row.vendor_login_required_vendors.join(", ") : "No login gate",
    },
  ];

  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-foreground">Next-tier gates</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {gates.map((gate) => (
          <div key={gate.label} className={cn("rounded-2xl border p-3", gate.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{gate.label}</p>
              {gate.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-amber-500" />}
            </div>
            <p className="mt-2 text-lg font-black text-foreground">{gate.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{gate.detail}</p>
          </div>
        ))}
      </div>
      {row.missing_requirements.length > 0 && !row.top_tier_reached ? (
        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">Missing requirements</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {row.missing_requirements.map((req, index) => <MissingRequirementLine key={`${req.key}-${index}`} requirement={req} />)}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function CertificationReadiness({
  row,
  oemCerts,
  inHouseCerts,
  vendorLogins,
}: {
  row: TechnicianProgression;
  oemCerts: TechnicianOemCertification[];
  inHouseCerts: TechnicianInHouseCertification[];
  vendorLogins: TechnicianVendorLogin[];
}) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-foreground">Held vs missing for next band</h3>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-border/70 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">OEM requirements</p>
          <div className="mt-3 space-y-2">
            {row.required_oem_certifications.length === 0 ? <p className="text-xs text-muted-foreground">No OEM cert gate for next tier.</p> : null}
            {row.required_oem_certifications.map((req) => <OemRequirement key={`${req.vendor}-${req.min_status}-${req.in_person_required}`} req={req} certs={oemCerts} />)}
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">In-house requirements</p>
          <div className="mt-3 space-y-2">
            {row.required_in_house_cert_keys.length === 0 ? <p className="text-xs text-muted-foreground">No in-house cert gate for next tier.</p> : null}
            {row.required_in_house_cert_keys.map((key) => {
              const cert = inHouseCerts.find((item) => item.certification_key === key && item.status === "completed");
              return <RequirementPill key={key} label={key.replace(/_/g, " ")} ok={Boolean(cert)} detail={cert ? "completed" : "missing"} />;
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Vendor login readiness</p>
          <div className="mt-3 space-y-2">
            {!row.requires_vendor_logins ? <p className="text-xs text-muted-foreground">No vendor-login gate for next tier.</p> : null}
            {row.vendor_login_required_vendors.map((vendor) => {
              const login = vendorLogins.find((item) => item.vendor === vendor && item.status === "active");
              return <RequirementPill key={vendor} label={vendor} ok={Boolean(login)} detail={login?.login_identifier ?? (login ? "active" : "missing")} icon="login" />;
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

function CertificationTracker({
  oemCerts,
  inHouseCerts,
  vendorLogins,
}: {
  oemCerts: TechnicianOemCertification[];
  inHouseCerts: TechnicianInHouseCertification[];
  vendorLogins: TechnicianVendorLogin[];
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="text-sm font-bold text-foreground">OEM certification tracker</h3>
        <div className="mt-4 grid gap-2">
          {OEM_VENDORS.map((vendor) => {
            const certs = oemCerts.filter((cert) => cert.vendor === vendor);
            return (
              <div key={vendor} className="rounded-2xl border border-border/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold capitalize text-foreground">{vendor}</p>
                  <span className="text-[11px] text-muted-foreground">{certs.length} record{certs.length === 1 ? "" : "s"}</span>
                </div>
                {certs.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No visible certification records.</p> : null}
                {certs.map((cert) => <CertRow key={cert.id} name={cert.certification_name} status={cert.status} detail={`${cert.is_in_person ? "In-person" : "Remote/online"} · expires ${formatDate(cert.expires_at)}`} />)}
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-bold text-foreground">In-house certifications + logins</h3>
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-border/70 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">In-house</p>
            {inHouseCerts.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No visible in-house certification records.</p> : null}
            {inHouseCerts.map((cert) => <CertRow key={cert.id} name={cert.certification_name} status={cert.status} detail={`issued ${formatDate(cert.issued_at)} · expires ${formatDate(cert.expires_at)}`} />)}
          </div>
          <div className="rounded-2xl border border-border/70 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Vendor logins (non-secret)</p>
            {vendorLogins.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No visible vendor login records.</p> : null}
            {vendorLogins.map((login) => <CertRow key={login.id} name={login.vendor} status={login.status} detail={`${login.login_identifier ?? "identifier not stored"} · verified ${login.verified_at ? new Date(login.verified_at).toLocaleDateString() : "—"}`} icon="login" />)}
          </div>
        </div>
      </Card>
    </div>
  );
}

function OemRequirement({ req, certs }: { req: RequiredOemCertification; certs: TechnicianOemCertification[] }) {
  const cert = certs.find((item) =>
    item.vendor === req.vendor &&
    statusRank(item.status) >= requiredRank(req.min_status) &&
    (!req.in_person_required || item.is_in_person) &&
    (!item.expires_at || item.expires_at >= new Date().toISOString().slice(0, 10)),
  );
  return (
    <RequirementPill
      label={`${req.vendor}${req.in_person_required ? " in-person" : ""}`}
      ok={Boolean(cert)}
      detail={cert ? `${cert.status} · ${cert.certification_name}` : `missing ${req.min_status ?? "completed"}`}
    />
  );
}

function RequirementPill({ label, ok, detail, icon }: { label: string; ok: boolean; detail: string; icon?: "login" }) {
  const Icon = ok ? CheckCircle2 : icon === "login" ? KeyRound : XCircle;
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border p-2", ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ok ? "text-emerald-500" : "text-amber-500")} />
      <div className="min-w-0">
        <p className="text-xs font-bold capitalize text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function MissingRequirementLine({ requirement }: { requirement: MissingRequirement }) {
  let label = requirement.key.replace(/_/g, " ");
  let detail = "Missing requirement";
  if (requirement.key === "efficiency_pct") detail = `${requirement.actual ?? "—"}% actual; needs ${requirement.required}%`;
  if (requirement.key === "qep_fault_comebacks") detail = `${requirement.actual ?? 0} comeback(s); max ${requirement.required_max}`;
  if (requirement.key === "tenure_months") detail = `${requirement.actual ?? "—"} months; needs ${requirement.required}`;
  if (requirement.key === "oem_certification") {
    label = `${requirement.vendor ?? "OEM"} certification`;
    detail = `${requirement.min_status ?? "completed"}${requirement.in_person_required ? " · in-person required" : ""}`;
  }
  if (requirement.key === "in_house_certifications") detail = requirement.missing?.join(", ") ?? "In-house cert missing";
  if (requirement.key === "vendor_logins") detail = requirement.missing_vendors?.join(", ") ?? "Vendor login missing";
  return (
    <div className="rounded-xl border border-amber-500/20 bg-background p-2">
      <p className="text-xs font-bold capitalize text-foreground">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function StatusTile({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-3", good ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function CertRow({ name, status, detail, icon }: { name: string; status: CertificationStatus | TechnicianVendorLogin["status"]; detail: string; icon?: "login" }) {
  const Icon = status === "completed" || status === "active" ? BadgeCheck : icon === "login" ? KeyRound : Wrench;
  return (
    <div className="mt-2 flex items-start justify-between gap-2 rounded-xl bg-muted/20 p-2">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-qep-orange" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{name}</p>
          <p className="text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </div>
      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase", statusTone(status))}>{status.replace(/_/g, " ")}</span>
    </div>
  );
}
