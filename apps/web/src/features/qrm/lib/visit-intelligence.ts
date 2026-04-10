export interface VisitRecommendation {
  contact_id?: string | null;
  company_id?: string | null;
  contact_name?: string | null;
  company_name?: string | null;
  reason?: string | null;
  priority_score?: number | null;
  distance_km?: number | null;
  equipment_interest?: string | null;
  last_contact_days?: number | null;
  replacement_due?: string | null;
}

export interface VisitPrepRequest {
  entity_type: "company" | "contact";
  name: string;
}

export function normalizeVisitRecommendations(value: unknown): VisitRecommendation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      contact_id: typeof row.contact_id === "string" ? row.contact_id : null,
      company_id: typeof row.company_id === "string" ? row.company_id : null,
      contact_name: typeof row.contact_name === "string" ? row.contact_name : null,
      company_name: typeof row.company_name === "string" ? row.company_name : null,
      reason: typeof row.reason === "string" ? row.reason : null,
      priority_score: typeof row.priority_score === "number" ? row.priority_score : null,
      distance_km: typeof row.distance_km === "number" ? row.distance_km : null,
      equipment_interest: typeof row.equipment_interest === "string" ? row.equipment_interest : null,
      last_contact_days: typeof row.last_contact_days === "number" ? row.last_contact_days : null,
      replacement_due: typeof row.replacement_due === "string" ? row.replacement_due : null,
    }))
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
}

export function buildVisitPrepRequest(rec: VisitRecommendation): VisitPrepRequest | null {
  if (rec.company_name?.trim()) {
    return {
      entity_type: "company",
      name: rec.company_name.trim(),
    };
  }

  if (rec.contact_name?.trim()) {
    return {
      entity_type: "contact",
      name: rec.contact_name.trim(),
    };
  }

  return null;
}

export function buildVisitPrimaryHref(rec: VisitRecommendation): string | null {
  if (rec.company_id) return `/qrm/accounts/${rec.company_id}/command`;
  if (rec.contact_id) return `/qrm/contacts/${rec.contact_id}`;
  return null;
}
