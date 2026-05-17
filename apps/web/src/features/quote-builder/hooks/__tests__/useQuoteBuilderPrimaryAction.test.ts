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
      approvalCaseCanSend: false,
      sendReady: false,
      canSubmitForApproval: false,
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

  test("opens document when approval case can send and packet is ready", () => {
    const { onSave, setStep } = runPrimaryAction({
      approvalCaseCanSend: true,
      sendReady: true,
    });
    expect(setStep).toHaveBeenCalledWith("document");
    expect(onSave).not.toHaveBeenCalled();
  });

  test("submits approval when eligible", () => {
    const { onSave, onSubmitApproval } = runPrimaryAction({ canSubmitForApproval: true });
    expect(onSubmitApproval).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("defaults to save", () => {
    const { onSave } = runPrimaryAction();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
