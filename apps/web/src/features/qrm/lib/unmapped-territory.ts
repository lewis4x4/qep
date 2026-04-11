export interface UnmappedTerritoryEquipment {
  companyId: string | null;
  companyName: string | null;
  lat: number | null;
  lng: number | null;
}

export interface UnmappedTerritoryCompany {
  companyId: string;
  assignedRepId: string | null;
}

export interface UnmappedTerritoryDealSignal {
  companyId: string | null;
}

export interface UnmappedTerritoryActivitySignal {
  companyId: string | null;
}

export interface UnmappedTerritoryVoiceSignal {
  companyId: string | null;
}

export interface UnmappedTerritoryVisitSignal {
  companyId: string | null;
}

export interface UnmappedTerritoryRow {
  id: string;
  companyId: string;
  label: string;
  lat: number;
  lng: number;
  absenceScore: number;
  missingRep: boolean;
  openDealCount: number;
  recentActivityCount: number;
  recentVoiceCount: number;
  visitTargetCount: number;
  reasons: string[];
}

export interface UnmappedTerritoryBoard {
  summary: {
    mappedAccounts: number;
    absenceAccounts: number;
    noRepAccounts: number;
    silentAccounts: number;
  };
  rows: UnmappedTerritoryRow[];
}

export function buildUnmappedTerritoryBoard(input: {
  equipment: UnmappedTerritoryEquipment[];
  companies: UnmappedTerritoryCompany[];
  deals: UnmappedTerritoryDealSignal[];
  activities: UnmappedTerritoryActivitySignal[];
  voiceSignals: UnmappedTerritoryVoiceSignal[];
  visitSignals: UnmappedTerritoryVisitSignal[];
}): UnmappedTerritoryBoard {
  const rows = new Map<string, UnmappedTerritoryRow>();
  const companyMeta = new Map(input.companies.map((row) => [row.companyId, row]));

  for (const eq of input.equipment) {
    if (!eq.companyId || !Number.isFinite(eq.lat) || !Number.isFinite(eq.lng)) continue;
    const key = `account:${eq.companyId}:${eq.lat}:${eq.lng}`;
    if (!rows.has(key)) {
      rows.set(key, {
        id: key,
        companyId: eq.companyId,
        label: eq.companyName ?? "Account",
        lat: eq.lat as number,
        lng: eq.lng as number,
        absenceScore: 0,
        missingRep: false,
        openDealCount: 0,
        recentActivityCount: 0,
        recentVoiceCount: 0,
        visitTargetCount: 0,
        reasons: [],
      });
    }
  }

  const bumpByCompany = (
    companyId: string | null,
    apply: (row: UnmappedTerritoryRow) => void,
  ) => {
    if (!companyId) return;
    for (const row of rows.values()) {
      if (row.companyId === companyId) apply(row);
    }
  };

  for (const signal of input.deals) {
    bumpByCompany(signal.companyId, (row) => {
      row.openDealCount += 1;
    });
  }
  for (const signal of input.activities) {
    bumpByCompany(signal.companyId, (row) => {
      row.recentActivityCount += 1;
    });
  }
  for (const signal of input.voiceSignals) {
    bumpByCompany(signal.companyId, (row) => {
      row.recentVoiceCount += 1;
    });
  }
  for (const signal of input.visitSignals) {
    bumpByCompany(signal.companyId, (row) => {
      row.visitTargetCount += 1;
    });
  }

  const list = [...rows.values()].map((row) => {
    const company = companyMeta.get(row.companyId);
    const reasons: string[] = [];
    if (!company?.assignedRepId) {
      row.missingRep = true;
      reasons.push("No assigned rep");
    }
    if (row.openDealCount === 0) reasons.push("No open pipeline");
    if (row.recentActivityCount === 0) reasons.push("No recent CRM activity");
    if (row.recentVoiceCount === 0) reasons.push("No recent voice signal");
    if (row.visitTargetCount === 0) reasons.push("No predictive visit target");

    row.reasons = reasons;
    row.absenceScore = reasons.length;
    return row;
  })
    .filter((row) => row.absenceScore >= 2)
    .sort((a, b) => {
      if (b.absenceScore !== a.absenceScore) return b.absenceScore - a.absenceScore;
      return a.label.localeCompare(b.label);
    });

  return {
    summary: {
      mappedAccounts: rows.size,
      absenceAccounts: list.length,
      noRepAccounts: list.filter((row) => row.missingRep).length,
      silentAccounts: list.filter((row) => row.recentActivityCount === 0 && row.recentVoiceCount === 0).length,
    },
    rows: list,
  };
}
