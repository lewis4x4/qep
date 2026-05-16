// QRM Quote Wizard — shared intake input primitive.
//
// Extracted from `QuoteBuilderV2Page.tsx` as PR 9.5 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence.
// Renders the typed+mic single intake field, the "Build with AI" CTA,
// the voice-recorder reveal, and the error/status copy. All persistent
// state (aiPrompt text, recorder-open flag, entryMode draft updates)
// stays in the parent — this component is pure presentation. The
// "Start quote" and "Fast intake" surfaces both consume it so the
// inputs cannot drift out of sync.

import { Loader2, Mic, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VoiceRecorder } from "@/features/voice-qrm/components/VoiceRecorder";

import type { QuoteEntryMode } from "../../../../../../shared/qep-moonshot-contracts";

export interface IntakeInputProps {
  /** Current typed prompt. The parent owns the state so multiple surfaces stay in sync. */
  aiPrompt: string;
  onAiPromptChange: (next: string) => void;

  /** Recorder reveal toggle, also parent-owned. */
  intakeRecorderOpen: boolean;
  onIntakeRecorderToggle: () => void;

  /** Notify the parent that the rep has switched intake mode (voice vs ai_chat). */
  onEntryModeChange: (mode: QuoteEntryMode) => void;

  /** Voice capture callback — parent constructs the mutation. */
  onVoiceRecorded: (audioBlob: Blob, fileName: string) => void;
  voiceMutationPending: boolean;

  /** AI build callback — parent constructs the mutation. */
  onBuildWithAi: (prompt: string) => void;
  aiIntakeMutationPending: boolean;
  aiIntakeMessage: string | null;

  /** Optional copy overrides so the "Start quote" vs "Fast intake" cards
   *  can vary headline + helper text without each one reimplementing the
   *  textarea / mic / Build with AI cluster. */
  helperText?: string;
  recorderHeading?: string;
  /** Min-height of the textarea. Defaults to 104px (Start quote surface). */
  textareaMinHeight?: "104px" | "90px";
  /** Build-button rendering variant.
   *  - "icons" (default, Start quote surface): spinner-or-Sparkles icon +
   *    "Build with AI" text, both states.
   *  - "text"  (Fast intake surface): "Building…" while pending, "Build
   *    with AI" while idle, no icons. */
  buildButtonVariant?: "icons" | "text";
  /** Vertical order of the Build button vs the recorder reveal panel.
   *  - "build_then_recorder" (default, Start quote surface):
   *      textarea → helper → Build → recorder → error
   *  - "recorder_then_build" (Fast intake surface):
   *      textarea → helper → recorder → Build → error */
  bodyOrder?: "build_then_recorder" | "recorder_then_build";
}

export function IntakeInput({
  aiPrompt,
  onAiPromptChange,
  intakeRecorderOpen,
  onIntakeRecorderToggle,
  onEntryModeChange,
  onVoiceRecorded,
  voiceMutationPending,
  onBuildWithAi,
  aiIntakeMutationPending,
  aiIntakeMessage,
  helperText = "Use the mic to capture field notes, then build the quote from one intake stream.",
  recorderHeading = "Record intake",
  textareaMinHeight = "104px",
  buildButtonVariant = "icons",
  bodyOrder = "build_then_recorder",
}: IntakeInputProps) {
  const buildButton = (
    <div className="mt-2 flex justify-end">
      <Button
        size="sm"
        onClick={() => onBuildWithAi(aiPrompt.trim())}
        disabled={aiIntakeMutationPending || aiPrompt.trim().length < 12}
      >
        {buildButtonVariant === "icons" ? (
          <>
            {aiIntakeMutationPending
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Sparkles className="mr-1 h-4 w-4" />}
            Build with AI
          </>
        ) : (
          aiIntakeMutationPending ? "Building…" : "Build with AI"
        )}
      </Button>
    </div>
  );

  const recorderPanel = intakeRecorderOpen ? (
    <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-background/60 p-3">
      <p className="text-sm font-medium text-foreground">{recorderHeading}</p>
      <VoiceRecorder
        onRecorded={(audioBlob, fileName) => {
          onEntryModeChange("voice");
          onVoiceRecorded(audioBlob, fileName);
        }}
        disabled={voiceMutationPending}
      />
      {voiceMutationPending && <p className="text-xs text-muted-foreground">Processing voice note…</p>}
    </div>
  ) : null;

  return (
    <>
      <div className="relative mt-4">
        <textarea
          value={aiPrompt}
          onFocus={() => onEntryModeChange("ai_chat")}
          onChange={(event) => {
            onAiPromptChange(event.target.value);
            onEntryModeChange("ai_chat");
          }}
          placeholder="Describe what you want to quote."
          className="w-full rounded border border-input bg-card px-3 py-2 pr-12 text-sm"
          style={{ minHeight: textareaMinHeight }}
        />
        <button
          type="button"
          onClick={() => {
            onEntryModeChange("voice");
            onIntakeRecorderToggle();
          }}
          className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${
            intakeRecorderOpen
              ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
              : "border-border bg-background/80 text-muted-foreground hover:border-qep-orange/50 hover:text-qep-orange"
          }`}
          aria-label="Use microphone intake"
          title="Use microphone intake"
        >
          <Mic className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{helperText}</p>

      {bodyOrder === "build_then_recorder" ? (
        <>
          {buildButton}
          {recorderPanel}
        </>
      ) : (
        <>
          {recorderPanel}
          {buildButton}
        </>
      )}

      {aiIntakeMessage && (
        <p className="mt-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {aiIntakeMessage}
        </p>
      )}
    </>
  );
}
