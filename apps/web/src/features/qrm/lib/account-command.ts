export function buildAccountCommandHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/command`;
}

export function buildAccountTimelineHref(companyId: string): string {
  return `/qrm/accounts/${companyId}/timeline`;
}
