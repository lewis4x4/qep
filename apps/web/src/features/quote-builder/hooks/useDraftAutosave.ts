// QRM Quote Builder — debounced draft autosave hook.
//
// Introduced as PR 9 of the IRON_WIZARD_DECOMPOSITION_PLAN_2026-05-15.
// Scoped tightly to the **debounced autosave effect** that lived
// inline at lines 1663-1692 of `QuoteBuilderV2Page.tsx`. The shared
// `lastAutoSaveSignatureRef` stays page-owned because the manual
// approval-clean flow (`ensureCleanApprovalForCustomerFacing`) also
// reads/writes it; both surfaces share one ref so a manual save
// suppresses the next autosave fire and vice versa.
//
// Behavior contract preserved 1:1:
//   - When hydration hasn't completed, do nothing.
//   - When the draft isn't ready (no equipment, no customer, etc.),
//     move to "idle" if empty, otherwise "local". No save attempt.
//   - When a save or submit-for-approval is already in flight, skip.
//   - When the signature matches the last-saved signature, skip.
//   - Otherwise: 10-second debounce, then move to "saving", run save,
//     and on success update the shared signature ref + move to "saved";
//     on failure move to "error".

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { AutoSaveState } from "../wizard/wizard-types";

const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 10_000;

export type DraftAutosavePauseReason = "low_margin_reason_required";

export function draftAutosaveImmediateState(input: {
  enabled: boolean;
  draftReady: boolean;
  draftIsEmpty: boolean;
  pauseReason?: DraftAutosavePauseReason | null;
}): AutoSaveState | null {
  if (!input.enabled) return null;
  if (!input.draftReady) return input.draftIsEmpty ? "idle" : "local";
  if (input.pauseReason === "low_margin_reason_required") return "local";
  return null;
}

export interface UseDraftAutosaveInput {
  /** Don't autosave until local-draft hydration has finished. */
  enabled: boolean;
  /** packetReadiness.draft.ready — true when the draft is savable. */
  draftReady: boolean;
  /** isDraftEmpty(draft) — drives idle vs. local while !draftReady. */
  draftIsEmpty: boolean;
  /** Stable JSON signature of the draft (memoized by the page). */
  draftSignature: string;
  /** Shared signature ref — page-owned so manual saves can write it too. */
  signatureRef: MutableRefObject<string>;
  /** True when a manual save or submit-for-approval is in flight. */
  isPaused: boolean;
  /** Non-modal reason to pause autosave while keeping local draft state visible. */
  pauseReason?: DraftAutosavePauseReason | null;
  /** The save call. Resolves on success, rejects on error. */
  save: () => Promise<unknown>;
  /** Page-local autosave state setter. */
  setAutoSaveState: Dispatch<SetStateAction<AutoSaveState>>;
  /** Override the debounce window (default 10 seconds — matches existing). */
  debounceMs?: number;
}

export function useDraftAutosave({
  enabled,
  draftReady,
  draftIsEmpty,
  draftSignature,
  signatureRef,
  isPaused,
  pauseReason = null,
  save,
  setAutoSaveState,
  debounceMs = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
}: UseDraftAutosaveInput): void {
  // Stash the imperative refs so the effect deps stay focused on the
  // values that actually gate firing (signature, ready, empty, paused).
  // `save` and `setAutoSaveState` change identity across renders even
  // when their behavior is stable; without the refs the timer would
  // restart on every render, which is fine for correctness today
  // (the gates short-circuit) but adds noise that PR 18+ doesn't want
  // to inherit.
  const saveRef = useRef(save);
  const setAutoSaveStateRef = useRef(setAutoSaveState);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    setAutoSaveStateRef.current = setAutoSaveState;
  }, [setAutoSaveState]);

  useEffect(() => {
    const immediateState = draftAutosaveImmediateState({
      enabled,
      draftReady,
      draftIsEmpty,
      pauseReason,
    });
    if (!enabled) return;
    if (immediateState) {
      setAutoSaveStateRef.current(immediateState);
      return;
    }
    if (isPaused) return;
    if (signatureRef.current === draftSignature) return;

    const timer = window.setTimeout(() => {
      setAutoSaveStateRef.current("saving");
      saveRef.current()
        .then(() => {
          signatureRef.current = draftSignature;
          setAutoSaveStateRef.current("saved");
        })
        .catch(() => {
          setAutoSaveStateRef.current("error");
        });
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [enabled, draftReady, draftIsEmpty, pauseReason, draftSignature, isPaused, signatureRef, debounceMs]);
}
