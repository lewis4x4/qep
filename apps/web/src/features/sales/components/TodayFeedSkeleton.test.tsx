import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import {
  HERO_COLLAPSED_MIN_HEIGHT_PX,
  HERO_EXPANDED_MIN_HEIGHT_PX,
  HERO_COLLAPSE_KEY_PREFIX,
} from "./EveningBriefingHero";
import { TodayFeedSkeleton } from "./TodayFeedSkeleton";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("TodayFeedSkeleton", () => {
  test("mirrors the expanded Today feed structure by default", () => {
    render(<TodayFeedSkeleton />);

    expect(screen.getByRole("status", { name: /loading today's agenda/i })).toBeTruthy();
    expect(screen.getByTestId("today-feed-skeleton-hero").style.minHeight).toBe(
      `${HERO_EXPANDED_MIN_HEIGHT_PX}px`,
    );
    expect(screen.getByTestId("today-feed-skeleton-narrative")).toBeTruthy();
    expect(screen.queryByTestId("oem-price-impact-card-placeholder")).toBeNull();
    expect(screen.getByTestId("today-feed-skeleton-streak")).toBeTruthy();
    expect(screen.getByTestId("today-feed-skeleton-actions")).toBeTruthy();
    expect(screen.getByTestId("today-feed-skeleton-tomorrow")).toBeTruthy();
    expect(screen.getByTestId("today-feed-skeleton-quick-tools")).toBeTruthy();
  });

  test("uses the same collapsed hero storage key as EveningBriefingHero", () => {
    window.localStorage.setItem(`${HERO_COLLAPSE_KEY_PREFIX}today-hero`, "true");

    render(<TodayFeedSkeleton />);

    expect(screen.getByTestId("today-feed-skeleton-hero").style.minHeight).toBe(
      `${HERO_COLLAPSED_MIN_HEIGHT_PX}px`,
    );
  });
});
