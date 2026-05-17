import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MobileVoiceTextarea } from "../MobileVoiceTextarea";

const originalMatchMedia = window.matchMedia;
const originalSpeech = (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
const originalWebkitSpeech = (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

interface FakeRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: ((event: Event) => void) | null;
  _emitResult: (transcript: string) => void;
  _emitEnd: () => void;
}

function createFakeRecognition(): FakeRecognition {
  const rec: FakeRecognition = {
    lang: "",
    interimResults: false,
    continuous: false,
    start() {},
    stop() {
      this._emitEnd();
    },
    onresult: null,
    onerror: null,
    onend: null,
    _emitResult(transcript) {
      this.onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript }], { isFinal: true })] as unknown as ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >,
      });
    },
    _emitEnd() {
      this.onend?.(new Event("end"));
    },
  };
  return rec;
}

let lastRecognition: FakeRecognition | null = null;

function stubMatchMedia(matches: boolean): void {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = ((
    query: string,
  ) =>
    ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function installFakeSpeech() {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function FakeCtor(this: FakeRecognition) {
    Object.assign(this, createFakeRecognition());
    lastRecognition = this;
  } as unknown as new () => FakeRecognition;
}

function clearSpeech() {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
}

beforeEach(() => {
  lastRecognition = null;
  stubMatchMedia(true);
  installFakeSpeech();
});

afterEach(() => {
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMatchMedia;
  if (originalSpeech !== undefined) {
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = originalSpeech;
  } else {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  }
  if (originalWebkitSpeech !== undefined) {
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = originalWebkitSpeech;
  } else {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  }
  cleanup();
});

function ControlledHarness({ initial = "", placeholder = "type or dictate" }: { initial?: string; placeholder?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MobileVoiceTextarea
      name="notes"
      placeholder={placeholder}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

describe("MobileVoiceTextarea", () => {
  test("renders the textarea and passes through name + placeholder", () => {
    render(<ControlledHarness placeholder="describe condition" />);
    const ta = screen.getByPlaceholderText("describe condition") as HTMLTextAreaElement;
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta.name).toBe("notes");
  });

  test("mic button is visible at mobile viewport", () => {
    render(<ControlledHarness />);
    const mic = screen.getByRole("button", { name: /dictate/i });
    expect(mic).toBeTruthy();
    expect(mic.getAttribute("data-state")).toBe("idle");
  });

  test("mic button is hidden at desktop viewport", () => {
    stubMatchMedia(false);
    render(<ControlledHarness />);
    expect(screen.queryByRole("button", { name: /dictate/i })).toBeNull();
  });

  test("speech result appends transcript to existing value with a single space", () => {
    render(<ControlledHarness initial="The customer is asking" />);
    const mic = screen.getByRole("button", { name: /dictate/i });
    fireEvent.click(mic);
    expect(lastRecognition).not.toBeNull();
    act(() => {
      lastRecognition!._emitResult("about delivery timing");
    });
    const ta = screen.getByPlaceholderText("type or dictate") as HTMLTextAreaElement;
    expect(ta.value).toBe("The customer is asking about delivery timing");
  });

  test("speech result on empty textarea sets the value to the transcript", () => {
    render(<ControlledHarness />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    act(() => {
      lastRecognition!._emitResult("ready for pickup tuesday");
    });
    const ta = screen.getByPlaceholderText("type or dictate") as HTMLTextAreaElement;
    expect(ta.value).toBe("ready for pickup tuesday");
  });

  test("mic hides entirely when SpeechRecognition is not on window", () => {
    clearSpeech();
    render(<ControlledHarness />);
    expect(screen.queryByRole("button", { name: /dictate/i })).toBeNull();
  });
});
