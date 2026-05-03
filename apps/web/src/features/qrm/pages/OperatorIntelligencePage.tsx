import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Lightbulb, MessageSquare, UserRound, Wrench, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckSurface } from "../components/command-deck";
import { supabase } from "@/lib/supabase";
import { normalizeExtractedDealData } from "@/lib/voice-capture-extraction";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildOperatorIntelligenceBoard } from "../lib/operator-intelligence";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";

export function OperatorIntelligencePage() {
  const boardQuery = useQuery({
    queryKey: ["qrm", "operator-intelligence"],
    queryFn: async () => {
      const [voiceResult, feedbackResult] = await Promise.all([
        supabase
          .from("voice_captures")
          .select("linked_company_id, created_at, transcript, extracted_data, crm_companies(name)")
          .not("linked_company_id", "is", null)
          .gte("created_at", new Date(Date.now() - 60 * 86_400_000).toISOString())
          .limit(500),
        supabase
          .from("service_completion_feedback")
          .select("created_at, time_saver_notes, serial_specific_note, return_visit_risk, service_jobs!inner(customer_id, crm_companies(name))")
          .limit(500),
      ]);

      if (voiceResult.error) throw new Error(voiceResult.error.message);
      if (feedbackResult.error) throw new Error(feedbackResult.error.message);

      return buildOperatorIntelligenceBoard({
        voiceSignals: (voiceResult.data ?? []).map((row) => {
          const companyJoin = Array.isArray(row.crm_companies) ? row.crm_companies[0] : row.crm_companies;
          return {
            companyId: row.linked_company_id,
            companyName: companyJoin?.name ?? null,
            createdAt: row.created_at,
            transcript: row.transcript,
            extractedData: row.extracted_data == null ? null : normalizeExtractedDealData(row.extracted_data),
          };
        }),
        feedbackSignals: (feedbackResult.data ?? []).map((row) => {
          const serviceJoin = Array.isArray(row.service_jobs) ? row.service_jobs[0] : row.service_jobs;
          const companyJoin = Array.isArray(serviceJoin?.crm_companies) ? serviceJoin.crm_companies[0] : serviceJoin?.crm_companies;
          return {
            companyId: serviceJoin?.customer_id ?? null,
            companyName: companyJoin?.name ?? null,
            createdAt: row.created_at,
            timeSaverNotes: row.time_saver_notes,
            serialSpecificNote: row.serial_specific_note,
            returnVisitRisk: row.return_visit_risk,
          };
        }),
      });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const board = boardQuery.data;

  const isLoading = boardQuery.isLoading;
  const isError = boardQuery.isError;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      <QrmPageHeader
        title="Operator Intelligence"
        subtitle="What operators say, need, complain about, and prefer — pulled from voice captures and service learnings."
      />
      <QrmSubNav />

      {isLoading ? (
        <DeckSurface className="h-32 animate-pulse border-qep-deck-rule bg-qep-deck-elevated/40"><div className="h-full" /></DeckSurface>
      ) : isError || !board ? (
        <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/70 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {boardQuery.error instanceof Error
              ? boardQuery.error.message
              : "Operator intelligence is unavailable right now."}
          </p>
        </DeckSurface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <UserRound className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Accounts</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.accounts)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Accounts carrying recent operator signals.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Concerns</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.concerns)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Recorded operator complaints and friction points.</p>
            </DeckSurface>
            <DeckSurface className="p-4">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-qep-orange" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Preferences</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.preferences)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Observed contact, buying, and skill preferences.</p>
            </DeckSurface>
            <DeckSurface className={`p-4 ${board.summary.highRiskReturns > 0 ? "border-qep-warm/40" : ""}`}>
              <div className="flex items-center gap-2">
                <Wrench className={`h-4 w-4 ${board.summary.highRiskReturns > 0 ? "text-qep-warm" : "text-qep-orange"}`} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workarounds</p>
              </div>
              <p className="mt-3 text-2xl font-semibold text-foreground">{String(board.summary.workarounds)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{board.summary.highRiskReturns} high-risk return-visit warnings</p>
            </DeckSurface>
          </div>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Operator signal accounts</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Accounts sorted by complaint pressure, return-visit risk, and fresh field learning.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/voice-qrm">
                  Voice QRM <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          <DeckSurface className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Canonical routes</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Operator Intelligence is a signal-gathering surface. The command center remains the source of truth for operating work.
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link to="/qrm/companies">
                  Refresh <ArrowUpRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </DeckSurface>

          {board.accounts.length === 0 ? (
            <DeckSurface className="border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">No operator intelligence signals are active right now.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Signals populate from voice captures (operator feedback) and service completion feedback.
              </p>
            </DeckSurface>
          ) : (
            <div className="space-y-3">
              {board.accounts.slice(0, 12).map((account) => (
                <DeckSurface key={account.companyId} className="rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{account.companyName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {account.concernCount} concerns · {account.preferenceCount} preferences · {account.workaroundCount} field learnings
                        {account.highRiskCount > 0 ? ` · ${account.highRiskCount} high-risk return flags` : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {account.latestAt ? `Latest signal ${new Date(account.latestAt).toLocaleDateString()}` : "No recent timestamp"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {account.highlights.slice(0, 6).map((highlight) => (
                          <span key={highlight} className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-muted-foreground">
                            {highlight}
                          </span>
                        ))}
                        {account.highlights.length > 6 && <span className="text-xs text-muted-foreground">+{account.highlights.length - 6}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="ghost">
                        <Link to={buildAccountCommandHref(account.companyId)}>
                          Account <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </DeckSurface>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
