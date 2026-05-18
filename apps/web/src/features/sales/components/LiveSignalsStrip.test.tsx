import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LiveSignalsStrip } from "./LiveSignalsStrip";
import type { RepPipelineDeal } from "../lib/types";

afterEach(cleanup);

function deal(overrides: Partial<RepPipelineDeal> = {}): RepPipelineDeal {
  return {
    deal_id: overrides.deal_id ?? crypto.randomUUID(),
    company_id: "c1",
    customer_name: "Acme",
    primary_contact_name: null,
    primary_contact_phone: null,
    stage: "qualified",
    stage_sort: 1,
    amount: 100_000,
    deal_name: "Acme — 5T forklift",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expected_close_on: null,
    last_activity_at: null,
    next_follow_up_at: null,
    days_since_activity: 2,
    heat_status: "warm",
    deal_score: 80,
    ...overrides,
  };
}

describe("LiveSignalsStrip", () => {
  test("renders nothing when no signals exist", () => {
    const { container } = render(
      <MemoryRouter>
        <LiveSignalsStrip pipeline={[deal({ heat_status: "warm", days_since_activity: 1 })]} expiringQuoteCount={0} />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-testid='live-signals-strip']")).toBeNull();
  });

  test("shows cooling + quiet chips when present", () => {
    render(
      <MemoryRouter>
        <LiveSignalsStrip
          pipeline={[
            deal({ heat_status: "cooling", days_since_activity: 20 }),
            deal({ heat_status: "cold", days_since_activity: 25 }),
          ]}
          expiringQuoteCount={0}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Cooling deals")).toBeTruthy();
    expect(screen.getByText("Quiet 14d+")).toBeTruthy();
  });

  test("shows expiring quotes chip when count > 0", () => {
    render(
      <MemoryRouter>
        <LiveSignalsStrip pipeline={[]} expiringQuoteCount={3} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Quotes expiring")).toBeTruthy();
  });
});
