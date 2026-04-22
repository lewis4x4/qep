import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import {
  ConversationalDealEngine,
  type ScenarioSelection,
} from "@/features/quote-builder/components/ConversationalDealEngine";

/**
 * Slice 14 — Voice-to-Quote entry point.
 *
 * The conversational deal engine already has voice input built in. Until
 * this slice it only lived inside QuoteBuilderV2Page, so reps had to be
 * inside a quote draft to use it. This page gives voice its own door:
 *
 *   /voice-quote  →  ConversationalDealEngine (voice mode)
 *                 →  rep speaks prompt
 *                 →  scenarios render
 *                 →  rep picks one
 *                 →  we stash the selection in sessionStorage and
 *                    navigate to /quote-v2 where QuoteBuilderV2Page
 *                    picks it up and seeds the draft.
 *
 * Sessionstorage is deliberately chosen over URL state so we don't
 * push scenario blobs through the address bar. The handoff key is
 * scoped so parallel tabs don't clobber each other.
 */

export const VOICE_QUOTE_HANDOFF_KEY = "qep.voiceQuote.pendingSelection";

export function VoiceQuotePage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  function handleScenarioSelect(selection: ScenarioSelection) {
    try {
      sessionStorage.setItem(
        VOICE_QUOTE_HANDOFF_KEY,
        JSON.stringify({
          ...selection,
          at: new Date().toISOString(),
        }),
      );
    } catch (e) {
      // Storage quota / private-mode edge case — log but still navigate
      // so the user isn't stranded. QuoteBuilder starts blank.
      // eslint-disable-next-line no-console
      console.warn("[voice-quote] sessionStorage write failed:", e);
      toast({
        title: "Draft not pre-filled",
        description: "Your browser rejected the handoff. The quote builder will open blank; enter the details manually.",
        variant: "destructive",
      });
    }
    navigate("/quote-v2");
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-6">
          <div className="rounded-[32px] border border-qep-orange/20 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.88))] p-6 shadow-[0_24px_80px_rgba(15,23,42,0.32)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-qep-orange/90">
              Sales Voice Workflow
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">Voice Quote</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Speak the customer situation in plain language. The assistant resolves the machine, builds
              quote scenarios, and sends your selected option directly into Quote Builder for review.
            </p>
          </div>

          <ConversationalDealEngine
            open={true}
            variant="embedded"
            defaultInputMode="voice"
            onClose={() => navigate("/quote-v2")}
            onScenarioSelect={handleScenarioSelect}
          />
        </section>

        <aside className="space-y-4">
          <Card className="rounded-[24px] border-border/60 bg-card/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">What To Mention</p>
            <ul className="mt-3 space-y-3 text-sm leading-5 text-muted-foreground">
              <li>Customer name, company, and where the machine will work.</li>
              <li>Machine type, preferred brand, and any must-have attachments.</li>
              <li>Budget, payment target, urgency, and trade-in context.</li>
              <li>Any delivery state or branch-specific constraint you already know.</li>
            </ul>
          </Card>

          <Card className="rounded-[24px] border-border/60 bg-card/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">What Happens Next</p>
            <ul className="mt-3 space-y-3 text-sm leading-5 text-muted-foreground">
              <li>The transcript is parsed and matched to the most likely machine.</li>
              <li>Scenarios stream back with pricing direction and financing context.</li>
              <li>Your chosen scenario opens in Quote Builder so you can confirm customer, equipment, and totals.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
