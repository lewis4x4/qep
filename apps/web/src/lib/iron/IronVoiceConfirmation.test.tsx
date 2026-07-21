import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

import { IronVoiceConfirmation } from "./IronVoiceConfirmation";

afterEach(cleanup);

function renderConfirmation() {
  return render(
    <IronVoiceConfirmation
      intent="quote"
      canConfirm
      onIntentChange={() => {}}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
}

describe("IronVoiceConfirmation accessibility", () => {
  test("announces the async review state and moves focus into its forward control path", async () => {
    const view = render(<button type="button">Start recording</button>);
    const launchButton = screen.getByRole("button", { name: "Start recording" });
    launchButton.focus();

    view.rerender(
      <>
        <button type="button" disabled>
          Start recording
        </button>
        <IronVoiceConfirmation
          intent="quote"
          canConfirm
          onIntentChange={() => {}}
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </>,
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const panel = screen.getByRole("status");
    expect(panel.getAttribute("aria-live")).toBe("polite");
    expect(panel.getAttribute("aria-atomic")).toBe("true");
    expect(document.activeElement).toBe(panel);

    const forwardLabels = Array.from(panel.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label") ?? button.textContent?.trim(),
    );
    expect(forwardLabels).toEqual([
      "Cancel voice request",
      "Quote",
      "Note",
      "CRM update",
      "Question",
      "Confirm Quote voice request",
    ]);
  });

  test("keeps every confirmation control at the locked 44px mobile touch minimum", () => {
    renderConfirmation();

    const panel = screen.getByRole("status");
    const controls = Array.from(panel.querySelectorAll("button"));
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      expect(control.className).toContain("min-h-[44px]");
    }
    expect(screen.getByRole("button", { name: "Cancel voice request" }).className).toContain(
      "min-w-[44px]",
    );
  });
});
