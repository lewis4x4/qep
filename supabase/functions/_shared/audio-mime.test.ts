import { assertEquals } from "jsr:@std/assert@1";

import {
  audioExtensionFromMimeType,
  canonicalizeAudioMimeType,
  detectAudioMimeTypeFromBytes,
  isGenericAudioMimeType,
  isSupportedAudioMimeType,
  resolveAudioUploadMetadata,
} from "./audio-mime.ts";

Deno.test("canonicalizeAudioMimeType strips codec suffixes", () => {
  assertEquals(canonicalizeAudioMimeType("audio/webm;codecs=opus"), "audio/webm");
  assertEquals(canonicalizeAudioMimeType("audio/ogg; codecs=opus"), "audio/ogg");
});

Deno.test("canonicalizeAudioMimeType normalizes legacy aliases", () => {
  assertEquals(canonicalizeAudioMimeType("audio/x-wav"), "audio/wav");
  assertEquals(canonicalizeAudioMimeType("audio/x-m4a"), "audio/mp4");
});

Deno.test("audioExtensionFromMimeType keeps expected container extensions", () => {
  assertEquals(audioExtensionFromMimeType("audio/webm;codecs=opus"), "webm");
  assertEquals(audioExtensionFromMimeType("audio/ogg;codecs=opus"), "ogg");
  assertEquals(audioExtensionFromMimeType("audio/x-m4a"), "m4a");
  assertEquals(audioExtensionFromMimeType("audio/mp4"), "mp4");
  assertEquals(audioExtensionFromMimeType("audio/mp4", "recording.m4a"), "m4a");
});

Deno.test("detectAudioMimeTypeFromBytes recognizes common recording containers", () => {
  assertEquals(detectAudioMimeTypeFromBytes(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x00])), "audio/webm");
  assertEquals(detectAudioMimeTypeFromBytes(asciiBytes("OggS\0\0")), "audio/ogg");
  assertEquals(detectAudioMimeTypeFromBytes(asciiBytes("RIFF....WAVE")), "audio/wav");
  assertEquals(detectAudioMimeTypeFromBytes(asciiBytes("....ftypM4A ")), "audio/mp4");
  assertEquals(detectAudioMimeTypeFromBytes(asciiBytes("ID3\0")), "audio/mpeg");
  assertEquals(detectAudioMimeTypeFromBytes(bytes([0xff, 0xf1, 0x50, 0x80])), "audio/aac");
});

Deno.test("resolveAudioUploadMetadata prefers detected bytes over a wrong declared MIME", () => {
  const metadata = resolveAudioUploadMetadata(
    "audio/webm;codecs=opus",
    "recording.webm",
    asciiBytes("....ftypM4A "),
  );

  assertEquals(metadata.mimeType, "audio/mp4");
  assertEquals(metadata.extension, "mp4");
  assertEquals(metadata.detectedMimeType, "audio/mp4");
  assertEquals(metadata.declaredMimeType, "audio/webm");
});

Deno.test("resolveAudioUploadMetadata preserves m4a extension when declared bytes are MP4 audio", () => {
  const metadata = resolveAudioUploadMetadata(
    "",
    "recording.m4a",
    asciiBytes("....ftypM4A "),
  );

  assertEquals(metadata.mimeType, "audio/mp4");
  assertEquals(metadata.extension, "m4a");
  assertEquals(metadata.detectedMimeType, "audio/mp4");
  assertEquals(isGenericAudioMimeType(metadata.declaredMimeType), true);
});

Deno.test("resolveAudioUploadMetadata does not preserve a wrong extension for detected WebM bytes", () => {
  const metadata = resolveAudioUploadMetadata(
    "audio/mp4",
    "recording.m4a",
    bytes([0x1a, 0x45, 0xdf, 0xa3, 0x00]),
  );

  assertEquals(metadata.mimeType, "audio/webm");
  assertEquals(metadata.extension, "webm");
  assertEquals(metadata.detectedMimeType, "audio/webm");
});

Deno.test("isSupportedAudioMimeType rejects non-audio declared content types", () => {
  assertEquals(isSupportedAudioMimeType("audio/webm;codecs=opus"), true);
  assertEquals(isSupportedAudioMimeType("audio/x-m4a"), true);
  assertEquals(isSupportedAudioMimeType("text/plain"), false);
  assertEquals(isSupportedAudioMimeType("image/png"), false);
});

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value.replaceAll(".", "\0"));
}
