import type { Branch } from "@/hooks/useBranches";
import type { QuotePDFData } from "../components/QuotePDFDocument";
import type { ScenarioSelection } from "../components/ConversationalDealEngine";
import {
  normalizeVoiceQuoteHandoff,
  parseVoiceQuoteHandoff,
  type VoiceQuoteHandoff,
} from "@/features/voice-quote/lib/voice-quote-handoff";

export type PendingScenarioSelection = ScenarioSelection & Pick<VoiceQuoteHandoff, "at" | "voiceSessionId">;

export function normalizePendingScenarioSelection(
  value: unknown,
  nowMs = Date.now(),
): PendingScenarioSelection | null {
  return normalizeVoiceQuoteHandoff(value, { nowMs });
}

export function parsePendingScenarioSelection(
  raw: string | null,
  nowMs = Date.now(),
): PendingScenarioSelection | null {
  return parseVoiceQuoteHandoff(raw, { nowMs });
}

function optionalText(value: string | null | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

export function buildQuotePdfBranch(branch: Branch | null | undefined): QuotePDFData["branch"] {
  return {
    name: optionalText(branch?.display_name) ?? "Quality Equipment & Parts",
    address: optionalText(branch?.address_line1),
    city: optionalText(branch?.city),
    state: optionalText(branch?.state_province),
    postalCode: optionalText(branch?.postal_code),
    phone: optionalText(branch?.phone_main),
    email: optionalText(branch?.email_main),
    website: optionalText(branch?.website_url),
    footerText: optionalText(branch?.doc_footer_text),
  };
}
