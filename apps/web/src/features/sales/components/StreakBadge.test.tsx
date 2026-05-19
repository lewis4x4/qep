import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { StreakBadge } from "./StreakBadge";

afterEach(cleanup);

describe("StreakBadge", () => {
  test("shows the no-streak prompt when currentStreak is 0", () => {
    render(<StreakBadge currentStreak={0} longestStreak={0} />);
    expect(
      screen.getByText("Log a visit today to start a streak"),
    ).toBeTruthy();
    const badge = screen.getByTestId("streak-badge");
    expect(badge.getAttribute("data-state")).toBe("empty");
  });

  test("shows active-streak copy when streak is below personal best", () => {
    render(<StreakBadge currentStreak={3} longestStreak={10} />);
    expect(screen.getByText("3-day streak")).toBeTruthy();
    expect(screen.queryByText(/personal best/)).toBeNull();
    expect(screen.queryByText(/1 from your record/)).toBeNull();
    const badge = screen.getByTestId("streak-badge");
    expect(badge.getAttribute("data-state")).toBe("active");
  });

  test("flags personal-best when currentStreak ties or exceeds longestStreak", () => {
    render(<StreakBadge currentStreak={7} longestStreak={7} />);
    expect(screen.getByText("7-day streak")).toBeTruthy();
    expect(screen.getByText(/personal best/)).toBeTruthy();
    const badge = screen.getByTestId("streak-badge");
    expect(badge.getAttribute("data-state")).toBe("personal-best");
  });

  test("flags one-from-record when currentStreak is exactly one shy", () => {
    render(<StreakBadge currentStreak={6} longestStreak={7} />);
    expect(screen.getByText("6-day streak")).toBeTruthy();
    expect(screen.getByText(/1 from your record/)).toBeTruthy();
    const badge = screen.getByTestId("streak-badge");
    expect(badge.getAttribute("data-state")).toBe("one-from-record");
  });

  test("renders a pulsing skeleton when isLoading", () => {
    render(
      <StreakBadge currentStreak={0} longestStreak={0} isLoading />,
    );
    expect(screen.getByTestId("streak-badge-loading")).toBeTruthy();
    expect(screen.queryByTestId("streak-badge")).toBeNull();
  });
});
