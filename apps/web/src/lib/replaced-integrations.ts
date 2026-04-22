export interface ReplacedIntegrationDescriptor {
  key: "hubspot" | "intellidealer";
  badgeLabel: string;
  replacementSurface: string;
  summary: string;
  detail: string;
}

const REPLACED_INTEGRATIONS: Record<string, ReplacedIntegrationDescriptor> = {
  hubspot: {
    key: "hubspot",
    badgeLabel: "QRM Native",
    replacementSurface: "QRM",
    summary: "HubSpot is deprecated. QRM is the live CRM and migration surface.",
    detail:
      "HubSpot remains only as historical migration context. Operators should manage companies, contacts, deals, and activity directly in QRM.",
  },
  intellidealer: {
    key: "intellidealer",
    badgeLabel: "QEP Native",
    replacementSurface: "QEP Catalog + QRM",
    summary:
      "IntelliDealer is deprecated. Quote, catalog, parts, and customer workflows run natively inside QEP.",
    detail:
      "Legacy IntelliDealer identifiers may remain on records for audit/history, but no user-facing workflow should require a live IntelliDealer connection.",
  },
};

export function getReplacedIntegrationDescriptor(
  integrationKey: string | null | undefined,
): ReplacedIntegrationDescriptor | null {
  if (!integrationKey) return null;
  return REPLACED_INTEGRATIONS[integrationKey] ?? null;
}

export function isReplacedIntegration(
  integrationKey: string | null | undefined,
): boolean {
  return getReplacedIntegrationDescriptor(integrationKey) !== null;
}
