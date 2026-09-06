import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCreateServiceJob } from "../hooks/useServiceJobMutation";
import { populatePartsFromJobCode } from "../lib/api";
import {
  useCustomerSearch,
  useCustomerEquipment,
  useEquipmentSearch,
  type CustomerResult,
  type EquipmentResult,
} from "../hooks/useCustomerSearch";
import {
  H2_SOURCE_TYPE_LABELS,
  H2_REQUEST_TYPE_LABELS,
  H2_PRIORITY_LABELS,
} from "../lib/constants";
import { normalizeIntakeResult, type IntakeResult } from "../lib/service-page-normalizers";
import type { ServiceSourceType, ServiceRequestType, ServicePriority } from "../lib/types";
import { isH2GrappleTruck, validateH2IntakeDraft } from "../lib/service-wo-gates";

// ─── Config ───────────────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<string, string> = {
  call: "📞",
  walk_in: "🚶",
  drop_off: "🏗️",
  field_request: "🌾",
  internal_request: "🏭",
};

const QUICK_SYMPTOMS = [
  "Won't start",
  "No hydraulic power",
  "Overheating",
  "Check engine light",
  "Oil leak",
  "Loss of power",
  "Making unusual noise",
  "Electrical issue",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SearchInput({
  value,
  onChange,
  onFocus,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <svg
        className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
        />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-lg border px-4 py-3 pl-10 text-sm bg-background focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition"
      />
    </div>
  );
}

function SelectedCard({
  icon,
  title,
  subtitle,
  onClear,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/25">
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground truncate">{subtitle}</div>}
      </div>
      <button
        onClick={onClear}
        className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50 transition shrink-0"
      >
        Change
      </button>
    </div>
  );
}

function DropdownList({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover shadow-xl overflow-hidden">
      {children}
    </div>
  );
}

function DropdownItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-muted/50 transition border-b border-border/50 last:border-0"
    >
      {children}
    </button>
  );
}

function SkeletonPulse() {
  return (
    <div className="space-y-2 py-1">
      <div className="h-3.5 bg-muted/40 rounded animate-pulse w-3/4" />
      <div className="h-3.5 bg-muted/40 rounded animate-pulse w-1/2" />
      <div className="h-3.5 bg-muted/40 rounded animate-pulse w-2/3" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ServiceIntakePage() {
  const navigate = useNavigate();
  const createJob = useCreateServiceJob();
  const operationId = useRef(crypto.randomUUID());
  const [registerMachine, setRegisterMachine] = useState(false);
  const [machineDraft, setMachineDraft] = useState({ make: "", model: "", serial_number: "", year: "" });
  const symptomRef = useRef<HTMLTextAreaElement>(null);
  const diagnoseTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const customerDropdownRef = useRef<HTMLDivElement>(null);
  const machineDropdownRef = useRef<HTMLDivElement>(null);

  // ── Selection state ──
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null);
  const [showCustomerDrop, setShowCustomerDrop] = useState(false);

  const [machineQuery, setMachineQuery] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<EquipmentResult | null>(null);
  const [showMachineDrop, setShowMachineDrop] = useState(false);

  // ── Job details ──
  const [symptom, setSymptom] = useState("");
  const [cause, setCause] = useState("");
  const [correction, setCorrection] = useState("");
  const [hourMeter, setHourMeter] = useState("");
  const [odometerMiles, setOdometerMiles] = useState("");
  const [promisedAtLocal, setPromisedAtLocal] = useState("");
  const [fieldSiteLocation, setFieldSiteLocation] = useState("");
  const [fieldSiteContactName, setFieldSiteContactName] = useState("");
  const [fieldSiteContactPhone, setFieldSiteContactPhone] = useState("");
  const [fieldSiteConditionsAccessNotes, setFieldSiteConditionsAccessNotes] = useState("");
  const [sourceType, setSourceType] = useState<ServiceSourceType>("call");
  const [requestType, setRequestType] = useState<ServiceRequestType>("repair");
  const [priority, setPriority] = useState<ServicePriority>("normal");
  const [machineDown, setMachineDown] = useState(false);
  const [shopOrField, setShopOrField] = useState<"shop" | "field">("shop");
  const [haulRequired, setHaulRequired] = useState(false);
  const [selectedJobCodeId, setSelectedJobCodeId] = useState<string | null>(null);
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);

  // ── Search data ──
  const { data: customerResults = [], isFetching: searchingCustomers } =
    useCustomerSearch(customerQuery);
  const { data: fleetEquipment = [] } = useCustomerEquipment(selectedCustomer?.id ?? null);
  const { data: machineResults = [] } = useEquipmentSearch(machineQuery);

  // ── AI Diagnosis ──
  const diagnose = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("service-intake", {
        body: {
          customer_id: selectedCustomer?.id ?? undefined,
          machine_id: selectedMachine?.id === "new" ? undefined : selectedMachine?.id ?? undefined,
          machine_search: !selectedMachine && machineQuery ? machineQuery : undefined,
          customer_search: !selectedCustomer && customerQuery ? customerQuery : undefined,
          symptom,
          request_type: requestType,
        },
      });
      if (error) throw error;
      return normalizeIntakeResult(data);
    },
    onSuccess: (data) => {
      setIntakeResult(data);
      if (data.haul_required) setHaulRequired(true);
      if (data.suggested_job_codes.length > 0) {
        setSelectedJobCodeId(data.suggested_job_codes[0].id);
      }
    },
  });

  // Auto-trigger AI diagnosis when machine + meaningful symptom are set
  useEffect(() => {
    clearTimeout(diagnoseTimerRef.current);
    if (selectedMachine && symptom.trim().length >= 10) {
      setIntakeResult(null);
      diagnoseTimerRef.current = setTimeout(() => {
        diagnose.mutate();
      }, 1400);
    }
    return () => clearTimeout(diagnoseTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMachine?.id, symptom, requestType]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target as Node)) {
        setShowCustomerDrop(false);
      }
      if (machineDropdownRef.current && !machineDropdownRef.current.contains(e.target as Node)) {
        setShowMachineDrop(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Handlers ──
  const selectCustomer = (c: CustomerResult) => {
    setSelectedCustomer(c);
    setCustomerQuery("");
    setShowCustomerDrop(false);
    setSelectedMachine(null);
    setMachineQuery("");
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerQuery("");
    setSelectedMachine(null);
    setIntakeResult(null);
  };

  const selectMachine = (eq: EquipmentResult) => {
    setSelectedMachine(eq);
    setMachineQuery("");
    setShowMachineDrop(false);
    setIntakeResult(null);
    setHourMeter(eq.engine_hours != null ? String(eq.engine_hours) : "");
    setOdometerMiles(eq.mileage != null ? String(eq.mileage) : "");
  };

  const clearMachine = () => {
    setSelectedMachine(null);
    setMachineQuery("");
    setIntakeResult(null);
  };

  const addQuickSymptom = (s: string) => {
    setSymptom((prev) => (prev.trim() ? `${prev.trim()}. ${s}` : s));
    symptomRef.current?.focus();
  };

  const h2Validation = useMemo(() => validateH2IntakeDraft({
    machine: selectedMachine,
    machineId: selectedMachine?.id ?? null,
    sourceType,
    requestType,
    priority: machineDown ? "emergency" : priority,
    hourMeter,
    odometerMiles,
    promisedAt: promisedAtLocal,
    complaint: symptom,
    cause,
    correction,
    shopOrField,
    fieldSiteLocation,
    fieldSiteContactName,
    fieldSiteContactPhone,
    fieldSiteConditionsAccessNotes,
  }), [
    selectedMachine,
    sourceType,
    requestType,
    priority,
    machineDown,
    hourMeter,
    odometerMiles,
    promisedAtLocal,
    symptom,
    cause,
    correction,
    shopOrField,
    fieldSiteLocation,
    fieldSiteContactName,
    fieldSiteContactPhone,
    fieldSiteConditionsAccessNotes,
  ]);
  const isGrappleTruck = isH2GrappleTruck(selectedMachine);

  const handleCreateJob = useCallback(() => {
    const effectivePriority = machineDown ? "emergency" : priority;
    const statusFlags: string[] = [];
    if (machineDown) statusFlags.push("machine_down");
    statusFlags.push(shopOrField === "shop" ? "shop_job" : "field_job");

    createJob.mutate(
      {
        operation_id: operationId.current,
        customer_id: selectedCustomer?.id ?? null,
        machine_id: selectedMachine?.id === "new" ? null : selectedMachine?.id ?? null,
        new_machine: selectedMachine?.id === "new" ? { make: selectedMachine.make, model: selectedMachine.model, serial_number: selectedMachine.serial_number, year: selectedMachine.year } : undefined,
        source_type: sourceType,
        request_type: requestType,
        priority: effectivePriority,
        status_flags: statusFlags,
        hour_meter_reading: Number(hourMeter),
        odometer_miles: odometerMiles.trim() ? Number(odometerMiles) : null,
        promised_at: new Date(promisedAtLocal).toISOString(),
        complaint: symptom,
        cause,
        correction,
        customer_problem_summary: symptom,
        haul_required: haulRequired,
        shop_or_field: shopOrField,
        selected_job_code_id: selectedJobCodeId,
        field_site_location: shopOrField === "field" ? fieldSiteLocation : null,
        field_site_contact_name: shopOrField === "field" ? fieldSiteContactName : null,
        field_site_contact_phone: shopOrField === "field" ? fieldSiteContactPhone : null,
        field_site_conditions_access_notes: shopOrField === "field" ? fieldSiteConditionsAccessNotes : null,
        ai_diagnosis_summary: intakeResult
          ? `${intakeResult.suggested_next_step} (confidence: ${(intakeResult.confidence * 100).toFixed(0)}%)`
          : null,
      },
      {
        onSuccess: async (job) => {
          if (selectedJobCodeId) {
            try {
              await populatePartsFromJobCode(job.id);
            } catch {
              // Operator can use “Load from job code” on the command center if populate fails.
            }
          }
          navigate(`/service?job=${job.id}`);
        },
      },
    );
  }, [
    selectedCustomer,
    selectedMachine,
    sourceType,
    requestType,
    priority,
    machineDown,
    shopOrField,
    haulRequired,
    symptom,
    cause,
    correction,
    hourMeter,
    odometerMiles,
    promisedAtLocal,
    fieldSiteLocation,
    fieldSiteContactName,
    fieldSiteContactPhone,
    fieldSiteConditionsAccessNotes,
    selectedJobCodeId,
    intakeResult,
    createJob,
    navigate,
  ]);

  const canSubmit = h2Validation.ok && !createJob.isPending;
  const diagnosisRunning = diagnose.isPending;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen transition-all duration-500 ${machineDown ? "bg-red-950/10" : ""}`}>
      <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">New Service Request</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI-assisted intake — just search by name or serial number
            </p>
          </div>
          {machineDown && (
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-red-500/15 border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 uppercase tracking-wide">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              Machine Down
            </span>
          )}
        </div>

        {/* ══ SECTION 1: Customer ══════════════════════════════════════════════ */}
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            1 · Customer
          </p>

          {selectedCustomer ? (
            <SelectedCard
              icon={
                <span className="text-base font-semibold text-qep-orange-accessible">
                  {selectedCustomer.name[0].toUpperCase()}
                </span>
              }
              title={selectedCustomer.name}
              subtitle={[selectedCustomer.phone, selectedCustomer.city && `${selectedCustomer.city}, ${selectedCustomer.state}`].filter(Boolean).join("  ·  ") || undefined}
              onClear={clearCustomer}
            />
          ) : (
            <div className="relative" ref={customerDropdownRef}>
              <SearchInput
                value={customerQuery}
                onChange={(v) => { setCustomerQuery(v); setShowCustomerDrop(true); }}
                onFocus={() => setShowCustomerDrop(true)}
                placeholder="Search by company name or phone number..."
                autoFocus
              />

              {showCustomerDrop && customerQuery.trim().length >= 2 && (
                <DropdownList>
                  {searchingCustomers && (
                    <div className="px-4 py-3">
                      <SkeletonPulse />
                    </div>
                  )}
                  {!searchingCustomers && customerResults.length === 0 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground italic">
                      No customers found — job will be created without a customer link
                    </div>
                  )}
                  {customerResults.map((c) => (
                    <DropdownItem key={c.id} onClick={() => selectCustomer(c)}>
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-qep-orange-accessible shrink-0">
                        {c.name[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[c.phone, c.city && `${c.city}, ${c.state}`].filter(Boolean).join("  ·  ")}
                        </div>
                      </div>
                    </DropdownItem>
                  ))}
                </DropdownList>
              )}
            </div>
          )}
        </section>

        {/* ══ SECTION 2: Machine ═══════════════════════════════════════════════ */}
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            2 · Machine
          </p>

          {!selectedMachine && <div className="space-y-3">
            <button type="button" onClick={() => setRegisterMachine(!registerMachine)} className="rounded-lg border px-3 py-2 text-sm">{registerMachine ? "Use machine search" : "Register a first-seen machine"}</button>
            {registerMachine && <div className="rounded-lg border p-3 space-y-3">
              <p className="text-sm">The machine and work order will be saved together. Select the customer first.</p>
              {(["make", "model", "serial_number", "year"] as const).map(field => <label key={field} className="block text-sm">{field.replace(/_/g, " ")}
                <input aria-label={`New machine ${field}`} value={machineDraft[field]} type={field === "year" ? "number" : "text"} onChange={event => setMachineDraft(previous => ({ ...previous, [field]: event.target.value }))} className="block w-full rounded border px-3 py-2" />
              </label>)}
              <button type="button" disabled={!selectedCustomer || !Object.values(machineDraft).every(value => value.trim()) || Number(machineDraft.year)<1900 || Number(machineDraft.year)>2100}
                onClick={() => { selectMachine({ id: "new", ...machineDraft, year: Number(machineDraft.year), customer_id: selectedCustomer?.id ?? null }); setRegisterMachine(false); }} className="rounded-lg border px-3 py-2 disabled:opacity-50">Use these machine details</button>
            </div>}
          </div>}
          {selectedMachine ? (
            <SelectedCard
              icon={<span className="text-lg">🚜</span>}
              title={`${selectedMachine.make} ${selectedMachine.model}`}
              subtitle={`S/N: ${selectedMachine.serial_number}${selectedMachine.year ? `  ·  ${selectedMachine.year}` : ""}`}
              onClear={clearMachine}
            />
          ) : (
            <>
              {/* Fleet cards from selected customer */}
              {fleetEquipment.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {selectedCustomer?.name}'s fleet — tap to select
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {fleetEquipment.map((eq) => (
                      <button
                        key={eq.id}
                        onClick={() => selectMachine(eq)}
                        className="flex items-center gap-3 p-3 rounded-lg border hover:border-primary/50 hover:bg-primary/5 text-left transition group"
                      >
                        <span className="text-xl shrink-0">🚜</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">
                            {eq.make} {eq.model}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            SN: {eq.serial_number}
                            {eq.year ? `  ·  ${eq.year}` : ""}
                          </div>
                        </div>
                        <span className="text-qep-orange-accessible opacity-0 group-hover:opacity-100 text-xs transition shrink-0">
                          Select →
                        </span>
                      </button>
                    ))}
                  </div>
                  {fleetEquipment.length > 0 && (
                    <p className="text-xs text-center text-muted-foreground mt-3">
                      or search for a different machine
                    </p>
                  )}
                </div>
              )}

              {/* Machine search */}
              <div className="relative" ref={machineDropdownRef}>
                <SearchInput
                  value={machineQuery}
                  onChange={(v) => { setMachineQuery(v); setShowMachineDrop(true); }}
                  onFocus={() => setShowMachineDrop(true)}
                  placeholder="Search by serial number, make, or model..."
                />

                {showMachineDrop && machineQuery.trim().length >= 2 && (
                  <DropdownList>
                    {machineResults.length === 0 && (
                      <div className="px-4 py-3 text-sm text-muted-foreground italic">
                        No machines found — job can still be created
                      </div>
                    )}
                    {machineResults.map((eq) => (
                      <DropdownItem key={eq.id} onClick={() => selectMachine(eq)}>
                        <span className="text-xl shrink-0">🚜</span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {eq.make} {eq.model}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            SN: {eq.serial_number}
                            {eq.year ? `  ·  ${eq.year}` : ""}
                          </div>
                        </div>
                      </DropdownItem>
                    ))}
                  </DropdownList>
                )}
              </div>
            </>
          )}
        </section>

        {selectedMachine && <section className="rounded-xl border bg-card p-4 space-y-1" aria-label="Machine warranty eligibility">
          <h2 className="text-sm font-semibold">Warranty at intake</h2>
          <p className="text-sm">{selectedMachine.id === "new" ? "Not registered — verify coverage before marking this job as warranty." : selectedMachine.warranty_registered ? "Registration recorded" : "Registration not recorded — coverage requires verification"}</p>
          <p className="text-xs">Provider: {selectedMachine.warranty_provider ?? "Not recorded"} · Registration: {selectedMachine.warranty_registration_number ?? "Not recorded"}</p>
          <p className="text-xs">Coverage: {selectedMachine.warranty_start_date ?? "Unknown start"} to {selectedMachine.warranty_end_date ?? "Unknown end"}</p>
          {selectedMachine.warranty_end_date && selectedMachine.warranty_end_date < new Date().toISOString().slice(0,10) && <p className="text-sm text-destructive">Recorded coverage has expired.</p>}
          <p className="text-xs">{selectedMachine.warranty_coverage_terms ?? "No coverage terms recorded. Registration alone does not establish claim approval."}</p>
        </section>}

        {/* ══ SECTION 3: What's the issue? ═════════════════════════════════════ */}
        <section className="rounded-xl border bg-card p-5 space-y-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            3 · What's the issue?
          </p>

          <textarea
            ref={symptomRef}
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            rows={4}
            placeholder="Describe what's happening in plain language. The more detail, the better the AI can assist..."
            className="w-full rounded-lg border px-4 py-3 text-sm bg-background resize-none focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              Known / suspected cause
              <textarea
                value={cause}
                onChange={(e) => setCause(e.target.value)}
                rows={2}
                placeholder="What failed, what changed, or unknown if not diagnosed yet."
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm bg-background resize-none focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Requested / planned correction
              <textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                rows={2}
                placeholder="What the operator expects us to inspect, repair, replace, or verify."
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm bg-background resize-none focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition"
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            H2 requires the Three C’s as separate fields: complaint, cause, and correction.
          </p>

          {/* Quick symptom chips */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_SYMPTOMS.map((s) => (
              <button
                key={s}
                onClick={() => addQuickSymptom(s)}
                className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition"
              >
                + {s}
              </button>
            ))}
          </div>

          {/* Machine Down — prominent toggle, not a checkbox */}
          <button
            onClick={() => setMachineDown(!machineDown)}
            className={`w-full rounded-lg py-3.5 text-sm font-semibold transition-all duration-200 ${
              machineDown
                ? "bg-red-500/15 border-2 border-red-500/50 text-red-400 shadow-md shadow-red-950/20"
                : "border-2 border-dashed border-muted-foreground/25 text-muted-foreground hover:border-red-500/40 hover:text-red-400/80 hover:bg-red-500/5"
            }`}
          >
            {machineDown
              ? "🔴  MACHINE DOWN — Auto-set to Emergency Priority"
              : "Tap here if the machine is completely down"}
          </button>
        </section>

        {/* ══ SECTION 4: Job Details ════════════════════════════════════════════ */}
        <section className="rounded-xl border bg-card p-5 space-y-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            4 · Job Details
          </p>

          {/* Source — icon buttons */}
          <div>
            <label className="block text-xs text-muted-foreground mb-2">How did this come in?</label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(H2_SOURCE_TYPE_LABELS) as [ServiceSourceType, string][]).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => {
                    setSourceType(k);
                    if (k === "field_request") setShopOrField("field");
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    sourceType === k
                      ? "border-primary bg-primary/10 text-qep-orange-accessible"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  <span>{SOURCE_ICONS[k] ?? "📋"}</span>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Request type + Shop/Field */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="service-intake-request-type" className="block text-xs text-muted-foreground mb-2">Request type</label>
              <select id="service-intake-request-type"
                value={requestType}
                onChange={(e) => {
                  const next = e.target.value as ServiceRequestType;
                  setRequestType(next);
                  if (next === "field_service") setShopOrField("field");
                }}
                className="w-full rounded-lg border px-3 py-2.5 text-sm bg-background focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              >
                {Object.entries(H2_REQUEST_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Work location</label>
              <div className="flex rounded-lg border overflow-hidden h-[42px]">
                <button
                  onClick={() => {
                    setShopOrField("shop");
                    if (requestType === "field_service") setRequestType("repair");
                    if (sourceType === "field_request") setSourceType("call");
                  }}
                  className={`flex-1 text-sm font-medium transition ${
                    shopOrField === "shop"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  🏭 Shop
                </button>
                <button
                  onClick={() => setShopOrField("field")}
                  className={`flex-1 text-sm font-medium transition border-l ${
                    shopOrField === "field"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  🌾 Field
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-xs text-muted-foreground">
              Hour meter <span className="text-destructive">*</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={hourMeter}
                onChange={(e) => setHourMeter(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm bg-background focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                placeholder="e.g. 1420.5"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Miles {isGrappleTruck ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(if applicable)</span>}
              <input
                type="number"
                min="0"
                step="0.1"
                value={odometerMiles}
                onChange={(e) => setOdometerMiles(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm bg-background focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                placeholder="Required for grapple trucks"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Promised date <span className="text-destructive">*</span>
              <input
                type="datetime-local"
                value={promisedAtLocal}
                onChange={(e) => setPromisedAtLocal(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm bg-background focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              />
            </label>
          </div>

          {shopOrField === "field" && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
              <p className="text-xs font-medium">Field service site gate</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={fieldSiteLocation} onChange={(e) => setFieldSiteLocation(e.target.value)} placeholder="Site location / address" className="rounded-lg border bg-background px-3 py-2 text-sm" />
                <input value={fieldSiteContactName} onChange={(e) => setFieldSiteContactName(e.target.value)} placeholder="Site contact name" className="rounded-lg border bg-background px-3 py-2 text-sm" />
                <input value={fieldSiteContactPhone} onChange={(e) => setFieldSiteContactPhone(e.target.value)} placeholder="Site contact phone" className="rounded-lg border bg-background px-3 py-2 text-sm" />
                <input value={fieldSiteConditionsAccessNotes} onChange={(e) => setFieldSiteConditionsAccessNotes(e.target.value)} placeholder="Site conditions / access notes" className="rounded-lg border bg-background px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          {/* Priority + Haul */}
          <div className="flex items-end gap-4 flex-wrap">
            {!machineDown && (
              <div className="flex-1 min-w-28">
                <label htmlFor="service-intake-priority" className="block text-xs text-muted-foreground mb-2">Priority</label>
                <select id="service-intake-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as ServicePriority)}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm bg-background focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                >
                  {Object.entries(H2_PRIORITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            )}
            {machineDown && (
              <div className="flex-1 min-w-28">
                <label className="block text-xs text-muted-foreground mb-2">Priority</label>
                <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-400">
                  Emergency (auto)
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer select-none pb-2.5">
              <button
                role="checkbox"
                aria-checked={haulRequired}
                onClick={() => setHaulRequired(!haulRequired)}
                className={`h-5 w-5 rounded border-2 flex items-center justify-center transition shrink-0 ${
                  haulRequired
                    ? "bg-primary border-primary"
                    : "border-input hover:border-primary/50"
                }`}
              >
                {haulRequired && (
                  <svg className="h-3 w-3 text-primary-foreground" fill="currentColor" viewBox="0 0 12 12">
                    <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                )}
              </button>
              <span className="text-sm">Haul required</span>
            </label>
          </div>
        </section>

        {/* ══ AI Diagnosis ══════════════════════════════════════════════════════ */}
        {(diagnosisRunning || intakeResult || diagnose.isError) && (
          <section className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                AI Diagnosis
              </p>
              {diagnosisRunning ? (
                <span className="text-xs text-qep-orange-accessible animate-pulse">Analyzing…</span>
              ) : intakeResult ? (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    intakeResult.confidence >= 0.7
                      ? "bg-green-500/15 text-green-400"
                      : intakeResult.confidence >= 0.4
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {(intakeResult.confidence * 100).toFixed(0)}% confidence
                </span>
              ) : null}
            </div>

            {diagnosisRunning && <SkeletonPulse />}

            {diagnose.isError && !diagnosisRunning && (
              <p className="text-sm text-destructive">
                Diagnosis failed: {(diagnose.error as Error)?.message ?? "Unknown error"}
              </p>
            )}

            {intakeResult && !diagnosisRunning && (
              <>
                {intakeResult.suggested_next_step && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {intakeResult.suggested_next_step}
                  </p>
                )}

                {intakeResult.estimated_hours != null && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-sm">
                    <span className="text-muted-foreground">Estimated labor:</span>
                    <span className="font-semibold">{intakeResult.estimated_hours} hrs</span>
                  </div>
                )}

                {intakeResult.haul_required && !haulRequired && (
                  <button
                    onClick={() => setHaulRequired(true)}
                    className="flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 transition"
                  >
                    <span>⚠️</span> AI suggests haul may be required — tap to enable
                  </button>
                )}

                {intakeResult.suggested_job_codes.length > 0 ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 font-medium">
                      Suggested job codes — select one:
                    </p>
                    <div className="space-y-2">
                      {intakeResult.suggested_job_codes.map((jc) => (
                        <button
                          key={jc.id}
                          onClick={() => setSelectedJobCodeId(jc.id)}
                          className={`flex items-center gap-3 w-full p-3 rounded-lg border text-left transition ${
                            selectedJobCodeId === jc.id
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/30 border-border"
                          }`}
                        >
                          <div
                            className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition ${
                              selectedJobCodeId === jc.id
                                ? "border-primary bg-primary"
                                : "border-input"
                            }`}
                          >
                            {selectedJobCodeId === jc.id && (
                              <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{jc.job_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {jc.make} {jc.model_family ?? ""} · Est:{" "}
                              {jc.shop_average_hours ?? jc.manufacturer_estimated_hours ?? "?"} hrs
                            </div>
                          </div>
                          {jc.confidence_score != null && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {(jc.confidence_score * 100).toFixed(0)}%
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No matching job codes found — manual diagnosis required.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {/* Manual trigger if auto didn't fire */}
        {!diagnosisRunning && !intakeResult && symptom.trim().length > 5 && !selectedMachine && (
          <button
            onClick={() => diagnose.mutate()}
            className="w-full rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-qep-orange-accessible hover:bg-primary/10 transition"
          >
            ✨ Run AI Diagnosis
          </button>
        )}

        {/* ══ Create Job CTA ════════════════════════════════════════════════════ */}
        <div className="pb-8">
          {/* Summary chip row */}
          {(selectedCustomer || selectedMachine) && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {selectedCustomer && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-1 text-xs">
                  👤 {selectedCustomer.name}
                </span>
              )}
              {selectedMachine && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-1 text-xs">
                  🚜 {selectedMachine.make} {selectedMachine.model}
                </span>
              )}
              {machineDown && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-400 px-2.5 py-1 text-xs font-medium">
                  🔴 Machine Down
                </span>
              )}
              {haulRequired && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-400 px-2.5 py-1 text-xs">
                  🚛 Haul
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-1 text-xs capitalize">
                {shopOrField === "shop" ? "🏭" : "🌾"} {shopOrField}
              </span>
            </div>
          )}

          <button
            onClick={handleCreateJob}
            disabled={!canSubmit}
            className={`w-full rounded-xl px-4 py-4 text-base font-semibold transition-all duration-200 shadow-lg ${
              canSubmit
                ? "bg-green-700 text-white hover:bg-green-800 shadow-green-900/30"
                : "bg-muted/40 text-muted-foreground cursor-not-allowed shadow-none"
            }`}
          >
            {createJob.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Creating Job…
              </span>
            ) : (
              "Create Service Job →"
            )}
          </button>

          {!h2Validation.ok && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-100">
              <p className="font-semibold">Complete H2 intake before creating the work order.</p>
              {h2Validation.missing.length > 0 && <p className="mt-1">Missing: {h2Validation.missing.join(", ")}</p>}
              {h2Validation.invalid.length > 0 && <p className="mt-1">Invalid: {h2Validation.invalid.join(", ")}</p>}
            </div>
          )}

          {createJob.isError && (
            <div className="mt-3 rounded-lg bg-destructive/10 text-destructive px-4 py-3 text-sm">
              Failed to create: {(createJob.error as Error)?.message ?? "Unknown error"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
