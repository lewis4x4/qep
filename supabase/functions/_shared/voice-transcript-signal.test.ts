import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { analyzeTranscriptSignal, isLowSignalTranscript } from "./voice-transcript-signal.ts";

Deno.test("voice transcript signal rejects empty and generic hallucination transcripts", () => {
  assertEquals(isLowSignalTranscript("", 16), true);
  assertEquals(isLowSignalTranscript("You", 21), true);
  assertEquals(isLowSignalTranscript("Thank you", 16), true);
});

Deno.test("voice transcript signal rejects two non-actionable words from longer recordings", () => {
  assertEquals(isLowSignalTranscript("hello there", 16), true);
});

Deno.test("voice transcript signal allows short actionable field notes for extraction", () => {
  assertEquals(isLowSignalTranscript("call John tomorrow", 21), false);
  assertEquals(isLowSignalTranscript("210G excavator", 16), false);
  assertEquals(isLowSignalTranscript("quote skid steer", 20), false);
});

Deno.test("voice transcript signal reports diagnostics used by failure messages", () => {
  const signal = analyzeTranscriptSignal("  You.  ");
  assertEquals(signal.normalized, "you");
  assertEquals(signal.wordCount, 1);
  assertEquals(signal.isGenericNoise, true);
});
