export function buildAccountCommandHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/command`;
}

export function buildAccountTimelineHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/timeline`;
}

export function buildAccountGenomeHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/genome`;
}

export function buildAccountOperatingProfileHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/operating-profile`;
}

export function buildAccountFleetIntelligenceHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/fleet-intelligence`;
}

export function buildAccountRelationshipMapHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/relationship-map`;
}
