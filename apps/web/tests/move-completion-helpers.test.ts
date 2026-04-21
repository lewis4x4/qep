import { describe, expect, it } from "bun:test";
import {
  humanizeTouchChannel,
  isValidTouchChannel,
  parseDurationToSeconds,
  sanitizeTouchSummary,
  TOUCH_CHANNEL_OPTIONS,
} from "../src/features/qrm/components/moveCompletionHelpers";

describe("TOUCH_CHANNEL_OPTIONS", () => {
  it("exposes one option per server channel", () => {
    // Stays in lockstep with the DB enum. If this fails, update both.
    const expected = [
      "call",
      "email",
      "meeting",
      "sms",
      "field_visit",
      "voice_note",
      "chat",
      "other",
    ];
    expect(TOUCH_CHANNEL_OPTIONS.map((o) => o.value).sort()).toEqual(expected.sort());
  });
  it("every option has a human label", () => {
    for (const opt of TOUCH_CHANNEL_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isValidTouchChannel", () => {
  it("accepts every known channel", () => {
    for (const opt of TOUCH_CHANNEL_OPTIONS) {
      expect(isValidTouchChannel(opt.value)).toBe(true);
    }
  });
  it("rejects unknown strings", () => {
    expect(isValidTouchChannel("smoke_signal")).toBe(false);
    expect(isValidTouchChannel("")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isValidTouchChannel(42)).toBe(false);
    expect(isValidTouchChannel(null)).toBe(false);
    expect(isValidTouchChannel(undefined)).toBe(false);
  });
});

describe("sanitizeTouchSummary", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeTouchSummary("  hello\n\n world   ")).toBe("hello world");
  });
  it("caps to maxChars with an ellipsis", () => {
    const long = "a".repeat(500);
    const out = sanitizeTouchSummary(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });
  it("returns empty string for non-string input", () => {
    // @ts-expect-error — force bad input
    expect(sanitizeTouchSummary(null)).toBe("");
  });
  it("returns the original when under the cap", () => {
    expect(sanitizeTouchSummary("short note")).toBe("short note");
  });
});

describe("parseDurationToSeconds", () => {
  it("treats plain digits as minutes", () => {
    expect(parseDurationToSeconds("8")).toBe(480);
  });
  it("parses '<n>m' as minutes", () => {
    expect(parseDurationToSeconds("8m")).toBe(480);
  });
  it("parses '<n>h' as hours", () => {
    expect(parseDurationToSeconds("2h")).toBe(7_200);
  });
  it("parses '<n>h<m>m' as combined", () => {
    expect(parseDurationToSeconds("1h30m")).toBe(5_400);
  });
  it("returns null on empty / whitespace", () => {
    expect(parseDurationToSeconds("")).toBeNull();
    expect(parseDurationToSeconds("   ")).toBeNull();
  });
  it("returns null on garbage", () => {
    expect(parseDurationToSeconds("forever")).toBeNull();
    expect(parseDurationToSeconds("8mins")).toBeNull();
    expect(parseDurationToSeconds("1h90")).toBeNull();
  });
  it("is case-insensitive", () => {
    expect(parseDurationToSeconds("1H30M")).toBe(5_400);
  });
});

describe("humanizeTouchChannel", () => {
  it("returns the canonical label for known channels", () => {
    expect(humanizeTouchChannel("call")).toBe("Call");
    expect(humanizeTouchChannel("field_visit")).toBe("Field visit");
  });
  it("title-cases unknown channels instead of throwing", () => {
    expect(humanizeTouchChannel("carrier_pigeon")).toBe("Carrier Pigeon");
  });
});
