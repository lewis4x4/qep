import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { AiBriefingCard } from "./AiBriefingCard";

afterEach(cleanup);

describe("AiBriefingCard", () => {
  test("uses caller-provided summary parts when supplied", () => {
    render(
      <AiBriefingCard
        firstName="Brian"
        timeOfDay="evening"
        pipelineValue={999_000}
        closingSoonCount={3}
        priorityCount={2}
        summaryParts={["$125K in QRM active pipeline", "1 at decision stage"]}
      />,
    );

    expect(screen.getByText("Good evening, Brian")).toBeTruthy();
    expect(screen.getByText("$125K in QRM active pipeline. 1 at decision stage.")).toBeTruthy();
    expect(screen.queryByText(/\$999K in active pipeline/i)).toBeNull();
  });

  test("renders explicit empty-state copy when no summary parts exist", () => {
    render(
      <AiBriefingCard
        firstName="Brian"
        timeOfDay="evening"
        pipelineValue={0}
        closingSoonCount={0}
        priorityCount={0}
        emptySummary="No active quote pressure found yet."
      />,
    );

    expect(screen.getByText("Good evening, Brian")).toBeTruthy();
    expect(screen.getByText("No active quote pressure found yet.")).toBeTruthy();
  });

  test("preserves greeting-only behavior for callers that do not opt into empty copy", () => {
    render(
      <AiBriefingCard
        firstName="Brian"
        timeOfDay="evening"
        pipelineValue={0}
        closingSoonCount={0}
        priorityCount={0}
      />,
    );

    expect(screen.getByText("Good evening, Brian")).toBeTruthy();
    expect(screen.queryByText(/No active/i)).toBeNull();
  });
});
