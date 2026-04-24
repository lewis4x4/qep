import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VoiceQuotePage } from "../VoiceQuotePage";

describe("VoiceQuotePage (integration)", () => {
  test("starts a first visit at Record with empty quote state", () => {
    const { container } = render(
      <MemoryRouter>
        <VoiceQuotePage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Voice Quote")).toBeTruthy();
    expect(screen.getByText("Try saying something like...")).toBeTruthy();
    expect(screen.getByText("Voice Capture")).toBeTruthy();
    expect(screen.getByText("Live Transcript")).toBeTruthy();
    expect(screen.getByText("Extracted Details")).toBeTruthy();
    expect(screen.getByText("No scenarios yet")).toBeTruthy();
    expect(screen.getByText("Extracted customer, equipment, budget, and follow-up details will appear after transcription.")).toBeTruthy();
    expect(screen.queryByText("Option A · Value")).toBeNull();
    expect(screen.queryByText("Red River Demolition")).toBeNull();
    expect(screen.getByText("Recent Voice Quotes")).toBeTruthy();
    expect(screen.getByText("Recent voice quotes will appear after real sessions are recorded or restored.")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Customer needs an ASV RT-135/i)).toBeNull();
    expect(container.querySelector(".fixed.inset-y-0.right-0.z-50")).toBeNull();
  });

  test("disables scenario comparison until real scenarios exist", () => {
    render(
      <MemoryRouter>
        <VoiceQuotePage />
      </MemoryRouter>,
    );

    const howScenariosWork = screen.getByRole("button", { name: /How scenarios work/i });
    expect(howScenariosWork.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Scenario comparison")).toBeNull();
  });
});
