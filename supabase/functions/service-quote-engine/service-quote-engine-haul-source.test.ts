const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("service-quote-engine uses linked H7.1 traffic-ticket haul totals", () => {
  for (
    const expected of [
      "traffic_ticket_id",
      "haul_total_cents",
      "round_trip_miles",
      "traffic_ticket_rate_calc",
      "legacy_flat_fallback",
      'h7_gate: "hauling_transport_dispatch"',
      "Equipment Transport - ${truckClass}",
      "mileage_source",
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(`Expected quote engine source to include ${expected}`);
    }
  }
});

Deno.test("service-quote-engine no longer emits a hardcoded haul-only quote line", () => {
  const hardcodedFlatLine = [
    'line_type: "haul"',
    'description: "Equipment Transport"',
    "quantity: 1",
    "unit_price: 500",
    "extended_price: 500",
  ].join("");
  const compactSource = source.replace(/\s+/g, "");
  if (compactSource.includes(hardcodedFlatLine.replace(/\s+/g, ""))) {
    throw new Error(
      "Expected haul quote line to come from traffic-ticket pricing, not the old flat hardcoded line",
    );
  }
});

Deno.test("service-quote-engine adds H15 field mileage as an optional charge", () => {
  for (
    const expected of [
      "field_mileage_miles",
      "field_mileage_source",
      'line_type: "optional"',
      'h15_gate: "reveal_gps_manual_fallback"',
      "Field Mileage - ${sourceLabel}",
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(
        `Expected quote engine H15 field mileage source to include ${expected}`,
      );
    }
  }
});
