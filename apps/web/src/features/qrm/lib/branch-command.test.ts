import { describe, expect, test } from "bun:test";
import { summarizeBranchCommand } from "./branch-command";

describe("summarizeBranchCommand", () => {
  test("builds branch-linked logistics, readiness, and service-linked sales summaries", () => {
    const summary = summarizeBranchCommand({
      slug: "lake-city",
      displayName: "Lake City",
      trafficTickets: [
        {
          id: "tt-1",
          ticket_type: "rental",
          status: "scheduled",
          from_location: "Lake City yard",
          to_location: "Customer Site",
        },
        {
          id: "tt-2",
          ticket_type: "sale",
          status: "completed",
          from_location: "Lake City yard",
          to_location: "Customer Site",
        },
      ],
      intake: [
        {
          id: "intake-1",
          current_stage: 3,
          pdi_completed: false,
          photo_ready: false,
          ship_to_branch: "Lake City",
        },
        {
          id: "intake-2",
          current_stage: 5,
          pdi_completed: true,
          photo_ready: false,
          ship_to_branch: "Lake City",
        },
      ],
      serviceJobs: [
        { id: "sj-1", customer_id: "company-1", current_stage: "in_progress", invoice_total: 5000 },
        { id: "sj-2", customer_id: "company-2", current_stage: "paid_closed", invoice_total: 1000 },
      ],
      invoices: [
        { id: "inv-1", total: 12000, amount_paid: 6000, balance_due: 6000, status: "partial" },
      ],
      openDeals: [
        { id: "deal-1", company_id: "company-1", name: "Wheel loader", amount: 80000 },
        { id: "deal-2", company_id: "company-3", name: "Excavator", amount: 120000 },
      ],
    });

    expect(summary).toEqual({
      logisticsOpen: 1,
      rentalMoves: 1,
      readinessBlocked: 2,
      readinessInPrep: 2,
      activeServiceJobs: 1,
      serviceInvoiceValue: 6000,
      branchRevenue: 12000,
      openArBalance: 6000,
      serviceLinkedSalesCount: 1,
      serviceLinkedSalesValue: 80000,
    });
  });
});
