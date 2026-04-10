import { describe, expect, it } from "bun:test";
import {
  buildServiceToSalesBoard,
  type ServiceToSalesFleetSignal,
  type ServiceToSalesJob,
  type ServiceToSalesMachine,
} from "./service-to-sales";

const machines: ServiceToSalesMachine[] = [
  {
    id: "eq-1",
    companyId: "company-1",
    name: "CAT 320",
    make: "CAT",
    model: "320",
    year: 2021,
    ownership: "customer_owned",
    engineHours: 4100,
    currentMarketValue: 160000,
    replacementCost: 220000,
  },
  {
    id: "eq-2",
    companyId: "company-2",
    name: "Bobcat T66",
    make: "Bobcat",
    model: "T66",
    year: 2023,
    ownership: "owned",
    engineHours: 900,
    currentMarketValue: 52000,
    replacementCost: 65000,
  },
];

const jobs: ServiceToSalesJob[] = [
  {
    id: "job-1",
    customerId: "company-1",
    machineId: "eq-1",
    currentStage: "in_progress",
    scheduledEndAt: "2026-04-08T12:00:00.000Z",
    createdAt: "2026-03-01T12:00:00.000Z",
    customerProblemSummary: "Hydraulic leak",
    invoiceTotal: 4200,
  },
  {
    id: "job-2",
    customerId: "company-1",
    machineId: "eq-1",
    currentStage: "closed",
    scheduledEndAt: "2026-02-15T12:00:00.000Z",
    createdAt: "2026-02-10T12:00:00.000Z",
    customerProblemSummary: "Hydraulic leak",
    invoiceTotal: 3800,
  },
  {
    id: "job-3",
    customerId: "company-1",
    machineId: "eq-1",
    currentStage: "invoiced",
    scheduledEndAt: "2025-11-15T12:00:00.000Z",
    createdAt: "2025-11-10T12:00:00.000Z",
    customerProblemSummary: "Track tension issue",
    invoiceTotal: 2500,
  },
];

const signals: ServiceToSalesFleetSignal[] = [
  {
    equipmentSerial: null,
    make: "CAT",
    model: "320",
    year: 2021,
    predictedReplacementDate: "2026-06-01",
    replacementConfidence: 0.82,
    outreachStatus: "pending",
    outreachDealValue: 195000,
  },
];

describe("buildServiceToSalesBoard", () => {
  it("promotes recurring customer-owned service pain into replacement cases", () => {
    const board = buildServiceToSalesBoard(jobs, machines, signals, Date.parse("2026-04-10T12:00:00.000Z"));

    expect(board.summary.totalCases).toBe(1);
    expect(board.summary.highPressureCases).toBe(1);
    expect(board.summary.overdueCases).toBe(1);
    expect(board.summary.openRevenueCandidates).toBe(1);
    expect(board.cases[0]?.machineId).toBe("eq-1");
    expect(board.cases[0]?.tradePressure).toBe("high");
    expect(board.cases[0]?.reasons.join(" | ")).toContain("3 service jobs");
    expect(board.cases[0]?.reasons.join(" | ")).toContain("overdue open service job");
    expect(board.cases[0]?.reasons.join(" | ")).toContain("replacement confidence 82%");
  });

  it("ignores non-customer-owned machines and weak one-off service activity", () => {
    const board = buildServiceToSalesBoard([
      {
        id: "job-4",
        customerId: "company-2",
        machineId: "eq-2",
        currentStage: "closed",
        scheduledEndAt: null,
        createdAt: "2026-04-01T12:00:00.000Z",
        customerProblemSummary: "Minor service",
        invoiceTotal: 400,
      },
    ], machines, [], Date.parse("2026-04-10T12:00:00.000Z"));

    expect(board.summary.totalCases).toBe(0);
    expect(board.cases).toHaveLength(0);
  });
});
