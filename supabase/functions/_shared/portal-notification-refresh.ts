export interface FleetNotificationCandidate {
  id: string;
  workspace_id: string;
  portal_customer_id: string;
  make: string;
  model: string;
  next_service_due: string | null;
}

export interface MatchingEquipmentCandidate {
  id: string;
  workspace_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  serial_number: string | null;
}

export interface PortalNotificationRefreshInsert {
  workspace_id: string;
  portal_customer_id: string;
  category: "fleet";
  event_type: "maintenance_due" | "matching_equipment_arrived";
  channel: "portal";
  title: string;
  body: string;
  related_entity_type: string;
  related_entity_id: string;
  metadata: Record<string, unknown>;
  dedupe_key: string;
}

function normalizeMake(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function modelTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function modelsOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = new Set(modelTokens(a));
  if (left.size === 0) return false;
  return modelTokens(b).some((token) => left.has(token));
}

export function buildMaintenanceDueNotification(
  fleet: FleetNotificationCandidate,
): PortalNotificationRefreshInsert | null {
  if (!fleet.next_service_due) return null;
  return {
    workspace_id: fleet.workspace_id,
    portal_customer_id: fleet.portal_customer_id,
    category: "fleet",
    event_type: "maintenance_due",
    channel: "portal",
    title: "Maintenance due soon",
    body: `${fleet.make} ${fleet.model} is due for service on ${fleet.next_service_due}.`,
    related_entity_type: "customer_fleet",
    related_entity_id: fleet.id,
    metadata: {
      fleet_id: fleet.id,
      next_service_due: fleet.next_service_due,
      make: fleet.make,
      model: fleet.model,
    },
    dedupe_key: `maintenance_due:${fleet.id}:${fleet.next_service_due}`,
  };
}

export function buildMatchingEquipmentNotifications(input: {
  fleet: FleetNotificationCandidate[];
  equipment: MatchingEquipmentCandidate[];
}): PortalNotificationRefreshInsert[] {
  const out = new Map<string, PortalNotificationRefreshInsert>();

  for (const candidate of input.equipment) {
    const candidateMake = normalizeMake(candidate.make);
    if (!candidateMake) continue;

    for (const fleet of input.fleet) {
      if (fleet.workspace_id !== candidate.workspace_id) continue;
      if (normalizeMake(fleet.make) !== candidateMake) continue;
      if (!modelsOverlap(fleet.model, candidate.model)) continue;

      const dedupeKey = `matching_equipment:${fleet.portal_customer_id}:${candidate.id}`;
      if (out.has(dedupeKey)) continue;

      const descriptor = [candidate.year, candidate.make, candidate.model].filter(Boolean).join(" ");
      out.set(dedupeKey, {
        workspace_id: fleet.workspace_id,
        portal_customer_id: fleet.portal_customer_id,
        category: "fleet",
        event_type: "matching_equipment_arrived",
        channel: "portal",
        title: "New matching equipment available",
        body: `${descriptor || "A machine"} is now available and matches your ${fleet.make} ${fleet.model} fleet profile.`,
        related_entity_type: "crm_equipment",
        related_entity_id: candidate.id,
        metadata: {
          matched_fleet_id: fleet.id,
          matched_fleet_make: fleet.make,
          matched_fleet_model: fleet.model,
          equipment_make: candidate.make,
          equipment_model: candidate.model,
          equipment_year: candidate.year,
          equipment_serial_number: candidate.serial_number,
        },
        dedupe_key: dedupeKey,
      });
    }
  }

  return [...out.values()];
}
