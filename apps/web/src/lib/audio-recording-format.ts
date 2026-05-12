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

const SAFARI_FIRST_MIME_TYPES = new Set(["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]);

function getUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent ?? "";
}

function getNavigatorVendor(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.vendor ?? "";
}

export function isSafariLikeRecordingBrowser(userAgent = getUserAgent(), vendor = getNavigatorVendor()): boolean {
  const ua = userAgent.toLowerCase();
  const navVendor = vendor.toLowerCase();
  const isiOS = /iphone|ipad|ipod/.test(ua);
  const isSafari =
    ua.includes("safari") &&
    navVendor.includes("apple") &&
    !/(chrome|crios|fxios|edg|edgios|opr|opera|android)/.test(ua);

  // Every iOS browser uses WebKit media capture; MP4/AAC is the safer recording and replay path there.
  return isiOS || isSafari;
}

function getRecordingFormatCandidates(): RecordingFormat[] {
  if (!isSafariLikeRecordingBrowser()) return RECORDING_FORMATS;

  const safariFirst = RECORDING_FORMATS.filter((format) => SAFARI_FIRST_MIME_TYPES.has(format.mimeType));
  const remaining = RECORDING_FORMATS.filter((format) => !SAFARI_FIRST_MIME_TYPES.has(format.mimeType));
  return [...safariFirst, ...remaining];
}

export function canPreviewAudioMimeType(mimeType: string): boolean {
  if (typeof document === "undefined") return true;
  const audio = document.createElement("audio");
  return audio.canPlayType(mimeType).replace(/no/i, "").trim().length > 0;
}

export function chooseRecordingFormat(): RecordingFormat | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = getRecordingFormatCandidates();

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return candidates[0] ?? null;
  }

  const playableFormats = candidates.filter(
    (format) =>
      MediaRecorder.isTypeSupported(format.mimeType) &&
      format.previewTypes.some((previewType) => canPreviewAudioMimeType(previewType)),
  );

  if (playableFormats.length > 0) {
    return playableFormats[0];
  }

  const supportedFormat = candidates.find((format) =>
    MediaRecorder.isTypeSupported(format.mimeType),
  );

  return supportedFormat ?? null;
}

export function getFallbackRecordingFormat(): Pick<RecordingFormat, "mimeType" | "fileName"> {
  return { mimeType: "audio/webm", fileName: "recording.webm" };
}

export function inferAudioMimeTypeFromFileName(fileName: string | null | undefined): string | null {
  const lower = fileName?.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return null;
}

export function makeBrowserPlayableAudioBlob(
  blob: Blob,
  opts: { contentType?: string | null; fileName?: string | null } = {},
): Blob {
  const blobType = blob.type.toLowerCase();
  if (blobType.startsWith("audio/")) return blob;

  const contentType = opts.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType.startsWith("audio/")) return new Blob([blob], { type: contentType });

  const inferredMimeType = inferAudioMimeTypeFromFileName(opts.fileName);
  return inferredMimeType ? new Blob([blob], { type: inferredMimeType }) : blob;
}
