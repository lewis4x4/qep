import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";

interface NeedsAssessmentCardProps {
  dealId: string;
}

interface NeedsAssessment {
  id: string;
  application: string | null;
  work_type: string | null;
  terrain_material: string | null;
  current_equipment: string | null;
  current_equipment_issues: string | null;
  machine_interest: string | null;
  attachments_needed: string[] | null;
  brand_preference: string | null;
  timeline_description: string | null;
  timeline_urgency: string | null;
  budget_type: string | null;
  budget_amount: number | null;
  monthly_payment_target: number | null;
  financing_preference: string | null;
  has_trade_in: boolean;
  trade_in_details: string | null;
  is_decision_maker: boolean | null;
  decision_maker_name: string | null;
  next_step: string | null;
  entry_method: string;
  qrm_narrative: string | null;
  completeness_pct: number | null;
  fields_populated: number;
  fields_total: number;
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

export function NeedsAssessmentCard({ dealId }: NeedsAssessmentCardProps) {
  const { data: assessment, isLoading } = useQuery({
    queryKey: ["crm", "needs-assessment", dealId],
    queryFn: async () => {
      // Table added in migration 068 — not yet in generated types
      const { data, error } = await (supabase as any)
        .from("needs_assessments")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as NeedsAssessment | null;
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Card className="animate-pulse p-4">
        <div className="h-4 w-32 rounded bg-muted" />
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
