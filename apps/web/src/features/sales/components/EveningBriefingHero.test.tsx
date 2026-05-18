import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { EveningBriefingHero } from "./EveningBriefingHero";

afterEach(cleanup);

describe("EveningBriefingHero", () => {
  test("renders personalized greeting when firstName is given", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="Today's book: $1.2M across 8 deals."
        followup="Tomorrow: 2 closing this week."
        assistantStatus="Briefing tomorrow"
      />,
    );
    expect(screen.getByText("Good evening, Brian")).toBeTruthy();
    expect(screen.getByText("Today's book: $1.2M across 8 deals.")).toBeTruthy();
    expect(screen.getByText("Tomorrow: 2 closing this week.")).toBeTruthy();
  });

  test("greets without name when firstName is null (placeholder protection)", () => {
    render(
      <EveningBriefingHero
        firstName={null}
        timeOfDay="evening"
        headline={null}
      />,
    );
    expect(screen.getByText("Good evening")).toBeTruthy();
    expect(screen.queryByText(/, Sales/i)).toBeNull();
  });

  test("changes label & voice prompt with time of day", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="morning"
        headline="Ready to roll."
        onVoicePress={() => {}}
      />,
    );
    expect(screen.getByText("Morning Briefing")).toBeTruthy();
    expect(screen.getByText("Hold to plan the day")).toBeTruthy();
  });

  test("voice button fires handler when provided", () => {
    let pressed = false;
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="hi"
        onVoicePress={() => {
          pressed = true;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(pressed).toBe(true);
  });

  test("omits voice button entirely when no handler provided", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="hi"
      />,
    );
    expect(screen.queryByRole("button", { name: /dictate/i })).toBeNull();
  });

  test("shows assistant status dot copy when provided", () => {
    render(
      <EveningBriefingHero
        firstName="Brian"
        timeOfDay="evening"
        headline="hi"
        assistantStatus="Scoring deals"
      />,
    );
    expect(screen.getByText("Scoring deals")).toBeTruthy();
  });
});
