import { afterEach, describe, expect, test } from "bun:test";
import { chooseRecordingFormat } from "./audio-recording-format";

const originalMediaRecorder = globalThis.MediaRecorder;
const originalDocument = globalThis.document;

function installMediaRecorderMock(supportedMimeTypes: string[]): void {
  class MockMediaRecorder {
    static isTypeSupported(mimeType: string): boolean {
      return supportedMimeTypes.includes(mimeType);
    }
  }

  Object.defineProperty(globalThis, "MediaRecorder", {
    value: MockMediaRecorder,
    configurable: true,
  });
}

function installAudioPreviewMock(playableMimeTypes: string[]): void {
  Object.defineProperty(globalThis, "document", {
    value: {
      createElement: () => ({
        canPlayType: (mimeType: string) => (playableMimeTypes.includes(mimeType) ? "probably" : ""),
      }),
    },
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "MediaRecorder", {
    value: originalMediaRecorder,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: originalDocument,
    configurable: true,
  });
});

describe("audio-recording-format", () => {
  test("prefers replay-safe webm when the browser can record and preview it", () => {
    installMediaRecorderMock(["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus"]);
    installAudioPreviewMock([
      "audio/webm; codecs=opus",
      "audio/webm",
      "audio/mp4; codecs=mp4a.40.2",
      "audio/mp4",
    ]);

    expect(chooseRecordingFormat()).toEqual({
      mimeType: "audio/webm;codecs=opus",
      fileName: "recording.webm",
      previewTypes: ["audio/webm; codecs=opus", "audio/webm"],
    });
  });

  test("falls back to m4a when webm is unsupported", () => {
    installMediaRecorderMock(["audio/mp4;codecs=mp4a.40.2"]);
    installAudioPreviewMock(["audio/mp4; codecs=mp4a.40.2", "audio/mp4"]);

    expect(chooseRecordingFormat()?.fileName).toBe("recording.m4a");
    expect(chooseRecordingFormat()?.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
  });
});
