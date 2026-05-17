import type { QuoteBuilderV2PageShellProps } from "../components/QuoteBuilderV2PageShell";

export type QuoteBuilderPageShellPropsInput = Omit<QuoteBuilderV2PageShellProps, "wizardStepRouter">;

/** Mechanical pass-through so shell prop assembly can live at the orchestrator callsite. */
export function buildQuoteBuilderPageShellProps(
  input: QuoteBuilderPageShellPropsInput,
): QuoteBuilderPageShellPropsInput {
  return input;
}
