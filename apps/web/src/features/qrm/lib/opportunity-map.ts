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
  kind: "account" | "rental" | "prospect";
  openRevenue: number;
  visitTargetCount: number;
  tradeSignalCount: number;
  score: number;
  urgency: "critical" | "hot" | "warm" | "cold" | "rental";
  reasons: string[];
  routeCandidate: boolean;
  openDealCount: number;
  source?: "ucc_csv";
  lender?: string | null;
  filingDate?: string | null;
  collateral?: string | null;
}

export interface UccProspectRow {
  id: string;
  label: string;
  lat: number;
  lng: number;
  source: "ucc_csv";
  lender?: string | null;
  filingDate?: string | null;
  collateral?: string | null;
}

export interface OpportunityMapSummary {
  mappedAccounts: number;
  openRevenue: number;
  visitTargets: number;
  activeRentals: number;
  tradeSignals: number;
  criticalAccounts: number;
  routeCandidates: number;
}

export interface OpportunityMapBoard {
  summary: OpportunityMapSummary;
  rows: OpportunityMapMarkerRow[];
}

export interface OpportunityRouteStop {
  id: string;
  label: string;
  lat: number;
  lng: number;
  score: number;
  openRevenue: number;
}

export interface OpportunityRoutePlan {
  stops: OpportunityRouteStop[];
  estimatedMiles: number;
  googleMapsUrl: string | null;
}

function getAccountScore(row: OpportunityMapMarkerRow): number {
  let score = 0;
  if (row.openRevenue >= 100000) score += 60;
  else if (row.openRevenue >= 50000) score += 40;
  else if (row.openRevenue > 0) score += 20;

  if (row.visitTargetCount > 0) score += 20;
  if (row.tradeSignalCount > 0) score += 20;
  if (row.openDealCount > 0) score += 10;

  return Math.min(score, 100);
}

function getAccountUrgency(score: number): "critical" | "hot" | "warm" | "cold" {
  if (score >= 80) return "critical";
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  return "cold";
}

function getReasons(row: OpportunityMapMarkerRow): string[] {
  if (row.kind === "rental") {
    return ["Active rental unit in field"];
  }
  if (row.kind === "prospect") {
    return row.reasons.length > 0 ? row.reasons : ["UCC prospect import"];
  }

  const reasons: string[] = [];
  if (row.openRevenue > 0) reasons.push(`$${Math.round(row.openRevenue).toLocaleString()} open revenue`);
  if (row.openDealCount > 0) reasons.push(`${row.openDealCount} open deal${row.openDealCount === 1 ? "" : "s"}`);
  if (row.visitTargetCount > 0) reasons.push(`${row.visitTargetCount} visit target${row.visitTargetCount === 1 ? "" : "s"}`);
  if (row.tradeSignalCount > 0) reasons.push(`${row.tradeSignalCount} trade signal${row.tradeSignalCount === 1 ? "" : "s"}`);
  if (reasons.length === 0) reasons.push("Mapped customer-owned equipment location");

  return reasons;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return earthRadiusMiles * c;
}

export function buildOpportunityRoute(rows: OpportunityMapMarkerRow[], limit = 8): OpportunityRoutePlan {
  const selected = rows
    .filter((row) => (row.kind === "account" || row.kind === "prospect") && row.routeCandidate)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.openRevenue !== a.openRevenue) return b.openRevenue - a.openRevenue;
      return a.label.localeCompare(b.label);
    })
    .slice(0, Math.max(0, limit));

  if (selected.length === 0) {
    return { stops: [], estimatedMiles: 0, googleMapsUrl: null };
  }

  const remaining = [...selected];
  const ordered: OpportunityRouteStop[] = [remaining.shift() as OpportunityRouteStop];

  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1] as OpportunityRouteStop;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i] as OpportunityRouteStop;
      const miles = distanceMiles(current, candidate);
      if (miles < nearestDistance) {
        nearestDistance = miles;
        nearestIndex = i;
      }
    }

    ordered.push(remaining.splice(nearestIndex, 1)[0] as OpportunityRouteStop);
  }

  let estimatedMiles = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    estimatedMiles += distanceMiles(ordered[i - 1] as OpportunityRouteStop, ordered[i] as OpportunityRouteStop);
  }

  const destination = `${ordered[ordered.length - 1]?.lat},${ordered[ordered.length - 1]?.lng}`;
  const waypoints = ordered.slice(0, -1).map((stop) => `${stop.lat},${stop.lng}`).join("|");
  const googleMapsUrl =
    ordered.length > 0
      ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destination)}${waypoints.length > 0 ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}`
      : null;

  return {
    stops: ordered,
    estimatedMiles,
    googleMapsUrl,
  };
}

export function buildOpportunityMapBoard(input: {
  equipment: OpportunityMapEquipment[];
  deals: OpportunityMapDeal[];
  visitRecommendations: OpportunityMapVisitRecommendation[];
  tradeSignals: OpportunityMapTradeSignal[];
  uccProspects?: UccProspectRow[];
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
          score: 0,
          urgency: "cold",
          reasons: [],
          routeCandidate: false,
          openDealCount: 0,
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
        score: 0,
        urgency: "rental",
        reasons: [],
        routeCandidate: false,
        openDealCount: 0,
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
      row.openDealCount += 1;
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

  for (const prospect of input.uccProspects ?? []) {
    rows.set(`prospect:${prospect.id}`, {
      id: `prospect:${prospect.id}`,
      companyId: null,
      label: prospect.label,
      lat: prospect.lat,
      lng: prospect.lng,
      kind: "prospect",
      openRevenue: 0,
      visitTargetCount: 1,
      tradeSignalCount: 0,
      score: 55,
      urgency: "hot",
      reasons: [
        "UCC prospect import",
        prospect.lender ? `Lender: ${prospect.lender}` : null,
        prospect.filingDate ? `Filed: ${prospect.filingDate}` : null,
        prospect.collateral ? `Collateral: ${prospect.collateral}` : null,
      ].filter((reason): reason is string => Boolean(reason)),
      routeCandidate: true,
      openDealCount: 0,
      source: prospect.source,
      lender: prospect.lender ?? null,
      filingDate: prospect.filingDate ?? null,
      collateral: prospect.collateral ?? null,
    });
  }

  for (const row of rows.values()) {
    if (row.kind === "account") {
      row.score = getAccountScore(row);
      row.urgency = getAccountUrgency(row.score);
      row.routeCandidate = row.urgency === "critical" || row.urgency === "hot";
    } else if (row.kind === "prospect") {
      row.score = Math.max(row.score, 55);
      row.urgency = "hot";
      row.routeCandidate = true;
    } else {
      row.score = 0;
      row.urgency = "rental";
      row.routeCandidate = false;
    }
    row.reasons = getReasons(row);
  }

  const list = [...rows.values()].sort((a, b) => {
    if (b.openRevenue !== a.openRevenue) return b.openRevenue - a.openRevenue;
    if (b.visitTargetCount !== a.visitTargetCount) return b.visitTargetCount - a.visitTargetCount;
    return a.label.localeCompare(b.label);
  });

  return {
    summary: {
      mappedAccounts: list.filter((row) => row.kind === "account" || row.kind === "prospect").length,
      openRevenue: list.reduce((sum, row) => sum + row.openRevenue, 0),
      visitTargets: list.reduce((sum, row) => sum + row.visitTargetCount, 0),
      activeRentals: list.filter((row) => row.kind === "rental").length,
      tradeSignals: list.reduce((sum, row) => sum + row.tradeSignalCount, 0),
      criticalAccounts: list.filter((row) => row.kind === "account" && row.urgency === "critical").length,
      routeCandidates: list.filter((row) => row.routeCandidate).length,
    },
    rows: list,
  };
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function firstPresent(record: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) return value;
  }
  return null;
}

function parseCoord(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseUccProspectCsv(csv: string): UccProspectRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = csvCells(lines[0] as string).map((header) => header.trim().toLowerCase());
  return lines.slice(1).flatMap((line, index) => {
    const values = csvCells(line);
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? ""]));
    const lat = parseCoord(firstPresent(record, ["lat", "latitude"]));
    const lng = parseCoord(firstPresent(record, ["lng", "lon", "long", "longitude"]));
    if (lat == null || lng == null) return [];
    const label = firstPresent(record, ["company", "company name", "debtor", "debtor name", "name", "business name"]) ?? `UCC prospect ${index + 1}`;
    return [{
      id: firstPresent(record, ["id", "ucc id", "filing number"]) ?? `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
      label,
      lat,
      lng,
      source: "ucc_csv" as const,
      lender: firstPresent(record, ["lender", "secured party", "secured party name"]),
      filingDate: firstPresent(record, ["filing date", "filed", "date"]),
      collateral: firstPresent(record, ["collateral", "equipment", "description"]),
    }];
  });
}
