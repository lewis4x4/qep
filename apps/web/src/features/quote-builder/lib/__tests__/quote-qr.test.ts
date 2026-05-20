import { describe, expect, test } from "bun:test";
import {
  assertSafePublicQuoteQrUrl,
  buildQuoteLandingQrData,
  withQrQuietZone,
} from "../quote-qr";

describe("quote QR URL safety", () => {
  test("allows normal public https URLs", () => {
    const parsed = assertSafePublicQuoteQrUrl("https://quotes.qep.example/public/abc");
    expect(parsed.hostname).toBe("quotes.qep.example");
  });

  test("rejects localhost/private/internal hosts", () => {
    const blocked = [
      "https://localhost:3000/quote/1",
      "https://127.0.0.1/quote/1",
      "https://10.0.0.12/quote/1",
      "https://192.168.1.9/quote/1",
      "https://169.254.1.9/quote/1",
      "https://quote-service.internal/quote/1",
    ];

    for (const url of blocked) {
      expect(() => assertSafePublicQuoteQrUrl(url)).toThrow("public hostname");
    }
  });

  test("buildQuoteLandingQrData rejects unsafe URL before QR generation", () => {
    expect(() => buildQuoteLandingQrData("https://localhost/quote/abc")).toThrow("public hostname");
  });
});

describe("quote QR quiet zone padding", () => {
  test("adds 4-module quiet zone around QR modules", () => {
    const modules = [
      [true, false],
      [false, true],
    ];
    const padded = withQrQuietZone(modules, 4);

    expect(padded.length).toBe(10);
    expect(padded[0]?.every((cell) => cell === false)).toBe(true);
    expect(padded[4]?.[4]).toBe(true);
    expect(padded[4]?.[5]).toBe(false);
    expect(padded[5]?.[4]).toBe(false);
    expect(padded[5]?.[5]).toBe(true);
  });
});
