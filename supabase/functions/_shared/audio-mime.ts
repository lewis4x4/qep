export function canonicalizeAudioMimeType(mimeType: string | null | undefined): string {
  const baseType = (mimeType ?? "").split(";")[0]?.trim().toLowerCase();

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

export function audioExtensionFromMimeType(mimeType: string | null | undefined): string {
  const rawType = (mimeType ?? "").split(";")[0]?.trim().toLowerCase();

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
    case "audio/mp4":
      return "mp4";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    case "audio/ogg":
      return "ogg";
    case "audio/aac":
      return "aac";
    default:
      return "webm";
  }
}
