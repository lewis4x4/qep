import { describe, expect, test } from "bun:test";

import {
  QUOTE_EXPIRATION_DEFAULT_DAYS,
  QUOTE_FOLLOW_UP_DEFAULT_DAYS,
  buildQuoteLifecycleDefaultDates,
  isQuoteFollowUpAfterExpiration,
  quoteLifecycleWarning,
} from "../quote-lifecycle-policy";

describe("quote lifecycle policy", () => {
  test("uses QEP 30-day expiration and 3-day follow-up defaults", () => {
    const defaults = buildQuoteLifecycleDefaultDates(new Date("2026-05-20T12:00:00.000Z"));

    expect(QUOTE_EXPIRATION_DEFAULT_DAYS).toBe(30);
    expect(QUOTE_FOLLOW_UP_DEFAULT_DAYS).toBe(3);
    expect(defaults.expiresAt).toBe("2026-06-19T12:00:00.000Z");
    expect(defaults.followUpAt).toBe("2026-05-23T12:00:00.000Z");
  });

  test("detects follow-up reminders scheduled after expiration", () => {
    expect(isQuoteFollowUpAfterExpiration({
      followUpAt: "2026-06-20T09:00:00.000Z",
      expiresAt: "2026-06-19T12:00:00.000Z",
    })).toBe(true);

    expect(isQuoteFollowUpAfterExpiration({
      followUpAt: "2026-06-19T09:00:00.000Z",
      expiresAt: "2026-06-19T12:00:00.000Z",
    })).toBe(false);
  });

  test("returns actionable warning copy only for invalid lifecycle dates", () => {
    expect(quoteLifecycleWarning({
      followUpAt: "2026-06-20T09:00:00.000Z",
      expiresAt: "2026-06-19T12:00:00.000Z",
    })).toBe("Follow-up must be scheduled before the quote expiration date.");

    expect(quoteLifecycleWarning({
      followUpAt: "2026-06-18T09:00:00.000Z",
      expiresAt: "2026-06-19T12:00:00.000Z",
    })).toBeNull();
  });
});
