export interface AudioUploadMetadata {
  mimeType: string;
  extension: string;
  detectedMimeType: string | null;
  declaredMimeType: string | null;
  fileNameExtension: string | null;
}

const SUPPORTED_AUDIO_EXTENSIONS = new Set(["webm", "ogg", "mp4", "m4a", "mp3", "wav", "aac"]);
const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/aac",
]);
const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export function canonicalizeAudioMimeType(mimeType: string | null | undefined): string {
  const baseType = baseMimeType(mimeType);

  switch (baseType) {
    case "audio/webm":
    case "audio/ogg":
    case "audio/mp4":
    case "audio/mpeg":
    case "audio/wav":
    case "audio/aac":
      return baseType;
    case "audio/x-wav":
      return "audio/wav";
    case "audio/m4a":
    case "audio/x-m4a":
      return "audio/mp4";
    default:
      return baseType || "audio/webm";
  }
}

export function audioExtensionFromMimeType(
  mimeType: string | null | undefined,
  fileName?: string | null,
): string {
  const preferredExtension = audioExtensionFromFileName(fileName);
  const rawType = baseMimeType(mimeType);

  switch (rawType) {
    case "audio/ogg":
      return "ogg";
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    default:
      break;
  }

  switch (canonicalizeAudioMimeType(mimeType)) {
    case "audio/webm":
      return "webm";
    case "audio/mp4":
      return preferredExtension === "m4a" ? "m4a" : "mp4";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "audio/aac":
      return "aac";
    default:
      return preferredExtension ?? "webm";
  }
}

export function detectAudioMimeTypeFromBytes(bytes: ArrayBuffer | Uint8Array): string | null {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < 4) return null;

  if (view[0] === 0x1a && view[1] === 0x45 && view[2] === 0xdf && view[3] === 0xa3) {
    return "audio/webm";
  }

  if (ascii(view, 0, 4) === "OggS") {
    return "audio/ogg";
  }

  if (view.length >= 12 && ascii(view, 0, 4) === "RIFF" && ascii(view, 8, 4) === "WAVE") {
    return "audio/wav";
  }

  if (view.length >= 12 && ascii(view, 4, 4) === "ftyp") {
    return "audio/mp4";
  }

  if (looksLikeAacAdtsFrame(view)) {
    return "audio/aac";
  }

  if (ascii(view, 0, 3) === "ID3" || looksLikeMp3Frame(view)) {
    return "audio/mpeg";
  }

  return null;
}

export function resolveAudioUploadMetadata(
  declaredMimeType: string | null | undefined,
  fileName: string | null | undefined,
  bytes: ArrayBuffer | Uint8Array,
): AudioUploadMetadata {
  const declaredBase = baseMimeType(declaredMimeType);
  const detectedMimeType = detectAudioMimeTypeFromBytes(bytes);
  const fileNameExtension = audioExtensionFromFileName(fileName);
  const mimeType = detectedMimeType ?? canonicalizeAudioMimeType(declaredBase || mimeTypeFromExtension(fileNameExtension));

  return {
    mimeType,
    extension: audioExtensionFromMimeType(mimeType, fileName),
    detectedMimeType,
    declaredMimeType: declaredBase || null,
    fileNameExtension,
  };
}

export function isGenericAudioMimeType(mimeType: string | null | undefined): boolean {
  return GENERIC_MIME_TYPES.has(baseMimeType(mimeType));
}

export function isSupportedAudioMimeType(mimeType: string | null | undefined): boolean {
  return SUPPORTED_AUDIO_MIME_TYPES.has(canonicalizeAudioMimeType(mimeType));
}

function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function audioExtensionFromFileName(fileName: string | null | undefined): string | null {
  const extension = fileName?.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? null;
  return extension && SUPPORTED_AUDIO_EXTENSIONS.has(extension) ? extension : null;
}

function mimeTypeFromExtension(extension: string | null): string | null {
  switch (extension) {
    case "webm":
      return "audio/webm";
    case "ogg":
      return "audio/ogg";
    case "mp4":
    case "m4a":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "aac":
      return "audio/aac";
    default:
      return null;
  }
}

function ascii(view: Uint8Array, offset: number, length: number): string {
  if (view.length < offset + length) return "";
  return String.fromCharCode(...view.slice(offset, offset + length));
}

function looksLikeMp3Frame(view: Uint8Array): boolean {
  return view.length >= 2 && view[0] === 0xff && (view[1] & 0xe0) === 0xe0;
}

function looksLikeAacAdtsFrame(view: Uint8Array): boolean {
  return view.length >= 2 && view[0] === 0xff && (view[1] & 0xf6) === 0xf0;
}
