export interface ReplacedIntegrationDescriptor {
  key: string;
  badgeLabel: string;
  replacementSurface: string;
  summary: string;
  detail: string;
}

type JsonRecord = Record<string, unknown>;

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

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getConfiguredReplacementDescriptor(
  integrationKey: string,
  config: JsonRecord | null | undefined,
): ReplacedIntegrationDescriptor | null {
  if (!config || config.lifecycle !== "replaced") return null;
  if (config.external_dependency_required !== false) return null;

  const replacementSurface = nonEmptyString(config.replacement_surface);
  if (!replacementSurface) return null;

  const badgeLabel = nonEmptyString(config.replacement_label) ?? "QEP Native";
  const summary = nonEmptyString(config.replacement_summary) ??
    `${integrationKey} is retired as a live external dependency.`;
  const detail = nonEmptyString(config.replacement_detail) ??
    "A source-controlled decision and runtime readiness metadata mark this integration as replaced. Operators should not reconnect or depend on this vendor unless a new product decision reverses that lifecycle.";

  return {
    key: integrationKey,
    badgeLabel,
    replacementSurface,
    summary,
    detail,
  };
}

export function getReplacedIntegrationDescriptor(
  integrationKey: string | null | undefined,
  config?: JsonRecord | null,
): ReplacedIntegrationDescriptor | null {
  if (!integrationKey) return null;
  return REPLACED_INTEGRATIONS[integrationKey] ??
    getConfiguredReplacementDescriptor(integrationKey, config);
}

export function isReplacedIntegration(
  integrationKey: string | null | undefined,
  config?: JsonRecord | null,
): boolean {
  return getReplacedIntegrationDescriptor(integrationKey, config) !== null;
}
