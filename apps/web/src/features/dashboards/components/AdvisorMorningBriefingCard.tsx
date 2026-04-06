import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Sunrise, AlertCircle, Sparkles } from "lucide-react";

interface SlaDeal {
  id: string;
  name: string;
  sla_deadline_at: string | null;
}

interface NewLead {
  id: string;
  name: string;
  created_at: string;
}

interface AdvisorMorningBriefingCardProps {
  slaDeals: SlaDeal[];
  newLeads: NewLead[];
}

export function AdvisorMorningBriefingCard({ slaDeals, newLeads }: AdvisorMorningBriefingCardProps) {
  const hasSignal = slaDeals.length > 0 || newLeads.length > 0;

  return (
    <Card className="p-4 border-qep-orange/20 bg-gradient-to-br from-qep-orange/5 to-transparent">
      <div className="flex items-center gap-2 mb-3">
        <Sunrise className="h-4 w-4 text-qep-orange" />
        <h2 className="text-sm font-semibold text-foreground">Morning briefing</h2>
      </div>

      {!hasSignal ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
          No SLA breaches or fresh early-stage leads in the last 7 days. Check your follow-up queue below.
        </p>
      ) : (
        <div className="space-y-3">
          {slaDeals.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-400 mb-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                SLA attention ({slaDeals.length})
              </div>
              <ul className="space-y-1">
                {slaDeals.slice(0, 4).map((d) => (
                  <li key={d.id}>
                    <Link to={`/qrm/deals/${d.id}`} className="text-sm text-foreground hover:text-qep-orange underline-offset-2 hover:underline">
                      {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {newLeads.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">New early pipeline (7d, stages 1–3)</p>
              <ul className="space-y-1">
                {newLeads.slice(0, 4).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <Link to={`/qrm/deals/${d.id}`} className="text-sm text-foreground truncate hover:text-qep-orange underline-offset-2 hover:underline min-w-0">
                      {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Link
              to="/qrm/pipeline"
              className="text-xs font-medium text-qep-orange hover:underline"
            >
              Open my pipeline
            </Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/voice" className="text-xs font-medium text-qep-orange hover:underline">
              Voice capture
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
