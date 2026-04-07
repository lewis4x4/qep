import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, Sparkles, RotateCcw, Loader2 } from "lucide-react";
import { submitVoiceToQrm, isIdeaBacklogResponse, type VoiceQrmResult } from "../lib/voice-qrm-api";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { VoiceQrmSummaryCard } from "../components/VoiceQrmSummaryCard";
import { AskIronAdvisorButton } from "@/components/primitives";

export function VoiceQrmPage() {
  const [searchParams] = useSearchParams();
  const dealId = searchParams.get("deal_id") ?? undefined;
  const [result, setResult] = useState<VoiceQrmResult | null>(null);

  const submitMutation = useMutation({
    mutationFn: (args: { audioBlob: Blob; fileName: string }) =>
      submitVoiceToQrm({ audioBlob: args.audioBlob, fileName: args.fileName, dealId }),
    onSuccess: (data) => setResult(data),
  });

  function handleRecorded(audioBlob: Blob, fileName: string) {
    submitMutation.mutate({ audioBlob, fileName });
  }

  function startOver() {
    setResult(null);
    submitMutation.reset();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-qep-orange" aria-hidden />
            <h1 className="text-xl font-bold text-foreground">Voice-to-QRM</h1>
          </div>
          <AskIronAdvisorButton contextType="voice_capture" variant="inline" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Talk naturally. The system extracts contacts, companies, deals, equipment, budget timelines, and future tasks — and routes everything to the right department.
        </p>
        {dealId && (
          <p className="mt-1 text-xs text-muted-foreground">
            Linking to deal <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{dealId.substring(0, 8)}…</code>
          </p>
        )}
      </div>

      {/* Recording / processing / result states */}
      {!result && !submitMutation.isPending && (
        <Card className="p-6">
          <VoiceRecorder onRecorded={handleRecorded} disabled={submitMutation.isPending} />

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Hint
              icon={<Mic className="h-4 w-4 text-qep-orange" aria-hidden />}
              title="Passive call capture"
              body="Put your phone on speaker, tap the mic. Talk to the customer. When it ends, the system extracts everything."
            />
            <Hint
              icon={<Sparkles className="h-4 w-4 text-qep-orange" aria-hidden />}
              title="Ramble to structure"
              body="No script needed. Mention multiple machines, two potential deals, budget opens October, follow up in August — it all gets parsed."
            />
          </div>
        </Card>
      )}

      {submitMutation.isPending && (
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-qep-orange" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-foreground">Processing voice note…</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Transcribing → extracting entities → matching contacts → creating deals → setting up follow-ups.
          </p>
        </Card>
      )}

      {submitMutation.isError && !result && (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm font-semibold text-red-400">Processing failed</p>
          <p className="mt-1 text-xs text-red-300">
            {(submitMutation.error as Error)?.message ?? "Unknown error"}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={startOver}>
            <RotateCcw className="mr-1 h-3 w-3" />
            Try again
          </Button>
        </Card>
      )}

      {result && isIdeaBacklogResponse(result) && (
        <>
          <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-400">Routed to Idea Backlog</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lead phrase detected. Captured as an idea instead of a customer activity.
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">{result.title}</p>
                <p className="mt-1 text-[11px] italic text-muted-foreground">"{result.transcript}"</p>
              </div>
            </div>
          </Card>
          <div className="flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={startOver}>
              <RotateCcw className="mr-1 h-3 w-3" /> Capture another
            </Button>
            <Button asChild size="sm">
              <a href="/qrm/ideas">Open Idea Backlog →</a>
            </Button>
          </div>
        </>
      )}

      {result && !isIdeaBacklogResponse(result) && (
        <>
          <VoiceQrmSummaryCard result={result} />
          <div className="flex justify-center">
            <Button variant="outline" onClick={startOver}>
              <Mic className="mr-1 h-4 w-4" />
              Record another
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function Hint({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs font-semibold text-foreground">{title}</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{body}</p>
    </div>
  );
}
