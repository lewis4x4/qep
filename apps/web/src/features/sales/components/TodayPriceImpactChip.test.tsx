import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  TodayPriceImpactChip,
  TodayPriceImpactChipError,
  TodayPriceImpactChipLoading,
} from "./TodayPriceImpactChip";

afterEach(cleanup);

describe("TodayPriceImpactChip", () => {
  test("quiet impacts render no chip", () => {
    const { container } = render(
      <TodayPriceImpactChip
        summary={{
          visibleImpactCount: 0,
          affectedQuoteCount: 0,
          totalDeltaCents: 0,
          needsApprovalCount: 0,
        }}
        onReview={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("material impacts expose a tappable no-auto-send path", () => {
    const onReview = mock(() => undefined);
    render(
      <TodayPriceImpactChip
        summary={{
          visibleImpactCount: 2,
          affectedQuoteCount: 2,
          totalDeltaCents: 845_000,
          needsApprovalCount: 1,
        }}
        onReview={onReview}
      />,
    );

    const chip = screen.getByRole("button", {
      name: /review 2 quotes affected by an OEM price update/i,
    });
    expect(screen.getByText(/2 quotes · \+\$8.4K exposure/i)).toBeTruthy();
    expect(screen.getByText(/never auto-sent/i)).toBeTruthy();
    fireEvent.click(chip);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  test("loading and failure states are announced accessibly", () => {
    const { rerender } = render(<TodayPriceImpactChipLoading />);
    expect(screen.getByRole("status", { name: /checking OEM price impacts/i })).toBeTruthy();

    const onRetry = mock(() => undefined);
    rerender(<TodayPriceImpactChipError onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
