import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import type { NeedsAssessment } from "../lib/deal-composite-types";

export type { NeedsAssessment } from "../lib/deal-composite-types";

interface NeedsAssessmentCardProps {
  dealId: string;
  /** When provided (including `null`), skips fetching — used with get_deal_composite. */
  prefetched?: NeedsAssessment | null;
}

function AssessmentField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function formatMoney(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeNeedsAssessment(value: unknown): NeedsAssessment | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    application: stringOrNull(value.application),
    work_type: stringOrNull(value.work_type),
    terrain_material: stringOrNull(value.terrain_material),
    current_equipment: stringOrNull(value.current_equipment),
    current_equipment_issues: stringOrNull(value.current_equipment_issues),
    machine_interest: stringOrNull(value.machine_interest),
    attachments_needed: stringArrayOrNull(value.attachments_needed),
    brand_preference: stringOrNull(value.brand_preference),
    timeline_description: stringOrNull(value.timeline_description),
    timeline_urgency: stringOrNull(value.timeline_urgency),
    budget_type: stringOrNull(value.budget_type),
    budget_amount: numberOrNull(value.budget_amount),
    monthly_payment_target: numberOrNull(value.monthly_payment_target),
    financing_preference: stringOrNull(value.financing_preference),
    has_trade_in: value.has_trade_in === true,
    trade_in_details: stringOrNull(value.trade_in_details),
    is_decision_maker: typeof value.is_decision_maker === "boolean" ? value.is_decision_maker : null,
    decision_maker_name: stringOrNull(value.decision_maker_name),
    next_step: stringOrNull(value.next_step),
    entry_method: typeof value.entry_method === "string" ? value.entry_method : "manual",
    qrm_narrative: stringOrNull(value.qrm_narrative),
    completeness_pct: numberOrNull(value.completeness_pct),
    fields_populated: numberOrNull(value.fields_populated) ?? 0,
    fields_total: numberOrNull(value.fields_total) ?? 0,
  };
}

export function NeedsAssessmentCard({ dealId, prefetched }: NeedsAssessmentCardProps) {
  const { data: assessment, isLoading, isError } = useQuery({
    queryKey: ["crm", "needs-assessment", dealId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("needs_assessments")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return normalizeNeedsAssessment(data);
    },
    staleTime: prefetched !== undefined ? Infinity : 30_000,
    enabled: Boolean(dealId),
    initialData: prefetched !== undefined ? prefetched ?? undefined : undefined,
  });

  if (isLoading) {
    return (
      <Card className="animate-pulse p-4">
        <div className="h-4 w-32 rounded bg-muted" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-red-500/20 p-4">
        <p className="text-sm text-red-400">Unable to load needs assessment.</p>
      </Card>
    );
  }

  if (!assessment) {
    return (
      <Card className="border-dashed p-4">
        <p className="text-sm text-muted-foreground">No needs assessment recorded. Use voice capture to auto-fill.</p>
      </Card>
    );
  }

  const completeness = assessment.completeness_pct ?? 0;
  const completenessColor =
    completeness >= 80 ? "text-emerald-400" :
    completeness >= 50 ? "text-amber-400" :
    "text-red-400";

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Needs Assessment</h3>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${completenessColor}`}>
            {completeness.toFixed(0)}% complete
          </span>
          <span className="text-[10px] text-muted-foreground">
            ({assessment.fields_populated}/{assessment.fields_total})
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {assessment.entry_method}
          </span>
        </div>
      </div>

      {/* Completeness bar */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            completeness >= 80 ? "bg-emerald-500" :
            completeness >= 50 ? "bg-amber-500" :
            "bg-red-500"
          }`}
          style={{ width: `${completeness}%` }}
        />
      </div>

      {/* QRM Narrative */}
      {assessment.qrm_narrative && (
        <div className="mt-3 rounded-lg bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">QRM Narrative</p>
          <p className="mt-1 text-sm italic text-foreground">{assessment.qrm_narrative}</p>
        </div>
      )}

      {/* Assessment fields */}
      <div className="mt-3 divide-y divide-border">
        <AssessmentField label="Application" value={assessment.application} />
        <AssessmentField label="Machine Interest" value={assessment.machine_interest} />
        <AssessmentField label="Brand Preference" value={assessment.brand_preference} />
        <AssessmentField label="Current Equipment" value={assessment.current_equipment} />
        <AssessmentField label="Issues" value={assessment.current_equipment_issues} />
        {assessment.attachments_needed && assessment.attachments_needed.length > 0 && (
          <AssessmentField label="Attachments" value={assessment.attachments_needed.join(", ")} />
        )}
        <AssessmentField label="Timeline" value={assessment.timeline_description} />
        <AssessmentField label="Urgency" value={assessment.timeline_urgency} />
        <AssessmentField label="Budget Type" value={assessment.budget_type} />
        <AssessmentField label="Budget" value={formatMoney(assessment.budget_amount)} />
        <AssessmentField label="Monthly Target" value={formatMoney(assessment.monthly_payment_target)} />
        <AssessmentField label="Financing" value={assessment.financing_preference} />
        <AssessmentField
          label="Trade-In"
          value={assessment.has_trade_in ? (assessment.trade_in_details || "Yes") : null}
        />
        <AssessmentField
          label="Decision Maker"
          value={
            assessment.is_decision_maker === true
              ? `Yes${assessment.decision_maker_name ? ` (${assessment.decision_maker_name})` : ""}`
              : assessment.is_decision_maker === false
                ? `No${assessment.decision_maker_name ? ` — ${assessment.decision_maker_name}` : ""}`
                : null
          }
        />
        <AssessmentField label="Next Step" value={assessment.next_step?.replace(/_/g, " ")} />
      </div>
    </Card>
  );
}
