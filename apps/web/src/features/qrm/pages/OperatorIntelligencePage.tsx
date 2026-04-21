import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { ExtractedDealData } from "@/lib/voice-capture-extraction.types";
import { buildAccountCommandHref } from "../lib/account-command";
import { buildOperatorIntelligenceBoard } from "../lib/operator-intelligence";
import { QrmPageHeader } from "../components/QrmPageHeader";
import { QrmSubNav } from "../components/QrmSubNav";
import { DeckSurface, SignalChip, StatusDot } from "../components/command-deck";

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
            extractedData: (row.extracted_data ?? null) as ExtractedDealData | null,
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
  const accounts = board?.accounts ?? [];
  const summary = board?.summary ?? { accounts: 0, concerns: 0, preferences: 0, workarounds: 0, highRiskReturns: 0 };

  // Iron briefing — name the sharpest operator signal on the graph.
  const operatorIronHeadline = boardQuery.isLoading
    ? "Scanning voice captures and service completion feedback for operator signal…"
    : boardQuery.isError
      ? "Operator intelligence stream offline. One of the feeders failed — check the console."
      : summary.highRiskReturns > 0
        ? `${summary.highRiskReturns} high-risk return-visit warning${summary.highRiskReturns === 1 ? "" : "s"} from the field — dispatch a pre-emptive touch before the next service call.`
        : summary.concerns > summary.preferences
          ? `${summary.concerns} operator concern${summary.concerns === 1 ? "" : "s"} logged across ${summary.accounts} account${summary.accounts === 1 ? "" : "s"} — friction is outrunning preference signal, resolve before churn risk compounds.`
          : summary.accounts === 0
            ? "No operator signal in the last 60 days. Voice QRM capture and service feedback both silent."
            : `${summary.accounts} account${summary.accounts === 1 ? "" : "s"} carrying live operator signal. ${summary.preferences} preferences and ${summary.workarounds} field learnings in the graph — use them in the next touch.`;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pb-12 pt-2 sm:px-6 lg:px-8 lg:pb-8">
      <QrmPageHeader
        title="Operator Intelligence"
        subtitle="Voice captures + service completions — what operators say, need, complain about, and prefer."
        crumb={{ surface: "GRAPH", lens: "OPERATORS", count: summary.accounts }}
        metrics={[
          { label: "Accounts", value: summary.accounts.toLocaleString() },
          { label: "Concerns", value: summary.concerns, tone: summary.concerns > 0 ? "hot" : undefined },
          { label: "Preferences", value: summary.preferences, tone: "live" },
          { label: "Field learnings", value: summary.workarounds, tone: "active" },
          { label: "Return risk", value: summary.highRiskReturns, tone: summary.highRiskReturns > 0 ? "hot" : undefined },
        ]}
        ironBriefing={{
          headline: operatorIronHeadline,
          actions: [{ label: "Voice QRM →", href: "/voice-qrm" }],
        }}
      />
      <QrmSubNav />

      {boardQuery.isLoading ? (
        <DeckSurface className="p-6 text-sm text-muted-foreground">Loading operator intelligence…</DeckSurface>
      ) : boardQuery.isError || !board ? (
        <DeckSurface className="border-qep-hot/40 bg-qep-hot/5 p-6 text-sm text-qep-hot">
          {boardQuery.error instanceof Error ? boardQuery.error.message : "Operator intelligence is unavailable right now."}
        </DeckSurface>
      ) : accounts.length === 0 ? (
        <DeckSurface className="p-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            No operator signal
          </p>
          <p className="mt-2 text-sm text-foreground/80">
            Nothing captured in the last 60 days. Field logs will flow in as service jobs and voice captures land.
          </p>
        </DeckSurface>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-3 border-b border-qep-deck-rule/50 px-3 pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            <div className="col-span-6 sm:col-span-4">Account</div>
            <div className="col-span-6 hidden sm:block sm:col-span-5">Signal</div>
            <div className="col-span-3 text-right sm:col-span-2">Latest</div>
            <div className="col-span-3 text-right sm:col-span-1">Action</div>
          </div>

          <div className="divide-y divide-qep-deck-rule/40 overflow-hidden rounded-sm border border-qep-deck-rule/60 bg-qep-deck-elevated/40">
            {accounts.slice(0, 12).map((account) => {
              const tone = account.highRiskCount > 0 ? "hot" : account.concernCount > 0 ? "warm" : account.preferenceCount > 0 ? "live" : "cool";
              const latest = account.latestAt ? new Date(account.latestAt).toLocaleDateString() : "—";
              return (
                <Link
                  key={account.companyId}
                  to={buildAccountCommandHref(account.companyId)}
                  className="group grid grid-cols-12 items-center gap-3 px-3 py-2 text-[13px] transition-colors hover:bg-qep-orange/[0.04]"
                >
                  <div className="col-span-6 flex min-w-0 items-center gap-2 sm:col-span-4">
                    <StatusDot tone={tone} pulse={tone === "hot"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{account.companyName}</p>
                      <p className="truncate text-[11px] text-muted-foreground sm:hidden">
                        {account.concernCount}c · {account.preferenceCount}p · {account.workaroundCount}l
                      </p>
                    </div>
                  </div>

                  <div className="col-span-6 hidden min-w-0 flex-wrap items-center gap-1 sm:col-span-5 sm:flex">
                    {account.concernCount > 0 && (
                      <SignalChip label="Concerns" value={account.concernCount} tone="hot" />
                    )}
                    {account.preferenceCount > 0 && (
                      <SignalChip label="Prefs" value={account.preferenceCount} tone="live" />
                    )}
                    {account.workaroundCount > 0 && (
                      <SignalChip label="Learnings" value={account.workaroundCount} tone="active" />
                    )}
                    {account.highRiskCount > 0 && (
                      <SignalChip label="Return risk" value={account.highRiskCount} tone="hot" />
                    )}
                  </div>

                  <div className="col-span-3 text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:col-span-2">
                    {latest}
                  </div>

                  <div className="col-span-3 flex items-center justify-end gap-1 sm:col-span-1">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-qep-orange" />
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {Math.min(accounts.length, 12).toLocaleString()} / {accounts.length.toLocaleString()} shown
            </p>
            <Button asChild size="sm" variant="outline" className="h-8 px-2 font-mono text-[11px] uppercase tracking-[0.1em]">
              <Link to="/voice-qrm">
                Voice QRM <ArrowUpRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
