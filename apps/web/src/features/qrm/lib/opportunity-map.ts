export interface OpportunityMapEquipment {
  id: string;
  companyId: string | null;
  companyName: string | null;
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned" | "on_order";
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface OpportunityMapDeal {
  id: string;
  companyId: string | null;
  amount: number | null;
}

export interface OpportunityMapVisitRecommendation {
  companyId: string | null;
  companyName: string | null;
  priorityScore: number | null;
}

export interface OpportunityMapTradeSignal {
  equipmentId: string | null;
}

export interface OpportunityMapMarkerRow {
  id: string;
  companyId: string | null;
  label: string;
  lat: number;
  lng: number;
  kind: "account" | "rental";
  openRevenue: number;
  visitTargetCount: number;
  tradeSignalCount: number;
}

export interface OpportunityMapSummary {
  mappedAccounts: number;
  openRevenue: number;
  visitTargets: number;
  activeRentals: number;
  tradeSignals: number;
}

export interface OpportunityMapBoard {
  summary: OpportunityMapSummary;
  rows: OpportunityMapMarkerRow[];
}

export function buildOpportunityMapBoard(input: {
  equipment: OpportunityMapEquipment[];
  deals: OpportunityMapDeal[];
  visitRecommendations: OpportunityMapVisitRecommendation[];
  tradeSignals: OpportunityMapTradeSignal[];
}): OpportunityMapBoard {
  const rows = new Map<string, OpportunityMapMarkerRow>();
  const equipmentById = new Map(input.equipment.map((row) => [row.id, row]));
  const siteKeysByCompany = new Map<string, string[]>();

  for (const eq of input.equipment) {
    if (!Number.isFinite(eq.lat) || !Number.isFinite(eq.lng)) continue;
    if (eq.ownership === "customer_owned" && eq.companyId) {
      const key = `account:${eq.companyId}:${eq.lat}:${eq.lng}`;
      if (!rows.has(key)) {
        rows.set(key, {
          id: key,
          companyId: eq.companyId,
          label: eq.companyName ?? eq.name,
          lat: eq.lat as number,
          lng: eq.lng as number,
          kind: "account",
          openRevenue: 0,
          visitTargetCount: 0,
          tradeSignalCount: 0,
        });
      }
      const siteKeys = siteKeysByCompany.get(eq.companyId) ?? [];
      if (!siteKeys.includes(key)) siteKeys.push(key);
      siteKeysByCompany.set(eq.companyId, siteKeys);
    }
    if (eq.ownership === "rental_fleet" && (eq.availability === "rented" || eq.availability === "reserved")) {
      const key = `rental:${eq.id}`;
      rows.set(key, {
        id: key,
        companyId: eq.companyId,
        label: eq.name,
        lat: eq.lat as number,
        lng: eq.lng as number,
        kind: "rental",
        openRevenue: 0,
        visitTargetCount: 0,
        tradeSignalCount: 0,
      });
    }
  }

  for (const deal of input.deals) {
    if (!deal.companyId) continue;
    const siteKeys = siteKeysByCompany.get(deal.companyId) ?? [];
    if (siteKeys.length === 0) continue;
    const share = Number(deal.amount ?? 0) / siteKeys.length;
    for (const key of siteKeys) {
      const row = rows.get(key);
      if (!row) continue;
      row.openRevenue += share;
    }
  }

  for (const rec of input.visitRecommendations) {
    if (!rec.companyId) continue;
    const siteKeys = siteKeysByCompany.get(rec.companyId) ?? [];
    if (siteKeys.length === 0) continue;
    const target = rows.get(siteKeys[0]);
    if (!target) continue;
    target.visitTargetCount += 1;
  }

  for (const signal of input.tradeSignals) {
    if (!signal.equipmentId) continue;
    const eq = equipmentById.get(signal.equipmentId);
    if (!eq?.companyId) continue;
    const siteKeys = siteKeysByCompany.get(eq.companyId) ?? [];
    if (siteKeys.length === 0) continue;
    const target = rows.get(siteKeys[0]);
    if (!target) continue;
    target.tradeSignalCount += 1;
  }

  const list = [...rows.values()].sort((a, b) => {
    if (b.openRevenue !== a.openRevenue) return b.openRevenue - a.openRevenue;
    if (b.visitTargetCount !== a.visitTargetCount) return b.visitTargetCount - a.visitTargetCount;
    return a.label.localeCompare(b.label);
  });

  return {
    summary: {
      mappedAccounts: list.filter((row) => row.kind === "account").length,
      openRevenue: list.reduce((sum, row) => sum + row.openRevenue, 0),
      visitTargets: list.reduce((sum, row) => sum + row.visitTargetCount, 0),
      activeRentals: list.filter((row) => row.kind === "rental").length,
      tradeSignals: list.reduce((sum, row) => sum + row.tradeSignalCount, 0),
    },
    rows: list,
  };
}
