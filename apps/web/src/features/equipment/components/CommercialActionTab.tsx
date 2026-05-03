import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, FileText, Wrench, Package, Shield, DollarSign, Phone, Mail, Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Asset360Response } from "../lib/asset-360-api";
import { KbMatchPanel } from "./KbMatchPanel";
import { hasNonNullRecordValue } from "../lib/equipment-row-normalizers";

interface CommercialActionTabProps {
  data: Asset360Response;
}

const DRAFT_EMAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/draft-email`;

type Scenario = "trade_up" | "requote" | "budget_cycle" | "custom";

/**
 * Asset 360 Commercial Action tab (v2 §1 note 9).
 *
 * Recommended next outreach, open quotes, trade-up score + reason,
 * budget cycle, last rep touch, downtime risk; one-click drafts route
 * through the existing draft-email edge function.
 *
 * Playbooks pattern (v2 §1 note 14): every risk surface offers an inline
 * action button.
 */
export function CommercialActionTab({ data }: CommercialActionTabProps) {
  const { equipment, company, badges, open_deal } = data;

  const draftMutation = useMutation({
    mutationFn: async (scenario: Scenario) => {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${DRAFT_EMAIL_URL}/draft`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenario,
          deal_id: open_deal?.id,
          contact_id: equipment.primary_contact_id,
          company_id: equipment.company_id,
          equipment_id: equipment.id,
          context: {
            equipment_name: equipment.name,
            make: equipment.make,
            model: equipment.model,
            year: equipment.year,
            engine_hours: equipment.engine_hours,
            trade_up_score: badges.trade_up_score,
            lifetime_parts_spend: badges.lifetime_parts_spend,
            company_name: company?.name ?? null,
          },
          tone: "consultative",
          persist: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Draft failed" }));
        throw new Error((err as { error?: string }).error ?? "Draft failed");
      }
      return res.json();
    },
  });

  const tradeUpReason = computeTradeUpReason(badges, equipment.engine_hours);
  const recommendedAction = computeRecommendedAction(badges, open_deal);

  return (
    <div className="space-y-4">
      {/* Recommended next outreach */}
      <Card className="border-qep-orange/30 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-qep-orange/10 p-2">
            <TrendingUp className="h-4 w-4 text-qep-orange" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Recommended next outreach
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {recommendedAction.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{recommendedAction.detail}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => draftMutation.mutate("trade_up")}
                disabled={draftMutation.isPending}
              >
                {draftMutation.isPending && draftMutation.variables === "trade_up" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <TrendingUp className="mr-1 h-3 w-3" />
                )}
                Draft trade-up email
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => draftMutation.mutate("requote")}
                disabled={draftMutation.isPending}
              >
                <FileText className="mr-1 h-3 w-3" /> Draft requote
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => draftMutation.mutate("budget_cycle")}
                disabled={draftMutation.isPending}
              >
                <DollarSign className="mr-1 h-3 w-3" /> Budget-cycle draft
              </Button>
            </div>
            {draftMutation.isSuccess && (
              <p className="mt-2 text-[11px] text-emerald-400">
                ✓ Draft created — review in Email Drafts inbox
              </p>
            )}
            {draftMutation.isError && (
              <p className="mt-2 text-[11px] text-red-400">
                {(draftMutation.error as Error)?.message ?? "Draft failed"}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Trade-up score breakdown — AI confidence indicator (v2 §1 note 14) */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-qep-orange" aria-hidden />
          <h3 className="text-sm font-bold text-foreground">Trade-up score</h3>
          <span className="ml-auto text-xs text-muted-foreground">AI confidence: heuristic</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className={`text-3xl font-bold tabular-nums ${
            badges.trade_up_score >= 70 ? "text-emerald-400" :
            badges.trade_up_score >= 40 ? "text-amber-400" :
            "text-muted-foreground"
          }`}>
            {badges.trade_up_score}
          </span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {tradeUpReason.map((r, i) => <li key={i}>• {r}</li>)}
        </ul>
      </Card>

      {/* Open quote */}
      {open_deal && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-blue-400" aria-hidden />
            <h3 className="text-sm font-bold text-foreground">Open deal</h3>
          </div>
          <p className="text-sm text-foreground">{open_deal.name}</p>
          {open_deal.amount && (
            <p className="text-xs text-muted-foreground">
              ${open_deal.amount.toLocaleString()}
              {open_deal.next_follow_up_at && ` · next follow-up ${new Date(open_deal.next_follow_up_at).toLocaleDateString()}`}
            </p>
          )}
        </Card>
      )}

      {/* Risk strip — playbooks pattern: each risk has an inline action */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {badges.overdue_intervals > 0 && (
          <RiskCard
            tone="red"
            icon={<Wrench className="h-3.5 w-3.5" />}
            title={`${badges.overdue_intervals} overdue PM`}
            detail="Service intervals past due hours. Customer may be running on borrowed time."
            actionLabel="Service follow-up draft"
            onAction={() => draftMutation.mutate("custom")}
          />
        )}
        {badges.lifetime_parts_spend > 5000 && (
          <RiskCard
            tone="violet"
            icon={<Package className="h-3.5 w-3.5" />}
            title={`$${badges.lifetime_parts_spend.toLocaleString()} parts spend`}
            detail="Parts reorder cadence — likely candidate for parts kit auto-ship."
            actionLabel="Parts reorder reminder"
            onAction={() => draftMutation.mutate("custom")}
          />
        )}
        {hasNonNullRecordValue(equipment.metadata, "warranty_expires_at") && (
          <RiskCard
            tone="orange"
            icon={<Shield className="h-3.5 w-3.5" />}
            title="Warranty window"
            detail="Surface warranty registration / extension to the customer."
            actionLabel="Warranty draft"
            onAction={() => draftMutation.mutate("custom")}
          />
        )}
        <RiskCard
          tone="blue"
          icon={<Phone className="h-3.5 w-3.5" />}
          title="Last rep touch"
          detail="Voice / call cadence tracking ships in Phase 2C."
          actionLabel="Log a call"
        />
      </div>

      {/* Institutional memory — Phase E live KB match panel */}
      <KbMatchPanel make={equipment.make} model={equipment.model} />
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function computeTradeUpReason(b: { trade_up_score: number; overdue_intervals: number; lifetime_parts_spend: number }, hours: number | null): string[] {
  const reasons: string[] = [];
  if (hours && hours >= 4000) reasons.push(`Engine hours (${hours.toLocaleString()}) approaching replacement window.`);
  if (b.overdue_intervals > 0) reasons.push(`${b.overdue_intervals} overdue service intervals.`);
  if (b.lifetime_parts_spend > 5000) reasons.push(`Cumulative parts spend $${b.lifetime_parts_spend.toLocaleString()} crossing the cost-curve heuristic.`);
  if (reasons.length === 0) reasons.push("Score is heuristic — no individual risk threshold tripped yet.");
  return reasons;
}

function computeRecommendedAction(
  b: { trade_up_score: number; overdue_intervals: number },
  deal: { name: string } | null,
): { title: string; detail: string } {
  if (b.trade_up_score >= 70) {
    return {
      title: "Open trade-up conversation",
      detail: "Trade-up score is high. Get in front of this customer before a competitor does.",
    };
  }
  if (b.overdue_intervals > 0) {
    return {
      title: "Service follow-up + commercial check-in",
      detail: "Overdue PM is a natural reason to call — pair it with a budget-cycle question.",
    };
  }
  if (deal) {
    return {
      title: "Re-engage open deal",
      detail: `Deal "${deal.name}" is still open. Surface any new incentive or price-lock opportunity.`,
    };
  }
  return {
    title: "Routine cadence",
    detail: "No urgent flags. Keep the relationship warm with a quarterly check-in.",
  };
}

function RiskCard({
  tone, icon, title, detail, actionLabel, onAction,
}: {
  tone: "red" | "orange" | "blue" | "violet" | "green";
  icon: React.ReactNode;
  title: string;
  detail: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  const TONE: Record<string, string> = {
    red:    "border-red-500/30",
    orange: "border-qep-orange/30",
    blue:   "border-blue-500/30",
    violet: "border-violet-500/30",
    green:  "border-emerald-500/30",
  };
  return (
    <Card className={`p-3 ${TONE[tone]}`}>
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </div>
      {onAction && (
        <Button size="sm" variant="outline" className="mt-2 w-full text-[10px]" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Card>
  );
}
