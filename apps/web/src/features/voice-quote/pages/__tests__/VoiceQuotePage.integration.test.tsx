import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VoiceQuotePage } from "../VoiceQuotePage";

describe("VoiceQuotePage (integration)", () => {
  test("renders the redesigned voice quote workflow instead of the old embedded drawer", () => {
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
    expect(screen.getByText("Option A · Value")).toBeTruthy();
    expect(screen.getByText("Recent Voice Quotes")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Customer needs an ASV RT-135/i)).toBeNull();
    expect(container.querySelector(".fixed.inset-y-0.right-0.z-50")).toBeNull();
  });

  test("opens the scenario comparison modal", () => {
    render(
      <MemoryRouter>
        <VoiceQuotePage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Compare" })[0]);

    expect(screen.getByText("Scenario comparison")).toBeTruthy();
    expect(screen.getByText("Compare machine, pricing, financing, lead time, and trade credit before opening Quote Builder.")).toBeTruthy();
  });
});
