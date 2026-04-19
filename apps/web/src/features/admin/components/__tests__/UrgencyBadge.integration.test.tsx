import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { UrgencyBadge } from "../UrgencyBadge";

/**
 * Slice 08 CP6 smoke test — verifies the happy-dom preload works end-to-end
 * for actual component rendering (not just decideAccess-style pure fns).
 * If this passes, the integration test harness is ready for CP7/CP8.
 */
describe("UrgencyBadge (integration smoke)", () => {
  test("renders 'Missing' when lastUploadedAt is null", () => {
    render(<UrgencyBadge lastUploadedAt={null} />);
    expect(screen.getByText("Missing")).toBeTruthy();
  });

  test("renders 'Fresh' for a recent upload", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    render(<UrgencyBadge lastUploadedAt={fiveDaysAgo} />);
    expect(screen.getByText("Fresh")).toBeTruthy();
  });

  test("renders 'Urgent' for a very old upload", () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    render(<UrgencyBadge lastUploadedAt={ninetyDaysAgo} />);
    expect(screen.getByText("Urgent")).toBeTruthy();
  });
});
