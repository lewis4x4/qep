export const H2_SERVICE_REQUEST_TYPES = [
  "repair",
  "pm_service",
  "warranty",
  "field_service",
  "internal",
  "comeback_rework",
  "hauling_transport",
] as const;

const SERVICE_REQUEST_TYPE_VALUES = new Set<string>(H2_SERVICE_REQUEST_TYPES);

export const H2_SERVICE_SOURCE_TYPES = [
  "call",
  "walk_in",
  "drop_off",
  "field_request",
  "internal_request",
] as const;

const SERVICE_SOURCE_TYPE_VALUES = new Set<string>(H2_SERVICE_SOURCE_TYPES);

export const H2_SERVICE_PRIORITIES = ["normal", "high", "emergency"] as const;
const SERVICE_PRIORITY_VALUES = new Set<string>(H2_SERVICE_PRIORITIES);

export interface H2MachineSnapshotSource {
  id?: unknown;
  name?: unknown;
  make?: unknown;
  model?: unknown;
  serial_number?: unknown;
  year?: unknown;
  category?: unknown;
  metadata?: unknown;
}

export interface H2ServiceJobIntakeValidation {
  ok: boolean;
  missing: string[];
  invalid: string[];
  is_grapple_truck: boolean;
  is_grapple_production_service_route: boolean;
  normalized: Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finiteNonnegativeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value.trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function finiteYear(value: unknown): number | null {
  const n = finiteNonnegativeNumber(value);
  if (n == null) return null;
  const y = Math.trunc(n);
  return y >= 1900 && y <= 2100 ? y : null;
}

function validIsoLikeDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return raw;
}

function metadataValue(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return text(value);
}

export function isH2GrappleTruck(machine: H2MachineSnapshotSource | null): boolean {
  if (!machine) return false;
  const metadata = machine.metadata;
  const classHints = [
    metadataValue(metadata, "equipment_class"),
    metadataValue(metadata, "service_equipment_class"),
    metadataValue(metadata, "rate_class"),
    metadataValue(metadata, "work_class"),
  ].filter(Boolean).join(" ").toLowerCase();

  if (/\bgrapple(_truck)?\b/.test(classHints)) return true;

  const freeText = [
    machine.name,
    machine.make,
    machine.model,
    machine.category,
    metadataValue(metadata, "description"),
    metadataValue(metadata, "body_type"),
    metadataValue(metadata, "equipment_type"),
  ].map((v) => text(v)).filter(Boolean).join(" ").toLowerCase();

  return /\bgrapple\b/.test(freeText) && /\btruck\b/.test(freeText);
}

export function isGrappleProductionServiceRoute(
  body: Record<string, unknown>,
  machine: H2MachineSnapshotSource | null,
): boolean {
  const serviceJobHints = [
    body.customer_problem_summary,
    body.complaint,
    body.cause,
    body.correction,
    body.description,
    body.title,
    body.work_summary,
  ].map((v) => text(v)).filter(Boolean).join(" ").toLowerCase();

  const hasExplicitBuildIntent =
    /\b(?:grapple[-\s]?truck|gtb)\b.{0,80}\b(?:build|built|production|assemble|assembly|upfit|upfitting)\b/.test(serviceJobHints) ||
    /\b(?:build|built|production|assemble|assembly|upfit|upfitting)\b.{0,80}\b(?:grapple[-\s]?truck|gtb)\b/.test(serviceJobHints) ||
    /\b(?:production build|build package|upfit package|new unit|sold unit|mount grapple body)\b/.test(serviceJobHints);

  return hasExplicitBuildIntent && isH2GrappleTruck(machine);
}

export function validateH2ServiceJobIntake(
  body: Record<string, unknown>,
  machine: H2MachineSnapshotSource | null,
): H2ServiceJobIntakeValidation {
  const missing: string[] = [];
  const invalid: string[] = [];
  const normalized: Record<string, unknown> = {};

  const machineId = text(body.machine_id);
  if (!machineId) missing.push("machine_id");
  if (!machine) missing.push("machine");

  const machineMake = text(machine?.make);
  const machineModel = text(machine?.model);
  const machineSerial = text(machine?.serial_number);
  const machineYear = finiteYear(machine?.year);

  if (!machineMake) missing.push("machine.make");
  if (!machineModel) missing.push("machine.model");
  if (!machineSerial) missing.push("machine.serial_number");
  if (machineYear == null) missing.push("machine.year");

  if (machineMake) normalized.machine_make = machineMake;
  if (machineModel) normalized.machine_model = machineModel;
  if (machineSerial) normalized.machine_serial_number = machineSerial;
  if (machineYear != null) normalized.machine_year = machineYear;

  const sourceType = text(body.source_type);
  if (!sourceType) missing.push("source_type");
  else if (!SERVICE_SOURCE_TYPE_VALUES.has(sourceType)) invalid.push("source_type");
  else normalized.source_type = sourceType;

  const requestType = text(body.request_type);
  if (!requestType) missing.push("request_type");
  else if (!SERVICE_REQUEST_TYPE_VALUES.has(requestType)) invalid.push("request_type");
  else normalized.request_type = requestType;

  const priority = text(body.priority);
  if (!priority) missing.push("priority");
  else if (!SERVICE_PRIORITY_VALUES.has(priority)) invalid.push("priority");
  else normalized.priority = priority;

  const hourMeter = finiteNonnegativeNumber(body.hour_meter_reading);
  if (hourMeter == null) missing.push("hour_meter_reading");
  else normalized.hour_meter_reading = hourMeter;

  const isGrappleTruck = isH2GrappleTruck(machine);
  const isGrappleProductionRoute = isGrappleProductionServiceRoute(body, machine);
  if (isGrappleProductionRoute) invalid.push("grapple_production_route");

  const odometerMiles = finiteNonnegativeNumber(body.odometer_miles ?? body.miles);
  if (isGrappleTruck && odometerMiles == null) missing.push("odometer_miles");
  if (odometerMiles != null) normalized.odometer_miles = odometerMiles;

  const promisedAt = validIsoLikeDate(body.promised_at ?? body.promised_date);
  if (!promisedAt) missing.push("promised_at");
  else normalized.promised_at = promisedAt;

  const complaint = text(body.complaint ?? body.customer_problem_summary);
  const cause = text(body.cause);
  const correction = text(body.correction);
  if (!complaint) missing.push("complaint");
  if (!cause) missing.push("cause");
  if (!correction) missing.push("correction");
  if (complaint) normalized.complaint = complaint;
  if (cause) normalized.cause = cause;
  if (correction) normalized.correction = correction;

  const shopOrField = text(body.shop_or_field);
  if (!shopOrField) missing.push("shop_or_field");
  else if (!["shop", "field"].includes(shopOrField)) invalid.push("shop_or_field");
  else normalized.shop_or_field = shopOrField;

  if (
    (requestType === "field_service" || sourceType === "field_request") &&
    shopOrField !== "field"
  ) {
    invalid.push("shop_or_field");
  }

  if (shopOrField === "field") {
    const siteLocation = text(body.field_site_location ?? body.site_location);
    const siteContactName = text(body.field_site_contact_name ?? body.site_contact_name);
    const siteContactPhone = text(body.field_site_contact_phone ?? body.site_contact_phone);
    const siteConditions = text(
      body.field_site_conditions_access_notes ??
        body.field_site_conditions ??
        body.site_conditions ??
        body.site_access_notes,
    );

    if (!siteLocation) missing.push("field_site_location");
    if (!siteContactName) missing.push("field_site_contact_name");
    if (!siteContactPhone) missing.push("field_site_contact_phone");
    if (!siteConditions) missing.push("field_site_conditions_access_notes");

    if (siteLocation) normalized.field_site_location = siteLocation;
    if (siteContactName) normalized.field_site_contact_name = siteContactName;
    if (siteContactPhone) normalized.field_site_contact_phone = siteContactPhone;
    if (siteConditions) normalized.field_site_conditions_access_notes = siteConditions;
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    missing: [...new Set(missing)],
    invalid: [...new Set(invalid)],
    is_grapple_truck: isGrappleTruck,
    is_grapple_production_service_route: isGrappleProductionRoute,
    normalized,
  };
}
