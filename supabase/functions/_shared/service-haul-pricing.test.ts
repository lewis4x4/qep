import { assertEquals } from "jsr:@std/assert@1";
import { calculateServiceHaulPricing } from "./service-haul-pricing.ts";

Deno.test("H7 haul pricing doubles one-way mileage and applies the per-haul minimum", () => {
  assertEquals(
    calculateServiceHaulPricing({
      oneWayMiles: 10,
      baseRateCents: 0,
      perMileRateCents: 200,
      perHaulMinimumCents: 50000,
      roundTripMinimumMiles: 0,
    }),
    {
      oneWayMiles: 10,
      roundTripMiles: 20,
      billableMiles: 20,
      variableChargeCents: 4000,
      totalCents: 50000,
    },
  );
});

Deno.test("H7 haul pricing uses the round-trip mileage minimum when larger", () => {
  assertEquals(
    calculateServiceHaulPricing({
      oneWayMiles: 4,
      baseRateCents: 10000,
      perMileRateCents: 250,
      perHaulMinimumCents: 0,
      roundTripMinimumMiles: 25,
    }),
    {
      oneWayMiles: 4,
      roundTripMiles: 8,
      billableMiles: 25,
      variableChargeCents: 6250,
      totalCents: 16250,
    },
  );
});
