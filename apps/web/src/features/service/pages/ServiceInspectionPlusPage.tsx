import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardCheck, History, ListChecks, Plus, ShieldCheck, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { useServiceJobList } from "../hooks/useServiceJobs";
import {
  INSPECTIONPLUS_TEMPLATES,
  buildInspectionFindingDrafts,
  makeInspectionNumber,
  normalizeInspectionRows,
  templateByKey,
  type InspectionRow,
  type InspectionStatus,
  type InspectionTemplateDefinition,
} from "../lib/inspectionplus-utils";

const STATUS_STYLES: Record<InspectionStatus, string> = {
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-300",
};

type TabKey = "active" | "history" | "mine";
const TAB_KEYS: TabKey[] = ["active", "history", "mine"];

function displayWhen(value: string | null): string {
  if (!value) return "Not started";
  return new Date(value).toLocaleString();
}

export function ServiceInspectionPlusPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("active");
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("general_condition");
  const [title, setTitle] = useState("");
  const [stockNumber, setStockNumber] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [approverName, setApproverName] = useState("");
  const [serviceJobId, setServiceJobId] = useState("");

  const template = templateByKey(selectedTemplateKey) ?? INSPECTIONPLUS_TEMPLATES[0]!;

  const { data: jobsData } = useServiceJobList({
    per_page: 100,
    include_closed: true,
  });
  const jobs = jobsData?.jobs ?? [];

  const inspectionsQuery = useQuery({
    queryKey: ["service-inspections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_inspections")
        .select("id, inspection_number, title, template_name, inspection_type, status, stock_number, reference_number, customer_name, machine_summary, service_job_id, assignee_name, approver_name, created_by, started_at, completed_at, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return normalizeInspectionRows(data);
    },
  });

  const filteredInspections = useMemo(() => {
    const rows = inspectionsQuery.data ?? [];
    switch (tab) {
      case "active":
        return rows.filter((row) => row.status === "draft" || row.status === "in_progress");
      case "history":
        return rows.filter((row) => row.status === "completed" || row.status === "cancelled");
      case "mine":
        return rows.filter((row) => row.created_by === profile?.id);
      default:
        return rows;
    }
  }, [inspectionsQuery.data, profile?.id, tab]);

  const createInspection = useMutation({
    mutationFn: async () => {
      const linkedJob = jobs.find((job) => job.id === serviceJobId);
      const draftTitle = title.trim() || `${template.name} ${new Date().toLocaleDateString()}`;
      const inspectionNumber = makeInspectionNumber();
      const drafts = buildInspectionFindingDrafts(template);

      const header = {
        inspection_number: inspectionNumber,
        title: draftTitle,
        template_key: template.key,
        template_name: template.name,
        inspection_type: template.inspectionType,
        status: "draft",
        stock_number: stockNumber.trim() || null,
        reference_number: referenceNumber.trim() || null,
        customer_name: linkedJob?.customer?.name ?? null,
        machine_summary: linkedJob?.machine
          ? `${linkedJob.machine.make} ${linkedJob.machine.model} · ${linkedJob.machine.serial_number}`
          : null,
        service_job_id: linkedJob?.id ?? null,
        customer_id: linkedJob?.customer?.id ?? null,
        machine_id: linkedJob?.machine?.id ?? null,
        assignee_name: assigneeName.trim() || null,
        approver_name: approverName.trim() || null,
        created_by: profile?.id ?? null,
      };

      const headerResult = await supabase
        .from("service_inspections")
        .insert(header)
        .select("id")
        .single();

      if (headerResult.error || !headerResult.data) {
        throw headerResult.error ?? new Error("Failed to create inspection");
      }

      const findingsResult = await supabase
        .from("service_inspection_findings")
        .insert(
          drafts.map((draft) => ({
            ...draft,
            inspection_id: headerResult.data!.id,
          })),
        );

      if (findingsResult.error) throw findingsResult.error;
      return headerResult.data.id;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["service-inspections"] });
      setTitle("");
      setStockNumber("");
      setReferenceNumber("");
      setAssigneeName("");
      setApproverName("");
      setServiceJobId("");
    },
  });

  const templateIcon = (templateDef: InspectionTemplateDefinition) => {
    switch (templateDef.key) {
      case "rental_return":
        return <History className="h-4 w-4" />;
      case "job_site_safety":
        return <ShieldCheck className="h-4 w-4" />;
      case "equipment_demo":
        return <Wrench className="h-4 w-4" />;
      default:
        return <ClipboardCheck className="h-4 w-4" />;
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6 lg:px-8">
      <ServiceSubNav />

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Phase 4 · InspectionPlus
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                Service inspections
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Dedicated inspection forms with active/history states, assignee routing, optional approval,
                and service-work-order linking. This closes the InspectionPlus schema gap without overloading
                demos, PDI, or rental-return checklists.
              </p>
            </div>
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <ListChecks className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {INSPECTIONPLUS_TEMPLATES.map((templateDef) => (
              <button
                key={templateDef.key}
                type="button"
                onClick={() => setSelectedTemplateKey(templateDef.key)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedTemplateKey === templateDef.key
                    ? "border-primary/30 bg-primary/[0.08] shadow-sm"
                    : "border-border/50 bg-background/70 hover:border-primary/20"
                }`}
              >
                <div className="flex items-center gap-2 text-primary">
                  {templateIcon(templateDef)}
                  <span className="text-sm font-semibold text-foreground">{templateDef.name}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {templateDef.description}
                </p>
                <p className="mt-3 text-[11px] font-medium text-muted-foreground">
                  {templateDef.findings.length} checklist points
                </p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Start inspection
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">{template.name}</h2>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {template.findings.length} findings
            </span>
          </div>

          <div className="mt-4 grid gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Inspection title"
              className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={stockNumber}
                onChange={(e) => setStockNumber(e.target.value)}
                placeholder="Stock number"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Reference number / W/O #"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={assigneeName}
                onChange={(e) => setAssigneeName(e.target.value)}
                placeholder="Assignee"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
              <input
                value={approverName}
                onChange={(e) => setApproverName(e.target.value)}
                placeholder="Approver (optional)"
                className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </div>
            <select
              value={serviceJobId}
              onChange={(e) => setServiceJobId(e.target.value)}
              className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="">Optional linked service job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.customer?.name ?? "Customer"} · {job.current_stage} · {job.machine?.serial_number ?? job.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <Button
              onClick={() => createInspection.mutate()}
              disabled={createInspection.isPending}
              className="rounded-xl"
            >
              <Plus className="mr-2 h-4 w-4" />
              {createInspection.isPending ? "Creating inspection…" : "Create inspection"}
            </Button>
            {createInspection.isError ? (
              <p className="text-sm text-destructive">
                {(createInspection.error as Error).message}
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="border border-border/50 bg-card/90 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Inspection queue
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Active, history, and my forms</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {TAB_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  tab === key
                    ? "bg-foreground text-background"
                    : "border border-border/60 bg-background/70 text-muted-foreground"
                }`}
              >
                {key === "active" ? "Active" : key === "history" ? "History" : "My inspections"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {inspectionsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading inspections…</p>
          ) : filteredInspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inspections in this lane yet.</p>
          ) : (
            filteredInspections.map((inspection) => (
              <Link
                key={inspection.id}
                to={`/service/inspections/${inspection.id}`}
                className="block rounded-2xl border border-border/60 bg-background/60 p-4 transition hover:border-primary/25 hover:bg-background"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{inspection.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[inspection.status]}`}>
                        {inspection.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {inspection.inspection_number} · {inspection.template_name ?? inspection.inspection_type}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {inspection.customer_name ?? "No customer"} · {inspection.machine_summary ?? "No machine linked"}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{displayWhen(inspection.started_at)}</p>
                    <p className="mt-1">
                      {inspection.assignee_name ? `Assignee: ${inspection.assignee_name}` : "Unassigned"}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
