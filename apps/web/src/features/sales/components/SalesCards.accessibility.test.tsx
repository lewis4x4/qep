import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PriorityAction, RepCustomer, RepPipelineDeal } from "../lib/types";

const toastMock = mock(() => undefined);
const activityInserts: Array<Record<string, unknown>> = [];

function makeSupabaseChain() {
  const chain: Record<string, unknown> = {};
  chain.select = mock(() => chain);
  chain.eq = mock(() => chain);
  chain.maybeSingle = mock(async () => ({
    data: { active_workspace_id: "ws-1" },
    error: null,
  }));
  chain.insert = mock(async (payload: Record<string, unknown>) => {
    activityInserts.push(payload);
    return { error: null };
  });
  return chain;
}

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: mock(async () => ({ data: { user: { id: "rep-1" } } })) },
    from: mock(() => makeSupabaseChain()),
  },
}));

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { ActionItemCard } from "./ActionItemCard";
import { SalesCustomerCard } from "./SalesCustomerCard";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  activityInserts.length = 0;
  toastMock.mockClear();
});

describe("sales card accessibility interactions", () => {
  test("SalesCustomerCard exposes a dedicated primary button and separate quick-action buttons", () => {
    const customer: RepCustomer = {
      customer_id: "cust-1",
      company_name: "Acme Equipment",
      search_1: null,
      search_2: null,
      primary_contact_name: "Alex Rep",
      primary_contact_phone: "5551112222",
      primary_contact_email: "alex@example.com",
      city: "Austin",
      state: "TX",
      open_deals: 2,
      active_quotes: 1,
      last_interaction: null,
      days_since_contact: 3,
      opportunity_score: 72,
      equipment_summary: [],
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<SalesCustomerCard customer={customer} />} />
          <Route path="/sales/customers/:id" element={<div>Customer Detail</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const primary = screen.getByRole("button", {
      name: "Open Acme Equipment customer details",
    });
    const call = screen.getByRole("button", { name: "Call" });
    const email = screen.getByRole("button", { name: "Email" });

    expect(primary.contains(call)).toBe(false);
    expect(primary.contains(email)).toBe(false);

    fireEvent.click(primary);
    expect(screen.getByText("Customer Detail")).toBeTruthy();
  });

  test("ActionItemCard quick action does not trigger context navigation", async () => {
    const action: PriorityAction = {
      type: "follow_up_overdue",
      customer_name: "Atlas Rentals",
      deal_id: "deal-1",
      summary: "Call customer today",
    };

    const deal: RepPipelineDeal = {
      deal_id: "deal-1",
      company_id: "company-1",
      customer_name: "Atlas Rentals",
      primary_contact_name: "Bob",
      primary_contact_phone: "5551113333",
      stage: "Discovery",
      stage_sort: 1,
      amount: 25000,
      deal_name: "Rental fleet refresh",
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
      expected_close_on: null,
      last_activity_at: null,
      next_follow_up_at: null,
      days_since_activity: 1,
      heat_status: "warm",
      deal_score: 80,
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ActionItemCard action={action} deal={deal} />} />
          <Route path="/sales/customers/:id" element={<div>Customer Detail</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await fireEvent.click(screen.getByRole("button", { name: "Call Bob" }));
    expect(screen.queryByText("Customer Detail")).toBeNull();
    await waitFor(() => expect(activityInserts).toHaveLength(1));
    expect(activityInserts[0]).toMatchObject({
      activity_type: "call",
      deal_id: "deal-1",
      company_id: null,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open action context for Atlas Rentals",
      }),
    );
    expect(screen.getByText("Customer Detail")).toBeTruthy();
  });
});
