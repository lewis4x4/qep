import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VoiceQuotePage } from "../VoiceQuotePage";

describe("VoiceQuotePage (integration)", () => {
  test("renders as an embedded voice-first page instead of a fullscreen drawer", () => {
    const { container } = render(
      <MemoryRouter>
        <VoiceQuotePage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Voice Quote")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Customer needs an ASV RT-135/i)).toBeNull();
    expect(container.querySelector(".fixed.inset-0.z-40")).toBeNull();
    expect(container.querySelector(".fixed.inset-y-0.right-0.z-50")).toBeNull();
  });
});
