import { describe, expect, mock, test } from "bun:test";
import { renderHook } from "@testing-library/react";

import { useQuoteBuilderPrimaryAction } from "../useQuoteBuilderPrimaryAction";

function runPrimaryAction(overrides: Partial<Parameters<typeof useQuoteBuilderPrimaryAction>[0]> = {}) {
  const onSave = mock(() => {});
  const onSubmitApproval = mock(() => {});
  const setStep = mock(() => {});

  const { result } = renderHook(() =>
    useQuoteBuilderPrimaryAction({
      quoteStatus: "draft",
      currentStep: "review",
      approvalCaseCanSend: false,
      sendReady: false,
      canSubmitForApproval: false,
      requiresApprovalJustification: false,
      onSave,
      onSubmitApproval,
      setStep,
      ...overrides,
    }),
  );

  result.current();
  return { onSave, onSubmitApproval, setStep };
}

describe("useQuoteBuilderPrimaryAction", () => {
  test("saves when quote is sent or accepted", () => {
    const { onSave, onSubmitApproval, setStep } = runPrimaryAction({ quoteStatus: "sent" });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSubmitApproval).not.toHaveBeenCalled();
    expect(setStep).not.toHaveBeenCalled();
  });

  test("routes to Review when approval case can send and packet is ready", () => {
    const { onSave, setStep } = runPrimaryAction({
      approvalCaseCanSend: true,
      sendReady: true,
    });
    expect(setStep).toHaveBeenCalledWith("review");
    expect(onSave).not.toHaveBeenCalled();
  });

  test("submits approval when eligible from Review without a required low-margin reason", () => {
    const { onSave, onSubmitApproval } = runPrimaryAction({ canSubmitForApproval: true, currentStep: "review" });
    expect(onSubmitApproval).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("routes approval submission to Review when not already on Review", () => {
    const { onSave, onSubmitApproval, setStep } = runPrimaryAction({
      canSubmitForApproval: true,
      currentStep: "pricing",
    });
    expect(setStep).toHaveBeenCalledWith("review");
    expect(onSubmitApproval).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("does not bypass required low-margin justification from the global CTA", () => {
    const { onSave, onSubmitApproval, setStep } = runPrimaryAction({
      canSubmitForApproval: true,
      currentStep: "review",
      requiresApprovalJustification: true,
    });
    expect(setStep).toHaveBeenCalledWith("review");
    expect(onSubmitApproval).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("routes to Review instead of submitting while margin floor policy is unresolved", () => {
    const { onSave, onSubmitApproval, setStep } = runPrimaryAction({
      canSubmitForApproval: true,
      currentStep: "pricing",
      requiresApprovalJustification: true,
    });
    expect(setStep).toHaveBeenCalledWith("review");
    expect(onSubmitApproval).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("defaults to save", () => {
    const { onSave } = runPrimaryAction();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
