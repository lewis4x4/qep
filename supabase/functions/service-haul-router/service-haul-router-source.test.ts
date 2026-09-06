const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("service-haul-router prices H7.1 hauls through the rate-sheet RPC", () => {
  for (
    const expected of [
      "service_calculate_haul_charge",
      "truck_class",
      "mileage_one_way",
      "round_trip_miles",
      "mileage_source",
      "mileage_provider_trip_id",
      "haul_total_cents",
      "haul_cost_cents",
      "rate_calc",
      "reveal_gps_manual_fallback",
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(`Expected haul router source to include ${expected}`);
    }
  }
});

Deno.test("service-haul-router persists schedule, driver, and advisor dispatch fields", () => {
  for (
    const expected of [
      "scheduled_start_at",
      "scheduled_end_at",
      "driver_id",
      "coordinator_id",
      "service_advisor_id",
      "field_site_location",
      "field_site_contact_name",
      "field_site_contact_phone",
      'department: "service"',
    ]
  ) {
    if (!source.includes(expected)) {
      throw new Error(
        `Expected haul router dispatch source to include ${expected}`,
      );
    }
  }
});

Deno.test("haul pricing fails explicitly without an approved sheet",()=>{
 if(source.includes("edge_fallback_legacy_minimum") || source.includes("perHaulMinimumCents: 50000")) throw new Error("Manufactured haul fallback returned");
 if(!source.includes("No approved haul price")) throw new Error("Missing actionable pricing failure");
});
