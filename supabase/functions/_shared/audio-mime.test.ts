import { assertEquals } from "jsr:@std/assert@1";

import { audioExtensionFromMimeType, canonicalizeAudioMimeType } from "./audio-mime.ts";

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
});
