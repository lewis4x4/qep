export interface PostSaleFleetRow {
  companyId: string;
  companyName: string;
  fleetId: string;
  equipmentId: string | null;
  purchaseDate: string | null;
  nextServiceDue: string | null;
  warrantyExpiry: string | null;
  attachmentCount: number;
}

export interface PostSaleServiceRow {
  companyId: string | null;
  machineId: string | null;
  currentStage: string;
  createdAt: string;
}

export interface PostSaleDocumentRow {
  companyId: string;
  fleetId: string | null;
  equipmentId: string | null;
  documentType: string;
}

export interface PostSaleAccountRow {
  companyId: string;
  companyName: string;
  recentUnits: number;
  serviceTouches: number;
  openServiceTouches: number;
  overdueDueCount: number;
  docCoverageCount: number;
  attachmentGapCount: number;
  frictionScore: number;
}

export interface PostSaleExperienceSummary {
  accounts: number;
  recentUnits: number;
  frictionAccounts: number;
  documentGapUnits: number;
  attachmentGapUnits: number;
}

export interface PostSaleExperienceBoard {
  summary: PostSaleExperienceSummary;
  accounts: PostSaleAccountRow[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOpenStage(stage: string): boolean {
  return !["closed", "invoiced", "cancelled"].includes(stage);
}

export function buildPostSaleExperienceBoard(
  input: {
    fleet: PostSaleFleetRow[];
    service: PostSaleServiceRow[];
    documents: PostSaleDocumentRow[];
    nowTime?: number;
  },
): PostSaleExperienceBoard {
  const nowTime = input.nowTime ?? Date.now();
  const horizon = nowTime - 90 * 86_400_000;

  const recentFleet = input.fleet.filter((row) => {
    const purchaseAt = parseTime(row.purchaseDate);
    return purchaseAt != null && purchaseAt >= horizon;
  });

  const docsByFleet = new Map<string, Set<string>>();
  for (const doc of input.documents) {
    const key = doc.fleetId ?? doc.equipmentId;
    if (!key) continue;
    const bucket = docsByFleet.get(key) ?? new Set<string>();
    bucket.add(doc.documentType);
    docsByFleet.set(key, bucket);
  }

  const grouped = new Map<string, PostSaleAccountRow>();
  const recentEquipmentByCompany = new Map<string, Set<string>>();

  for (const row of recentFleet) {
    const account = grouped.get(row.companyId) ?? {
      companyId: row.companyId,
      companyName: row.companyName,
      recentUnits: 0,
      serviceTouches: 0,
      openServiceTouches: 0,
      overdueDueCount: 0,
      docCoverageCount: 0,
      attachmentGapCount: 0,
      frictionScore: 0,
    };
    account.recentUnits += 1;

    const dueAt = parseTime(row.nextServiceDue);
    if (dueAt != null && dueAt < nowTime) account.overdueDueCount += 1;

    const docs = docsByFleet.get(row.fleetId) ?? new Set<string>();
    if (docs.size > 0) account.docCoverageCount += 1;

    if (row.attachmentCount === 0) account.attachmentGapCount += 1;

    grouped.set(row.companyId, account);

    if (row.equipmentId) {
      const equipmentBucket = recentEquipmentByCompany.get(row.companyId) ?? new Set<string>();
      equipmentBucket.add(row.equipmentId);
      recentEquipmentByCompany.set(row.companyId, equipmentBucket);
    }
  }

  for (const account of grouped.values()) {
    const recentEquipmentIds = recentEquipmentByCompany.get(account.companyId) ?? new Set<string>();
    const jobs = input.service.filter((row) =>
      row.companyId === account.companyId &&
      row.machineId != null &&
      recentEquipmentIds.has(row.machineId),
    );
    account.serviceTouches = jobs.length;
    account.openServiceTouches = jobs.filter((row) => isOpenStage(row.currentStage)).length;
    account.frictionScore =
      account.openServiceTouches * 3 +
      account.overdueDueCount * 2 +
      account.attachmentGapCount +
      Math.max(0, account.recentUnits - account.docCoverageCount);
  }

  const accounts = [...grouped.values()].sort((a, b) => {
    if (b.frictionScore !== a.frictionScore) return b.frictionScore - a.frictionScore;
    return b.recentUnits - a.recentUnits;
  });

  return {
    summary: {
      accounts: accounts.length,
      recentUnits: accounts.reduce((sum, row) => sum + row.recentUnits, 0),
      frictionAccounts: accounts.filter((row) => row.frictionScore > 0).length,
      documentGapUnits: accounts.reduce((sum, row) => sum + Math.max(0, row.recentUnits - row.docCoverageCount), 0),
      attachmentGapUnits: accounts.reduce((sum, row) => sum + row.attachmentGapCount, 0),
    },
    accounts,
  };
}
