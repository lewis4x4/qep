import { afterEach, describe, expect, test } from "bun:test";
import {
  chooseRecordingFormat,
  inferAudioMimeTypeFromFileName,
  makeBrowserPlayableAudioBlob,
} from "./audio-recording-format";

const originalMediaRecorder = globalThis.MediaRecorder;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;

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

function installNavigatorMock(userAgent: string, vendor = "Google Inc."): void {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent, vendor },
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
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

describe("audio-recording-format", () => {
  test("prefers replay-safe webm when a non-Safari browser can record and preview it", () => {
    installNavigatorMock("Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36");
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

  test("prefers m4a on Safari when mp4 and webm both appear supported", () => {
    installNavigatorMock(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      "Apple Computer, Inc.",
    );
    installMediaRecorderMock(["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus"]);
    installAudioPreviewMock([
      "audio/webm; codecs=opus",
      "audio/webm",
      "audio/mp4; codecs=mp4a.40.2",
      "audio/mp4",
    ]);

    expect(chooseRecordingFormat()?.fileName).toBe("recording.m4a");
    expect(chooseRecordingFormat()?.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  test("falls back to m4a when webm is unsupported", () => {
    installNavigatorMock("Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36");
    installMediaRecorderMock(["audio/mp4;codecs=mp4a.40.2"]);
    installAudioPreviewMock(["audio/mp4; codecs=mp4a.40.2", "audio/mp4"]);

    expect(chooseRecordingFormat()?.fileName).toBe("recording.m4a");
    expect(chooseRecordingFormat()?.mimeType).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  test("infers audio MIME type from stored recording filenames", () => {
    expect(inferAudioMimeTypeFromFileName("user/note.webm?token=abc")).toBe("audio/webm");
    expect(inferAudioMimeTypeFromFileName("user/note.m4a")).toBe("audio/mp4");
    expect(inferAudioMimeTypeFromFileName("user/note.ogg")).toBe("audio/ogg");
    expect(inferAudioMimeTypeFromFileName("user/note.bin")).toBeNull();
  });

  test("retypes generic storage blobs for browser playback", () => {
    const storedBlob = new Blob(["audio-bytes"], { type: "application/octet-stream" });
    const playableBlob = makeBrowserPlayableAudioBlob(storedBlob, {
      contentType: "application/octet-stream",
      fileName: "user/note.m4a",
    });

    expect(playableBlob.type).toBe("audio/mp4");
    expect(playableBlob.size).toBe(storedBlob.size);
  });
});
