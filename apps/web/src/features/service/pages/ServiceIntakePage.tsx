import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useCreateServiceJob } from "../hooks/useServiceJobMutation";
import {
  SOURCE_TYPE_LABELS,
  REQUEST_TYPE_LABELS,
  PRIORITY_LABELS,
} from "../lib/constants";
import type { ServiceSourceType, ServiceRequestType, ServicePriority } from "../lib/types";

interface IntakeResult {
  machine: Record<string, unknown> | null;
  service_history: unknown[];
  suggested_job_codes: Array<{
    id: string;
    job_name: string;
    make: string;
    model_family: string | null;
    manufacturer_estimated_hours: number | null;
    shop_average_hours: number | null;
    parts_template: unknown[];
    confidence_score: number | null;
  }>;
  likely_parts: unknown[];
  estimated_hours: number | null;
  haul_required: boolean;
  confidence: number;
  suggested_next_step: string;
}

export function ServiceIntakePage() {
  const navigate = useNavigate();
  const createJob = useCreateServiceJob();

  const [customerId, setCustomerId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [machineSearch, setMachineSearch] = useState("");
  const [symptom, setSymptom] = useState("");
  const [sourceType, setSourceType] = useState<ServiceSourceType>("call");
  const [requestType, setRequestType] = useState<ServiceRequestType>("repair");
  const [priority, setPriority] = useState<ServicePriority>("normal");
  const [machineDown, setMachineDown] = useState(false);
  const [shopOrField, setShopOrField] = useState<"shop" | "field">("shop");
  const [haulRequired, setHaulRequired] = useState(false);
  const [selectedJobCodeId, setSelectedJobCodeId] = useState<string | null>(null);

  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);

  const diagnose = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("service-intake", {
        body: {
          customer_id: customerId || undefined,
          machine_id: machineId || undefined,
          customer_search: customerSearch || undefined,
          machine_search: machineSearch || undefined,
          symptom,
          request_type: requestType,
        },
      });
      if (error) throw error;
      return data as IntakeResult;
    },
    onSuccess: (data) => {
      setIntakeResult(data);
      if (data.haul_required) setHaulRequired(true);
      if (data.machine?.id) setMachineId(data.machine.id as string);
      if (data.suggested_job_codes.length > 0) {
        setSelectedJobCodeId(data.suggested_job_codes[0].id);
      }
    },
  });

  const handleCreateJob = useCallback(() => {
    const effectivePriority = machineDown ? "critical" : priority;
    const statusFlags: string[] = [];
    if (machineDown) statusFlags.push("machine_down");
    statusFlags.push(shopOrField === "shop" ? "shop_job" : "field_job");

    createJob.mutate(
      {
        customer_id: customerId || null,
        machine_id: machineId || null,
        source_type: sourceType,
        request_type: requestType,
        priority: effectivePriority,
        status_flags: statusFlags,
        customer_problem_summary: symptom,
        haul_required: haulRequired,
        shop_or_field: shopOrField,
        selected_job_code_id: selectedJobCodeId,
        ai_diagnosis_summary: intakeResult
          ? `${intakeResult.suggested_next_step} (confidence: ${(intakeResult.confidence * 100).toFixed(0)}%)`
          : null,
      },
      { onSuccess: (job) => navigate(`/service?highlight=${job.id}`) },
    );
  }, [
    customerId, machineId, sourceType, requestType, priority, machineDown,
    shopOrField, haulRequired, symptom, selectedJobCodeId, intakeResult,
    createJob, navigate,
  ]);

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Service Request</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enter machine and symptom info for AI-assisted diagnosis
        </p>
      </div>

      {/* Customer / Machine Lookup */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Customer &amp; Machine</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Customer ID</label>
            <input
              type="text"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="UUID or search below"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            />
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Search by company name..."
              className="w-full rounded-md border px-3 py-2 text-sm bg-background mt-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Machine ID</label>
            <input
              type="text"
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              placeholder="UUID or search below"
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            />
            <input
              type="text"
              value={machineSearch}
              onChange={(e) => setMachineSearch(e.target.value)}
              placeholder="Search by serial, make, model..."
              className="w-full rounded-md border px-3 py-2 text-sm bg-background mt-2"
            />
          </div>
        </div>
      </section>

      {/* Symptom / Request Details */}
      <section className="rounded-lg border bg-card p-4 space-y-4">
        <h2 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Request Details</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Symptom / Problem Description</label>
          <textarea
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            rows={3}
            placeholder="Describe the issue..."
            className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Source</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as ServiceSourceType)}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as ServiceRequestType)}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as ServicePriority)}
              disabled={machineDown}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background disabled:opacity-50"
            >
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Shop / Field</label>
            <select
              value={shopOrField}
              onChange={(e) => setShopOrField(e.target.value as "shop" | "field")}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
            >
              <option value="shop">Shop</option>
              <option value="field">Field</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={machineDown}
              onChange={(e) => setMachineDown(e.target.checked)}
              className="rounded border"
            />
            <span className="font-medium text-red-600">Machine Down</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={haulRequired}
              onChange={(e) => setHaulRequired(e.target.checked)}
              className="rounded border"
            />
            Haul Required
          </label>
        </div>
      </section>

      {/* AI Diagnose Button */}
      <button
        onClick={() => diagnose.mutate()}
        disabled={diagnose.isPending}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
      >
        {diagnose.isPending ? "Analyzing..." : "Run AI Diagnosis"}
      </button>

      {diagnose.isError && (
        <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
          Diagnosis failed: {(diagnose.error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* AI Results */}
      {intakeResult && (
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">AI Diagnosis Results</h2>

          {intakeResult.machine && (
            <div className="text-sm">
              <span className="font-medium">Machine:</span>{" "}
              {String(intakeResult.machine.make)} {String(intakeResult.machine.model)}{" "}
              (S/N: {String(intakeResult.machine.serial_number)})
            </div>
          )}

          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Confidence:</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              intakeResult.confidence >= 0.7
                ? "bg-green-100 text-green-700"
                : intakeResult.confidence >= 0.4
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-100 text-red-700"
            }`}>
              {(intakeResult.confidence * 100).toFixed(0)}%
            </span>
          </div>

          {intakeResult.suggested_job_codes.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium mb-2">Suggested Job Codes</h3>
              <div className="space-y-2">
                {intakeResult.suggested_job_codes.map((jc) => (
                  <label
                    key={jc.id}
                    className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition ${
                      selectedJobCodeId === jc.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="job_code"
                      checked={selectedJobCodeId === jc.id}
                      onChange={() => setSelectedJobCodeId(jc.id)}
                      className="accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{jc.job_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {jc.make} {jc.model_family ?? ""} &middot;{" "}
                        Est: {jc.shop_average_hours ?? jc.manufacturer_estimated_hours ?? "?"} hrs
                      </div>
                    </div>
                    {jc.confidence_score != null && (
                      <span className="text-xs text-muted-foreground">
                        {(jc.confidence_score * 100).toFixed(0)}%
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No matching job codes found. Manual diagnosis required.
            </p>
          )}

          {intakeResult.estimated_hours != null && (
            <div className="text-sm">
              <span className="font-medium">Estimated Hours:</span> {intakeResult.estimated_hours}
            </div>
          )}

          <div className="text-sm">
            <span className="font-medium">Next Step:</span> {intakeResult.suggested_next_step}
          </div>
        </section>
      )}

      {/* Create Job Button */}
      <button
        onClick={handleCreateJob}
        disabled={createJob.isPending || !symptom.trim()}
        className="w-full rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition"
      >
        {createJob.isPending ? "Creating..." : "Create Service Job"}
      </button>

      {createJob.isError && (
        <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
          Failed to create: {(createJob.error as Error)?.message ?? "Unknown error"}
        </div>
      )}
    </div>
  );
}
