import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import {
  User,
  Building2,
  Briefcase,
  FileText,
  Sparkles,
  Wrench,
  CalendarClock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Clock,
} from "lucide-react";
import type { VoiceQrmResponse, VoiceContentType } from "../lib/voice-qrm-api";

interface VoiceQrmSummaryCardProps {
  result: VoiceQrmResponse;
}

const CONTENT_TYPE_STYLES: Record<VoiceContentType, { label: string; color: string; bg: string }> = {
  sales: { label: "Sales", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  parts: { label: "Parts", color: "text-amber-400", bg: "bg-amber-500/10" },
  service: { label: "Service", color: "text-cyan-400", bg: "bg-cyan-500/10" },
  process_improvement: { label: "Process Improvement", color: "text-violet-400", bg: "bg-violet-500/10" },
  general: { label: "General", color: "text-muted-foreground", bg: "bg-muted" },
};

function sentimentDisplay(score: number | null, sentiment?: string | null) {
  if (score === null || score === undefined) return null;
  if (score >= 0.7) return { label: sentiment ?? "positive", icon: TrendingUp, color: "text-emerald-400" };
  if (score <= 0.3) return { label: sentiment ?? "negative", icon: TrendingDown, color: "text-red-400" };
  return { label: sentiment ?? "neutral", icon: Minus, color: "text-muted-foreground" };
}

function matchBadge(method: string | null) {
  if (!method) return null;
  const styles: Record<string, string> = {
    exact: "bg-emerald-500/10 text-emerald-400",
    fuzzy: "bg-amber-500/10 text-amber-400",
    created: "bg-blue-500/10 text-blue-400",
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styles[method] ?? "bg-muted text-muted-foreground"}`}>
      {method}
    </span>
  );
}

export function VoiceQrmSummaryCard({ result }: VoiceQrmSummaryCardProps) {
  const contentStyle = CONTENT_TYPE_STYLES[result.content_type] ?? CONTENT_TYPE_STYLES.general;
  const sentiment = sentimentDisplay(result.sentiment_score, result.intelligence?.sentiment);
  const SentimentIcon = sentiment?.icon;

  const entitiesCreatedCount =
    (result.entities.contact.id ? 1 : 0) +
    (result.entities.company.id ? 1 : 0) +
    (result.entities.deal.id ? 1 : 0) +
    result.entities.additional_deals.count +
    result.entities.equipment.count +
    result.entities.scheduled_follow_ups.count +
    (result.entities.needs_assessment.id ? 1 : 0) +
    (result.entities.cadence.id ? 1 : 0);

  return (
    <div className="space-y-3">
      {/* Header: content type + sentiment + pipeline duration */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
            <h2 className="text-sm font-bold text-foreground">Voice captured & structured</h2>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${contentStyle.bg} ${contentStyle.color}`}>
              {contentStyle.label}
            </span>
            {sentiment && SentimentIcon && (
              <span className={`flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium ${sentiment.color}`}>
                <SentimentIcon className="h-3 w-3" aria-hidden />
                {sentiment.label}
              </span>
            )}
            {result.intelligence?.buying_intent && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                intent: {result.intelligence.buying_intent}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
            <Clock className="h-3 w-3" aria-hidden />
            {(result.pipeline_duration_ms / 1000).toFixed(1)}s
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" aria-hidden />
          <span>
            Created <strong className="text-foreground">{entitiesCreatedCount}</strong>{" "}
            record{entitiesCreatedCount === 1 ? "" : "s"} across the QRM
          </span>
        </div>

        {result.qrm_narrative && (
          <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">QRM narrative</p>
            <p className="mt-1 text-sm italic text-foreground whitespace-pre-wrap">{result.qrm_narrative}</p>
          </div>
        )}
      </Card>

      {/* Core entities */}
      <Card className="p-4 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Core records</h3>

        {/* Contact */}
        <EntityRow
          icon={User}
          label="Contact"
          primary={result.entities.contact.name || "—"}
          detail={result.entities.contact.confidence !== null ? `similarity ${(result.entities.contact.confidence * 100).toFixed(0)}%` : undefined}
          badge={matchBadge(result.entities.contact.match_method)}
          to={result.entities.contact.id ? `/crm/contacts/${result.entities.contact.id}` : undefined}
        />

        {/* Company */}
        <EntityRow
          icon={Building2}
          label="Company"
          primary={result.entities.company.name ?? "—"}
          detail={result.entities.company.confidence !== null ? `similarity ${(result.entities.company.confidence * 100).toFixed(0)}%` : undefined}
          badge={matchBadge(result.entities.company.match_method)}
          to={result.entities.company.id ? `/crm/companies/${result.entities.company.id}` : undefined}
        />

        {/* Primary deal */}
        <EntityRow
          icon={Briefcase}
          label="Primary deal"
          primary={
            result.entities.deal.id
              ? `Deal ${result.entities.deal.action ?? ""}${result.entities.deal.stage_suggestion ? ` · stage ${result.entities.deal.stage_suggestion}` : ""}`
              : "Not created"
          }
          badge={result.entities.deal.action ? <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue-400">{result.entities.deal.action}</span> : null}
          to={result.entities.deal.id ? `/crm/deals/${result.entities.deal.id}` : undefined}
        />

        {/* Needs assessment */}
        {result.entities.needs_assessment.id && (
          <EntityRow
            icon={FileText}
            label="Needs assessment"
            primary={`${result.entities.needs_assessment.completeness} field${result.entities.needs_assessment.completeness === 1 ? "" : "s"} populated`}
          />
        )}
      </Card>

      {/* Additional deals (multi-deal extraction) */}
      {result.entities.additional_deals.count > 0 && (
        <Card className="border-qep-orange/30 bg-qep-orange/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="h-4 w-4 text-qep-orange" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">
              +{result.entities.additional_deals.count} additional deal{result.entities.additional_deals.count === 1 ? "" : "s"} created
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            The voice note mentioned multiple opportunities. Each is now a separate deal in the pipeline.
          </p>
          <ul className="mt-2 space-y-1">
            {result.entities.additional_deals.ids.map((id) => (
              <li key={id}>
                <Link to={`/crm/deals/${id}`} className="text-xs text-qep-orange hover:underline flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Open deal {id.substring(0, 8)}…
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Equipment mentions */}
      {result.entities.equipment.count > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="h-4 w-4 text-violet-400" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">
              {result.entities.equipment.count} equipment record{result.entities.equipment.count === 1 ? "" : "s"} extracted
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Machines mentioned in the voice note (current fleet, trade-ins, or items of interest) are now tracked.
          </p>
          {result.entities.equipment.crm_equipment_ids && result.entities.equipment.crm_equipment_ids.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.entities.equipment.crm_equipment_ids.map((id) => (
                <li key={id}>
                  <Link to={`/crm/equipment/${id}`} className="text-xs text-violet-400 hover:underline flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    Open equipment {id.substring(0, 8)}…
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Scheduled follow-ups */}
      {result.entities.scheduled_follow_ups.count > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="h-4 w-4 text-blue-400" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">
              {result.entities.scheduled_follow_ups.count} future task{result.entities.scheduled_follow_ups.count === 1 ? "" : "s"} scheduled
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Future-dated follow-ups extracted from the conversation (e.g. "call in August") — now on your task list.
          </p>
        </Card>
      )}

      {/* Budget timeline captured */}
      {result.entities.budget_timeline_captured && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="h-4 w-4 text-emerald-400" aria-hidden />
            <h3 className="text-sm font-semibold text-emerald-400">Budget timeline captured</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            The customer's budget cycle has been saved to their profile. The Deal Timing Engine will now generate
            alerts when their budget window approaches — no more missed opportunities.
          </p>
        </Card>
      )}

      {/* Follow-up suggestions */}
      {result.follow_up_suggestions.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">Suggested follow-ups</h3>
          </div>
          <ul className="space-y-1.5">
            {result.follow_up_suggestions.map((suggestion, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-qep-orange" aria-hidden />
                <span>{suggestion}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Competitor mentions */}
      {result.intelligence?.competitor_mentions && result.intelligence.competitor_mentions.length > 0 && (
        <Card className="border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-400" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">Competitor mentions</h3>
          </div>
          <ul className="space-y-1">
            {result.intelligence.competitor_mentions.map((mention, i) => (
              <li key={i} className="text-xs text-foreground">
                <strong>{mention.brand ?? "Unknown"}:</strong>{" "}
                <span className="text-muted-foreground">{mention.context ?? "mentioned"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Errors (if any) */}
      {result.errors && result.errors.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-400" aria-hidden />
            <h3 className="text-sm font-semibold text-amber-400">Partial extraction warnings</h3>
          </div>
          <ul className="space-y-0.5">
            {result.errors.map((err, i) => (
              <li key={i} className="text-[11px] text-amber-300">{err}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Transcript (collapsible detail) */}
      <details className="rounded-md border border-border/60 bg-card p-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
          View transcript
        </summary>
        <p className="mt-2 text-xs text-foreground whitespace-pre-wrap">{result.transcript}</p>
      </details>
    </div>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function EntityRow({
  icon: Icon,
  label,
  primary,
  detail,
  badge,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  detail?: string;
  badge?: React.ReactNode;
  to?: string;
}) {
  const content = (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground truncate">{primary}</p>
        {detail && <p className="text-[10px] text-muted-foreground">{detail}</p>}
      </div>
      {badge}
      {to && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden />}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block rounded-md border border-transparent p-2 hover:border-border hover:bg-muted/30 transition-colors">
        {content}
      </Link>
    );
  }
  return <div className="p-2">{content}</div>;
}
