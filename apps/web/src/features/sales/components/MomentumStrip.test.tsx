import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MomentumStrip } from "./MomentumStrip";
import type { RepPipelineDeal } from "../lib/types";

afterEach(cleanup);

function makeDeal(overrides: Partial<RepPipelineDeal> = {}): RepPipelineDeal {
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

describe("MomentumStrip", () => {
  test("shows Day 1 framing when pipeline is empty", () => {
    render(<MomentumStrip pipeline={[]} quotesThisWeek={0} />);
    expect(screen.getByText("Day 1")).toBeTruthy();
    expect(screen.queryByText("$0")).toBeNull();
  });

  test("formats pipeline value in $K when populated", () => {
    render(
      <MomentumStrip
        pipeline={[
          makeDeal({ amount: 250_000 }),
          makeDeal({ amount: 150_000 }),
        ]}
        quotesThisWeek={3}
      />,
    );
    expect(screen.getByText("$400K")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  test("formats pipeline value in $M when over a million", () => {
    render(
      <MomentumStrip
        pipeline={[makeDeal({ amount: 1_500_000 })]}
        quotesThisWeek={0}
      />,
    );
    expect(screen.getByText("$1.5M")).toBeTruthy();
  });

  test("hides quote count when zero", () => {
    render(
      <MomentumStrip
        pipeline={[makeDeal({ amount: 50_000 })]}
        quotesThisWeek={0}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
