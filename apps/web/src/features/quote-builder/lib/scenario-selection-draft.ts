import type { ScenarioSelection } from "../components/ConversationalDealEngine";
import type {
  QuoteRecommendation,
  QuoteWorkspaceDraft,
} from "../../../../../../shared/qep-moonshot-contracts";

export type ScenarioSelectionSource = "deal_assistant" | "voice_handoff";

type VoiceHandoffSelection = ScenarioSelection & { at?: string };

function buildRecommendationFromVoiceHandoff(
  selection: VoiceHandoffSelection,
): QuoteRecommendation {
  const { scenario, prompt } = selection;
  const createdAt = selection.at ?? new Date().toISOString();
  const reasoningParts = [scenario.description, ...scenario.pros.slice(0, 2)]
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    machine: scenario.label,
    attachments: [],
    reasoning: reasoningParts.join(" ") || "Selected from the voice quote scenario handoff.",
    trigger: {
      triggerType: "voice_transcript",
      sourceField: "voice_quote_handoff",
      excerpt: prompt.trim() ? prompt.trim().slice(0, 180) : null,
      createdAt,
    },
    alternative: null,
    jobConsiderations: scenario.cons.length > 0 ? scenario.cons : null,
  };
}

export function buildScenarioSelectionDraftPatch(
  current: QuoteWorkspaceDraft,
  selection: VoiceHandoffSelection,
  source: ScenarioSelectionSource,
): Partial<QuoteWorkspaceDraft> {
  const { scenario, resolvedModelId, prompt, originatingLogId } = selection;
  return {
    voiceSummary: prompt,
    originatingLogId: originatingLogId ?? current.originatingLogId ?? null,
    ...(source === "voice_handoff"
      ? {
          entryMode: "voice" as const,
          recommendation: current.recommendation ?? buildRecommendationFromVoiceHandoff(selection),
        }
      : {}),
    ...(resolvedModelId && current.equipment.length === 0
      ? {
          equipment: [{
            kind: "equipment" as const,
            id: resolvedModelId,
            title: `AI-matched machine (${resolvedModelId.slice(0, 8)}…)`,
            make: "",
            model: "",
            year: null,
            quantity: 1,
            unitPrice: Math.round(scenario.customerOutOfPocketCents / 100),
          }],
        }
      : {}),
  };
}
