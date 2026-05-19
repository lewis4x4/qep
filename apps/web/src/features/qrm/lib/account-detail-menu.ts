import {
  buildAccountFleetIntelligenceHref,
  buildAccountGenomeHref,
  buildAccountOperatingProfileHref,
  buildAccountRentalConversionHref,
  buildAccountRelationshipMapHref,
  buildAccountStrategistHref,
  buildAccountTimelineHref,
  buildAccountWhiteSpaceHref,
} from "./account-command";
import { accountFleetRadarUrl, legacyAccountDetailUrl } from "./account-links";

export type AccountDetailMenuKey =
  | "legacy"
  | "voice-note"
  | "timeline"
  | "genome"
  | "operating-profile"
  | "fleet-intelligence"
  | "relationship-map"
  | "white-space"
  | "rental-conversion"
  | "strategist"
  | "fleet-radar"
  | "duplicates";

export interface AccountDetailMenuItem {
  key: AccountDetailMenuKey;
  label: string;
  href: string;
}

export function buildAccountDetailMenuItems(accountId: string): AccountDetailMenuItem[] {
  return [
    { key: "legacy", label: "Legacy detail", href: legacyAccountDetailUrl(accountId) },
    { key: "voice-note", label: "Record voice note", href: `/voice-qrm?linked_company_id=${encodeURIComponent(accountId)}` },
    { key: "timeline", label: "Timeline", href: buildAccountTimelineHref(accountId) },
    { key: "genome", label: "Customer Genome", href: buildAccountGenomeHref(accountId) },
    { key: "operating-profile", label: "Operating Profile", href: buildAccountOperatingProfileHref(accountId) },
    { key: "fleet-intelligence", label: "Fleet Intelligence", href: buildAccountFleetIntelligenceHref(accountId) },
    { key: "relationship-map", label: "Relationship Map", href: buildAccountRelationshipMapHref(accountId) },
    { key: "white-space", label: "White-Space Map", href: buildAccountWhiteSpaceHref(accountId) },
    { key: "rental-conversion", label: "Rental Conversion", href: buildAccountRentalConversionHref(accountId) },
    { key: "strategist", label: "AI Strategist", href: buildAccountStrategistHref(accountId) },
    { key: "fleet-radar", label: "Fleet Radar", href: accountFleetRadarUrl(accountId) },
    { key: "duplicates", label: "Review Duplicates", href: `/admin/duplicates?accountId=${encodeURIComponent(accountId)}` },
  ];
}
