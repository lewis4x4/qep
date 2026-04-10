import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, Brain, Loader2, MapPin, MessageSquareText, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { fetchAccount360 } from "../lib/account-360-api";
import {
  buildVisitPrepRequest,
  buildVisitPrimaryHref,
  normalizeVisitRecommendations,
  type VisitRecommendation,
} from "../lib/visit-intelligence";

interface PrepSheetResponse {
  entity_type: "company" | "contact";
  entity_name: string;
  prep_sheet: string;
  data_summary: {
    contacts: number;
    deals: number;
    activities: number;
    voice_notes: number;
    equipment: number;
  };
}

export function VisitIntelligencePage() {
  const { profile } = useAuth();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const today = new Date().toISOString().split("T")[0];

  const listQuery = useQuery({
    queryKey: ["visit-intelligence", profile?.id, today],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("predictive_visit_lists")
        .select("recommendations, visits_completed, visits_total")
        .eq("rep_id", profile!.id)
        .eq("list_date", today)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 60_000,
  });

  const recommendations = useMemo(
    () => normalizeVisitRecommendations(listQuery.data?.recommendations ?? []),
    [listQuery.data?.recommendations],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [recommendations.length]);

  const selected = recommendations[selectedIndex] ?? null;
  const prepRequest = selected ? buildVisitPrepRequest(selected) : null;

  const prepQuery = useQuery({
    queryKey: ["visit-intelligence", "prep-sheet", prepRequest?.entity_type, prepRequest?.name],
    enabled: Boolean(prepRequest),
    queryFn: async (): Promise<PrepSheetResponse> => {
      const session = (await supabase.auth.getSession()).data.session;
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/prep-sheet`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(prepRequest),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to generate visit brief.");
      }
      return payload as PrepSheetResponse;
    },
    staleTime: 60_000,
  });

  const account360Query = useQuery({
    queryKey: ["visit-intelligence", "account-360", selected?.company_id],
    enabled: Boolean(selected?.company_id),
    queryFn: () => fetchAccount360(selected!.company_id!),
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Visit Intelligence"
        subtitle="Pre-visit briefings with talking points, service issues, competitor mentions, and likely objections."
      />
      <QrmSubNav />

      {listQuery.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading visit intelligence…</Card>
      ) : listQuery.isError ? (
        <Card className="border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">
          {listQuery.error instanceof Error ? listQuery.error.message : "Visit intelligence unavailable."}
        </Card>
      ) : recommendations.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No predictive visit list generated for today yet.
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Today&apos;s visit targets</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {listQuery.data?.visits_completed ?? 0}/{listQuery.data?.visits_total ?? 10} visits completed
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                ranked
              </Badge>
            </div>
            <div className="mt-4 space-y-3">
              {recommendations.map((rec, index) => (
                <button
                  key={`${rec.company_id ?? rec.contact_id ?? index}`}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    index === selectedIndex ? "border-qep-orange/40 bg-qep-orange/5" : "border-border bg-background hover:border-qep-orange/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {rec.company_name ?? rec.contact_name ?? "Visit target"}
                      </p>
                      {rec.reason && <p className="mt-1 text-xs text-muted-foreground">{rec.reason}</p>}
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                        {rec.last_contact_days != null && <span>{rec.last_contact_days}d since touch</span>}
                        {rec.distance_km != null && <span>{rec.distance_km.toFixed(1)}km away</span>}
                        {rec.equipment_interest && <span>{rec.equipment_interest}</span>}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-qep-orange">{Math.round(rec.priority_score ?? 0)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            {selected && (
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-qep-orange" />
                      <h2 className="text-sm font-semibold text-foreground">
                        {selected.company_name ?? selected.contact_name ?? "Visit target"}
                      </h2>
                    </div>
                    {selected.reason && <p className="mt-1 text-xs text-muted-foreground">{selected.reason}</p>}
                  </div>
                  {buildVisitPrimaryHref(selected) && (
                    <Button asChild size="sm" variant="outline">
                      <Link to={buildVisitPrimaryHref(selected)!}>
                        Open record <ArrowUpRight className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {account360Query.data && (
              <div className="grid gap-3 sm:grid-cols-3">
                <InsightCard icon={Wrench} label="Open service jobs" value={String(account360Query.data.service.filter((job) => !["closed", "invoiced", "cancelled"].includes(job.current_stage)).length)} />
                <InsightCard icon={MessageSquareText} label="Open quotes" value={String(account360Query.data.open_quotes.length)} />
                <InsightCard icon={MapPin} label="AR block" value={account360Query.data.ar_block?.status === "active" ? "Active" : "Clear"} />
              </div>
            )}

            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-qep-orange" />
                <h2 className="text-sm font-semibold text-foreground">Pre-visit brief</h2>
              </div>
              {prepQuery.isLoading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating briefing…
                </div>
              ) : prepQuery.isError ? (
                <p className="mt-4 text-sm text-red-300">
                  {prepQuery.error instanceof Error ? prepQuery.error.message : "Prep sheet unavailable."}
                </p>
              ) : prepQuery.data ? (
                <>
                  <SimpleMarkdown markdown={prepQuery.data.prep_sheet} />
                  <p className="mt-4 text-[10px] text-muted-foreground">
                    {prepQuery.data.data_summary.contacts} contacts · {prepQuery.data.data_summary.deals} deals · {prepQuery.data.data_summary.activities} activities · {prepQuery.data.data_summary.voice_notes} voice notes
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Select a visit target to generate a briefing.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-qep-orange" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}

function SimpleMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  return (
    <div className="mt-4 space-y-1">
      {lines.map((line, index) => {
        if (line.startsWith("# ")) {
          return <h2 key={index} className="mt-2 text-base font-semibold text-foreground">{line.slice(2)}</h2>;
        }
        if (line.startsWith("## ")) {
          return <h3 key={index} className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">{line.slice(3)}</h3>;
        }
        if (line.startsWith("- ")) {
          return <p key={index} className="text-sm text-foreground">{line.slice(2)}</p>;
        }
        if (line.trim() === "") {
          return <div key={index} className="h-1" />;
        }
        return <p key={index} className="text-sm text-foreground">{line}</p>;
      })}
    </div>
  );
}
