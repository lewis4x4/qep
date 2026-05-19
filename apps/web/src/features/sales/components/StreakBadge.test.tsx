import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { StreakBadge } from "./StreakBadge";

afterEach(cleanup);

describe("StreakBadge", () => {
  test("shows the cold-start prompt when the rep has never been active", () => {
    render(<StreakBadge currentStreak={0} longestStreak={0} />);
    expect(
      screen.getByText("Log a visit today to start a streak"),
    ).toBeTruthy();
    const badge = screen.getByTestId("streak-badge");
    expect(badge.getAttribute("data-state")).toBe("empty");
  });

  test("shows broken-streak copy with days-since + record when history exists", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString();
    render(
      <StreakBadge
        currentStreak={0}
        longestStreak={14}
        lastActiveAt={fourDaysAgo}
      />,
    );
    expect(screen.getByText(/4 days since last touch/)).toBeTruthy();
    expect(screen.getByText(/14-day record/)).toBeTruthy();
    const badge = screen.getByTestId("streak-badge");
    expect(badge.getAttribute("data-state")).toBe("broken");
  });

  test("uses singular 'day' when last touch was exactly one day ago", () => {
    const oneDayAgo = new Date(Date.now() - 1 * 86_400_000).toISOString();
    render(
      <StreakBadge
        currentStreak={0}
        longestStreak={5}
        lastActiveAt={oneDayAgo}
      />,
    );
    expect(screen.getByText(/1 day since last touch/)).toBeTruthy();
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
