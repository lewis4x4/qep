export interface VoiceToQrmCompanyResolutionInput {
  authorizedLinkedCompanyId: string | null;
  extractedCompanyName: string | null;
}

export interface VoiceToQrmCompanyResolutionDecision {
  forceCompanyId: string | null;
  shouldFuzzyMatch: boolean;
  shouldCreateCompany: boolean;
}

export function resolveVoiceToQrmCompanyDecision(
  input: VoiceToQrmCompanyResolutionInput,
): VoiceToQrmCompanyResolutionDecision {
  if (input.authorizedLinkedCompanyId) {
    return {
      forceCompanyId: input.authorizedLinkedCompanyId,
      shouldFuzzyMatch: false,
      shouldCreateCompany: false,
    };
  }

  const hasExtractedName = Boolean(input.extractedCompanyName?.trim());
  return {
    forceCompanyId: null,
    shouldFuzzyMatch: hasExtractedName,
    shouldCreateCompany: hasExtractedName,
  };
}
