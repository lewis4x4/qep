import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileVoiceMicButton } from "./MobileVoiceMicButton";

afterEach(cleanup);

describe("MobileVoiceMicButton", () => {
  test("idle state announces 'Start recording' to screen readers", () => {
    render(<MobileVoiceMicButton state="idle" />);
    const button = screen.getByTestId("mobile-voice-mic-button");
    expect(button.getAttribute("aria-label")).toBe("Start recording");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("data-state")).toBe("idle");
  });

  test("recording state sets aria-pressed=true and announces 'Stop recording'", () => {
    render(<MobileVoiceMicButton state="recording" />);
    const button = screen.getByTestId("mobile-voice-mic-button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Stop recording");
  });

  test("processing state is disabled and aria-busy", () => {
    render(<MobileVoiceMicButton state="processing" />);
    const button = screen.getByTestId("mobile-voice-mic-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  test("error state announces 'Tap to retry'", () => {
    render(<MobileVoiceMicButton state="error" />);
    const status = screen.getByTestId("mobile-voice-mic-status");
    expect(status.textContent).toBe("Tap to retry");
  });

  test("invokes onClick when tapped from idle state", () => {
    let tapped = 0;
    render(<MobileVoiceMicButton state="idle" onClick={() => tapped++} />);
    fireEvent.click(screen.getByTestId("mobile-voice-mic-button"));
    expect(tapped).toBe(1);
  });

  test("does not invoke onClick while processing", () => {
    let tapped = 0;
    render(<MobileVoiceMicButton state="processing" onClick={() => tapped++} />);
    fireEvent.click(screen.getByTestId("mobile-voice-mic-button"));
    expect(tapped).toBe(0);
  });

  test("clamps size to [96, 128]", () => {
    const { rerender } = render(<MobileVoiceMicButton state="idle" size={40} />);
    let button = screen.getByTestId("mobile-voice-mic-button");
    expect(button.style.width).toBe("96px");
    expect(button.style.height).toBe("96px");

    rerender(<MobileVoiceMicButton state="idle" size={300} />);
    button = screen.getByTestId("mobile-voice-mic-button");
    expect(button.style.width).toBe("128px");
  });
});
