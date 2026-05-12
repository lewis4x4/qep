export interface RecordingFormat {
  mimeType: string;
  fileName: string;
  previewTypes: string[];
}

export const RECORDING_FORMATS: RecordingFormat[] = [
  {
    mimeType: "audio/webm;codecs=opus",
    fileName: "recording.webm",
    previewTypes: ["audio/webm; codecs=opus", "audio/webm"],
  },
  {
    mimeType: "audio/webm",
    fileName: "recording.webm",
    previewTypes: ["audio/webm"],
  },
  {
    mimeType: "audio/mp4;codecs=mp4a.40.2",
    fileName: "recording.m4a",
    previewTypes: ["audio/mp4; codecs=mp4a.40.2", "audio/mp4", "audio/aac"],
  },
  {
    mimeType: "audio/mp4",
    fileName: "recording.m4a",
    previewTypes: ["audio/mp4", "audio/aac"],
  },
  {
    mimeType: "audio/ogg;codecs=opus",
    fileName: "recording.ogg",
    previewTypes: ["audio/ogg; codecs=opus", "audio/ogg"],
  },
];

export function canPreviewAudioMimeType(mimeType: string): boolean {
  if (typeof document === "undefined") return true;
  const audio = document.createElement("audio");
  return audio.canPlayType(mimeType).replace(/no/i, "").trim().length > 0;
}

export function chooseRecordingFormat(): RecordingFormat | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return RECORDING_FORMATS[0] ?? null;
  }

  const playableFormats = RECORDING_FORMATS.filter(
    (format) =>
      MediaRecorder.isTypeSupported(format.mimeType) &&
      format.previewTypes.some((previewType) => canPreviewAudioMimeType(previewType)),
  );

  if (playableFormats.length > 0) {
    return playableFormats[0];
  }

  const supportedFormat = RECORDING_FORMATS.find((format) =>
    MediaRecorder.isTypeSupported(format.mimeType),
  );

  return supportedFormat ?? null;
}

export function getFallbackRecordingFormat(): Pick<RecordingFormat, "mimeType" | "fileName"> {
  return { mimeType: "audio/webm", fileName: "recording.webm" };
}
