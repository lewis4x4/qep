import { assertEquals } from "jsr:@std/assert@1";
import {
  classifyPersona,
  computeCustomerDnaMetrics,
} from "./customer-dna-logic.ts";

Deno.test("computeCustomerDnaMetrics aggregates history values", () => {
  const metrics = computeCustomerDnaMetrics(
    [
      {
        outcome: "won",
        sold_price: 120000,
        discount_pct: 8,
        financing_used: true,
        attachments_sold: 1,
        service_contract_sold: true,
        days_to_close: 12,
        deal_date: "2026-03-01T00:00:00.000Z",
      },
      {
        outcome: "won",
        sold_price: 80000,
        discount_pct: 6,
        financing_used: false,
        attachments_sold: 0,
        service_contract_sold: false,
        days_to_close: 18,
        deal_date: "2026-02-01T00:00:00.000Z",
      },
    ],
    [],
  );

  assertEquals(metrics.totalDeals, 2);
  assertEquals(metrics.wonDeals, 2);
  assertEquals(metrics.totalLifetimeValue, 200000);
  assertEquals(metrics.avgDealSize, 100000);
  assertEquals(metrics.avgDaysToClose, 15);
});

Deno.test("classifyPersona returns null persona for empty history", () => {
  const persona = classifyPersona({
    totalDeals: 0,
    wonDeals: 0,
    totalLifetimeValue: 0,
    avgDealSize: null,
    avgDiscountPct: null,
    avgDaysToClose: null,
    attachmentRate: null,
    serviceContractRate: null,
    financingRate: null,
    priceSensitivityScore: 0,
    lastInteractionAt: null,
  });

  assertEquals(persona.persona, null);
  assertEquals(persona.confidence, 0);
});

Deno.test("classifyPersona caps cold-start confidence", () => {
  const persona = classifyPersona({
    totalDeals: 2,
    wonDeals: 1,
    totalLifetimeValue: 150000,
    avgDealSize: 75000,
    avgDiscountPct: 12,
    avgDaysToClose: 10,
    attachmentRate: 0.5,
    serviceContractRate: 0.2,
    financingRate: 0.8,
    priceSensitivityScore: 0.7,
    lastInteractionAt: "2026-03-01T00:00:00.000Z",
  });

  assertEquals(persona.confidence <= 0.4, true);
});
