import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TomorrowFirstMove } from "./TomorrowFirstMove";
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

describe("TomorrowFirstMove", () => {
  test("renders nothing when pipeline is empty", () => {
    const { container } = render(
      <MemoryRouter>
        <TomorrowFirstMove pipeline={[]} />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-testid='tomorrow-first-move']")).toBeNull();
  });

  test("prefers closing-this-week + cooling as urgent first move", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    render(
      <MemoryRouter>
        <TomorrowFirstMove
          pipeline={[
            deal({ customer_name: "Acme", heat_status: "warm", amount: 500_000 }),
            deal({
              customer_name: "Beacon Ridge",
              heat_status: "cold",
              expected_close_on: tomorrow,
              amount: 200_000,
            }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Beacon Ridge")).toBeTruthy();
    expect(screen.getByText(/Closes this week/i)).toBeTruthy();
  });

  test("falls back to highest-value cold deal when nothing closing", () => {
    render(
      <MemoryRouter>
        <TomorrowFirstMove
          pipeline={[
            deal({ customer_name: "Small", heat_status: "cold", amount: 10_000, days_since_activity: 12 }),
            deal({ customer_name: "Big Coldie", heat_status: "cold", amount: 500_000, days_since_activity: 8 }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Big Coldie")).toBeTruthy();
    expect(screen.getByText(/Cold 8d/i)).toBeTruthy();
  });
});
