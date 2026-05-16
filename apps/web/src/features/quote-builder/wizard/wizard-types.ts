// QRM Quote Wizard — step types & metadata.
//
// Extracted from `QuoteBuilderV2Page.tsx` as PR 1 of the
// IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15 strangler-fig sequence.
// Pure types/data — no JSX, no side effects.

// Autosave state machine shared by the page-level autosave effect and the
// (forthcoming) `WizardStateProvider` so step components can read the
// current persistence status without prop-drilling. Promoted from
// `pages/QuoteBuilderV2Page.tsx` in PR 4.
export type AutoSaveState = "idle" | "local" | "saving" | "saved" | "error";

export type Step =
  | "customer"
  | "equipment"
  | "configure"
  | "tradeIn"
  | "pricing"
  | "promotions"
  | "financing"
  | "details"
  | "review"
  | "document"
  | "send";

export interface WizardStepMeta {
  id: Step;
  number: number;
  label: string;
  shortLabel: string;
  owner: "item-2" | "item-3" | "placeholder";
}

export const WIZARD_STEPS: readonly WizardStepMeta[] = [
  { id: "customer", number: 1, label: "Customer", shortLabel: "Customer", owner: "item-2" },
  { id: "equipment", number: 2, label: "Equipment", shortLabel: "Equipment", owner: "item-2" },
  { id: "configure", number: 3, label: "Configure", shortLabel: "Configure", owner: "item-2" },
  { id: "tradeIn", number: 4, label: "Trade-in", shortLabel: "Trade", owner: "item-2" },
  { id: "pricing", number: 5, label: "Pricing build", shortLabel: "Pricing", owner: "item-3" },
  { id: "promotions", number: 6, label: "Rebates & promos", shortLabel: "Promos", owner: "item-3" },
  { id: "financing", number: 7, label: "Financing", shortLabel: "Finance", owner: "item-3" },
  { id: "details", number: 8, label: "Quote details", shortLabel: "Details", owner: "item-3" },
  { id: "review", number: 9, label: "Review & approval", shortLabel: "Review", owner: "item-3" },
  { id: "document", number: 10, label: "Document", shortLabel: "Document", owner: "item-3" },
  { id: "send", number: 11, label: "Send & log", shortLabel: "Send", owner: "item-3" },
];

export const WIZARD_STEP_IDS: readonly Step[] = WIZARD_STEPS.map((item) => item.id);

export const STEP_LABELS: Record<Step, string> = WIZARD_STEPS.reduce((labels, item) => {
  labels[item.id] = item.label;
  return labels;
}, {} as Record<Step, string>);

export function isWizardStepId(value: string | null | undefined): value is Step {
  return Boolean(value && WIZARD_STEP_IDS.includes(value as Step));
}

export function wizardIndexForStep(step: Step): number {
  return WIZARD_STEPS.find((item) => item.id === step)?.number ?? 1;
}

export function stepForWizardIndex(index: number | null | undefined): Step | null {
  if (!Number.isFinite(index ?? NaN)) return null;
  return WIZARD_STEPS.find((item) => item.number === Number(index))?.id ?? null;
}
