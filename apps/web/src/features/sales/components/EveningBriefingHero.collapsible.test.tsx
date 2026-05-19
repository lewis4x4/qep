import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EveningBriefingHero } from "./EveningBriefingHero";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("EveningBriefingHero collapsible mode", () => {
  test("shows collapse chevron when collapsible=true", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="Today's book: $1.2M"
        collapsible
        storageKey="test-key"
      />,
    );
    expect(screen.getByRole("button", { name: /collapse briefing/i })).toBeTruthy();
  });

  test("collapses on chevron click and hides the headline", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="Today's book: $1.2M"
        collapsible
        storageKey="test-key"
      />,
    );
    expect(screen.getByText("Today's book: $1.2M")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /collapse briefing/i }));
    expect(screen.queryByText("Today's book: $1.2M")).toBeNull();
    expect(screen.getByRole("button", { name: /expand briefing/i })).toBeTruthy();
  });

  test("persists collapsed state to localStorage", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="Today's book"
        collapsible
        storageKey="persisted"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /collapse briefing/i }));
    expect(window.localStorage.getItem("qep:sales:hero-collapsed:persisted")).toBe("true");
  });

  test("restores collapsed state from localStorage", () => {
    window.localStorage.setItem("qep:sales:hero-collapsed:persisted", "true");
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="Today's book: $1.2M"
        collapsible
        storageKey="persisted"
      />,
    );
    expect(screen.queryByText("Today's book: $1.2M")).toBeNull();
  });

  test("no chevron when collapsible=false (default)", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="Today's book"
      />,
    );
    expect(screen.queryByRole("button", { name: /collapse briefing/i })).toBeNull();
  });
});
