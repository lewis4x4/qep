import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  H2_SERVICE_PRIORITIES,
  H2_SERVICE_REQUEST_TYPES,
  H2_SERVICE_SOURCE_TYPES,
  isH2GrappleTruck,
  validateH2ServiceJobIntake,
} from "./service-intake-hardening.ts";

const COMPLETE_MACHINE = {
  id: "machine-1",
  name: "ASV RT-75",
  make: "ASV",
  model: "RT-75",
  serial_number: "ASV123",
  year: 2024,
  category: "skid_steer",
  metadata: {},
};

const COMPLETE_BODY = {
  machine_id: "machine-1",
  source_type: "call",
  request_type: "repair",
  priority: "normal",
  hour_meter_reading: 1234.5,
  promised_at: "2026-06-15T12:00:00.000Z",
  complaint: "Customer reports hydraulic leak.",
  cause: "Initial intake suspects failed hose.",
  correction: "Inspect hydraulics and replace failed component.",
  shop_or_field: "shop",
};

Deno.test("H2 enum fixtures include owner-required intake vocabulary", () => {
  assertEquals([...H2_SERVICE_REQUEST_TYPES], [
    "repair",
    "pm_service",
    "warranty",
    "field_service",
    "internal",
    "comeback_rework",
    "hauling_transport",
  ]);
  assert(H2_SERVICE_SOURCE_TYPES.includes("drop_off"));
  assert(H2_SERVICE_SOURCE_TYPES.includes("field_request"));
  assert(H2_SERVICE_SOURCE_TYPES.includes("internal_request"));
  assert(H2_SERVICE_PRIORITIES.includes("high"));
  assert(H2_SERVICE_PRIORITIES.includes("emergency"));
});

Deno.test("validateH2ServiceJobIntake accepts a complete shop intake", () => {
  const result = validateH2ServiceJobIntake(COMPLETE_BODY, COMPLETE_MACHINE);
  assertEquals(result.ok, true);
  assertEquals(result.missing, []);
  assertEquals(result.invalid, []);
  assertEquals(result.normalized.machine_year, 2024);
  assertEquals(result.normalized.hour_meter_reading, 1234.5);
});

Deno.test("validateH2ServiceJobIntake rejects incomplete machine and Three-Cs", () => {
  const result = validateH2ServiceJobIntake(
    {
      machine_id: "machine-1",
      source_type: "call",
      request_type: "repair",
      priority: "normal",
      hour_meter_reading: 10,
      promised_at: "2026-06-15",
      complaint: "Won't start",
      shop_or_field: "shop",
    },
    { ...COMPLETE_MACHINE, year: null, serial_number: "" },
  );

  assertEquals(result.ok, false);
  assert(result.missing.includes("machine.serial_number"));
  assert(result.missing.includes("machine.year"));
  assert(result.missing.includes("cause"));
  assert(result.missing.includes("correction"));
});

Deno.test("validateH2ServiceJobIntake requires miles for grapple trucks only", () => {
  const grappleTruck = {
    ...COMPLETE_MACHINE,
    name: "Grapple Truck 12",
    category: "truck",
  };

  assertEquals(isH2GrappleTruck(grappleTruck), true);

  const missingMiles = validateH2ServiceJobIntake(COMPLETE_BODY, grappleTruck);
  assertEquals(missingMiles.ok, false);
  assert(missingMiles.missing.includes("odometer_miles"));

  const withMiles = validateH2ServiceJobIntake(
    { ...COMPLETE_BODY, odometer_miles: "45678" },
    grappleTruck,
  );
  assertEquals(withMiles.ok, true);
  assertEquals(withMiles.normalized.odometer_miles, 45678);

  const nonGrapple = validateH2ServiceJobIntake(COMPLETE_BODY, COMPLETE_MACHINE);
  assertEquals(nonGrapple.ok, true);
});

Deno.test("validateH2ServiceJobIntake rejects legacy create vocabulary and field-service shop mismatch", () => {
  const legacy = validateH2ServiceJobIntake(
    { ...COMPLETE_BODY, request_type: "machine_down", priority: "critical" },
    COMPLETE_MACHINE,
  );
  assertEquals(legacy.ok, false);
  assert(legacy.invalid.includes("request_type"));
  assert(legacy.invalid.includes("priority"));

  const mismatch = validateH2ServiceJobIntake(
    { ...COMPLETE_BODY, request_type: "field_service", shop_or_field: "shop" },
    COMPLETE_MACHINE,
  );
  assertEquals(mismatch.ok, false);
  assert(mismatch.invalid.includes("shop_or_field"));
});

Deno.test("validateH2ServiceJobIntake requires road-job site details for field work", () => {
  const result = validateH2ServiceJobIntake(
    { ...COMPLETE_BODY, shop_or_field: "field" },
    COMPLETE_MACHINE,
  );
  assertEquals(result.ok, false);
  assert(result.missing.includes("field_site_location"));
  assert(result.missing.includes("field_site_contact_name"));
  assert(result.missing.includes("field_site_contact_phone"));
  assert(result.missing.includes("field_site_conditions_access_notes"));

  const completeField = validateH2ServiceJobIntake(
    {
      ...COMPLETE_BODY,
      shop_or_field: "field",
      field_site_location: "North yard gate 3",
      field_site_contact_name: "Sam Foreman",
      field_site_contact_phone: "555-0100",
      field_site_conditions_access_notes: "Muddy access, call before arrival.",
    },
    COMPLETE_MACHINE,
  );
  assertEquals(completeField.ok, true);
});
