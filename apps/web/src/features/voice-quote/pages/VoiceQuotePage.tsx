import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
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
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Voice Quote</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe the opportunity in your own words. The AI resolves the machine, computes scenarios,
          and hands the selected one off to the quote builder.
        </p>
      </div>

      <ConversationalDealEngine
        open={true}
        onClose={() => navigate(-1)}
        onScenarioSelect={handleScenarioSelect}
      />
    </div>
  );
}
