import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SalesActionsBlock } from "./SalesActionsBlock";
import type { PipelineStats, RepPipelineDeal } from "../lib/types";

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

const emptyStats: PipelineStats = {
  deals_in_pipeline: 0,
  quotes_sent_this_week: 0,
  total_pipeline_value: 0,
};

describe("SalesActionsBlock", () => {
  test("renders the 02 Actions section label", () => {
    render(
      <MemoryRouter>
        <SalesActionsBlock pipeline={[]} liveStats={emptyStats} onVoiceQuote={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("02 Actions")).toBeTruthy();
  });

  test("primary action adapts to empty pipeline", () => {
    render(
      <MemoryRouter>
        <SalesActionsBlock pipeline={[]} liveStats={emptyStats} onVoiceQuote={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Start your first quote")).toBeTruthy();
    expect(screen.getByTestId("sales-primary-action").getAttribute("data-kind")).toBe("start_first_quote");
  });

  test("primary action adapts to cold deal context", () => {
    render(
      <MemoryRouter>
        <SalesActionsBlock
          pipeline={[deal({ customer_name: "Big Cold", heat_status: "cold", amount: 500_000, days_since_activity: 9 })]}
          liveStats={{ ...emptyStats, deals_in_pipeline: 1, total_pipeline_value: 500_000 }}
          onVoiceQuote={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Recover Big Cold")).toBeTruthy();
    expect(screen.getByTestId("sales-primary-action").getAttribute("data-kind")).toBe("recover_cold_deal");
  });

  test("voice quote button fires onVoiceQuote, not the primary navigation", () => {
    let voicePressed = false;
    render(
      <MemoryRouter>
        <SalesActionsBlock
          pipeline={[]}
          liveStats={emptyStats}
          onVoiceQuote={() => {
            voicePressed = true;
          }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /voice quote/i }));
    expect(voicePressed).toBe(true);
  });

  test("renders Follow-ups and Pipeline secondary tiles", () => {
    render(
      <MemoryRouter>
        <SalesActionsBlock
          pipeline={[
            deal({ next_follow_up_at: new Date().toISOString(), amount: 50_000 }),
          ]}
          liveStats={{ deals_in_pipeline: 1, quotes_sent_this_week: 0, total_pipeline_value: 50_000 }}
          onVoiceQuote={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Follow-ups")).toBeTruthy();
    expect(screen.getByText("Pipeline")).toBeTruthy();
    expect(screen.getByText("$50K")).toBeTruthy();
  });
});
