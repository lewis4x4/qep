import { describe, expect, test } from "bun:test";
import { deriveMachineLifecycleState } from "./machine-lifecycle";

describe("deriveMachineLifecycleState", () => {
  test("marks in-service assets as service recovery", () => {
    expect(
      deriveMachineLifecycleState({
        ownership: "customer_owned",
        availability: "in_service",
        openWorkOrders: 2,
        openQuotes: 0,
        pendingPartsOrders: 1,
        overdueIntervals: 0,
        tradeUpScore: 30,
      }),
    ).toMatchObject({
      phase: "service_recovery",
      label: "Service Recovery",
    });
  });

  test("marks customer-owned assets with replacement signals as customer active", () => {
    expect(
      deriveMachineLifecycleState({
        ownership: "customer_owned",
        availability: "available",
        openWorkOrders: 0,
        openQuotes: 0,
        pendingPartsOrders: 0,
        overdueIntervals: 0,
        tradeUpScore: 80,
        predictedReplacementDate: "2026-11-01T00:00:00Z",
        replacementConfidence: 78,
      }),
    ).toMatchObject({
      phase: "customer_active",
      label: "Customer Active",
    });
  });

  test("marks quoted inventory as sales motion", () => {
    expect(
      deriveMachineLifecycleState({
        ownership: "owned",
        availability: "reserved",
        openWorkOrders: 0,
        openQuotes: 1,
        pendingPartsOrders: 0,
        overdueIntervals: 0,
        tradeUpScore: 10,
      }),
    ).toMatchObject({
      phase: "sales_motion",
      label: "Sales Motion",
    });
  });

  test("marks sold or decommissioned assets as disposed", () => {
    expect(
      deriveMachineLifecycleState({
        ownership: "owned",
        availability: "sold",
        openWorkOrders: 0,
        openQuotes: 0,
        pendingPartsOrders: 0,
        overdueIntervals: 0,
        tradeUpScore: 0,
      }),
    ).toMatchObject({
      phase: "disposed",
      label: "Disposed",
    });
  });
});
