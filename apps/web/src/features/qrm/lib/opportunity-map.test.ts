import { describe, expect, it } from "bun:test";
import { buildOpportunityMapBoard, buildOpportunityRoute, parseUccProspectCsv, type OpportunityMapMarkerRow } from "./opportunity-map";

describe("buildOpportunityMapBoard", () => {
  it("groups account signals on customer-owned equipment coordinates and keeps rentals separate", () => {
    const board = buildOpportunityMapBoard({
      equipment: [
        {
          id: "eq-1",
          companyId: "company-1",
          companyName: "Acme",
          ownership: "customer_owned",
          availability: "available",
          name: "CAT 320",
          lat: 35.1,
          lng: -89.9,
        },
        {
          id: "eq-1b",
          companyId: "company-1",
          companyName: "Acme",
          ownership: "customer_owned",
          availability: "available",
          name: "CAT 320 backup",
          lat: 35.3,
          lng: -89.7,
        },
        {
          id: "eq-2",
          companyId: null,
          companyName: null,
          ownership: "rental_fleet",
          availability: "rented",
          name: "JLG 450AJ",
          lat: 36.1,
          lng: -86.8,
        },
      ],
      deals: [{ id: "deal-1", companyId: "company-1", amount: 125000 }],
      visitRecommendations: [{ companyId: "company-1", companyName: "Acme", priorityScore: 87 }],
      tradeSignals: [{ equipmentId: "eq-1" }],
    });

    expect(board.summary.mappedAccounts).toBe(2);
    expect(board.summary.openRevenue).toBe(125000);
    expect(board.summary.visitTargets).toBe(1);
    expect(board.summary.activeRentals).toBe(1);
    expect(board.summary.tradeSignals).toBe(1);
    expect(board.summary.criticalAccounts).toBe(1);
    expect(board.summary.routeCandidates).toBe(1);

    expect(board.rows[0]?.id).toBe("account:company-1:35.1:-89.9");
    expect(board.rows[0]?.openRevenue).toBe(62500);
    expect(board.rows[0]?.openDealCount).toBe(1);
    expect(board.rows[0]?.urgency).toBe("critical");
    expect(board.rows[0]?.score).toBe(90);
    expect(board.rows[0]?.routeCandidate).toBe(true);
    expect(board.rows[0]?.reasons).toEqual(["$62,500 open revenue", "1 open deal", "1 visit target", "1 trade signal"]);

    expect(board.rows[1]?.id).toBe("account:company-1:35.3:-89.7");
    expect(board.rows[1]?.openRevenue).toBe(62500);
    expect(board.rows[1]?.openDealCount).toBe(1);
    expect(board.rows[1]?.urgency).toBe("warm");
    expect(board.rows[1]?.routeCandidate).toBe(false);
    expect(board.rows[1]?.reasons).toEqual(["$62,500 open revenue", "1 open deal"]);

    expect(board.rows[2]?.id).toBe("rental:eq-2");
    expect(board.rows[2]?.urgency).toBe("rental");
    expect(board.rows[2]?.routeCandidate).toBe(false);
    expect(board.rows[2]?.reasons).toEqual(["Active rental unit in field"]);
  });

  it("assigns deterministic urgency tiers and route candidates", () => {
    const board = buildOpportunityMapBoard({
      equipment: [
        {
          id: "eq-critical",
          companyId: "company-critical",
          companyName: "Critical Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Critical asset",
          lat: 1,
          lng: 1,
        },
        {
          id: "eq-hot",
          companyId: "company-hot",
          companyName: "Hot Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Hot asset",
          lat: 2,
          lng: 2,
        },
        {
          id: "eq-warm",
          companyId: "company-warm",
          companyName: "Warm Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Warm asset",
          lat: 3,
          lng: 3,
        },
        {
          id: "eq-cold",
          companyId: "company-cold",
          companyName: "Cold Co",
          ownership: "customer_owned",
          availability: "available",
          name: "Cold asset",
          lat: 4,
          lng: 4,
        },
      ],
      deals: [
        { id: "deal-critical", companyId: "company-critical", amount: 100000 },
        { id: "deal-hot", companyId: "company-hot", amount: 50000 },
        { id: "deal-warm", companyId: "company-warm", amount: 1000 },
      ],
      visitRecommendations: [
        { companyId: "company-critical", companyName: "Critical Co", priorityScore: 99 },
        { companyId: "company-hot", companyName: "Hot Co", priorityScore: 80 },
      ],
      tradeSignals: [{ equipmentId: "eq-critical" }],
    });

    const byCompany = new Map(board.rows.map((row) => [row.companyId ?? row.id, row]));

    expect(byCompany.get("company-critical")?.urgency).toBe("critical");
    expect(byCompany.get("company-hot")?.urgency).toBe("hot");
    expect(byCompany.get("company-warm")?.urgency).toBe("warm");
    expect(byCompany.get("company-cold")?.urgency).toBe("cold");

    expect(byCompany.get("company-critical")?.routeCandidate).toBe(true);
    expect(byCompany.get("company-hot")?.routeCandidate).toBe(true);
    expect(byCompany.get("company-warm")?.routeCandidate).toBe(false);
    expect(byCompany.get("company-cold")?.routeCandidate).toBe(false);

    expect(byCompany.get("company-cold")?.reasons).toEqual(["Mapped customer-owned equipment location"]);
    expect(byCompany.get("company-critical")?.openDealCount).toBe(1);
    expect(byCompany.get("company-hot")?.openDealCount).toBe(1);
    expect(byCompany.get("company-warm")?.openDealCount).toBe(1);
    expect(byCompany.get("company-cold")?.openDealCount).toBe(0);

    expect(board.summary.criticalAccounts).toBe(1);
    expect(board.summary.routeCandidates).toBe(2);
  });

  it("adds uploaded UCC prospects as hot route candidates without a CRM account", () => {
    const prospects = parseUccProspectCsv([
      "Company,Latitude,Longitude,Secured Party,Filing Date,Collateral",
      '"Delta Dirt",35.148,-90.049,"Kubota Credit","2026-05-01","Excavator"',
    ].join("\n"));

    const board = buildOpportunityMapBoard({
      equipment: [],
      deals: [],
      visitRecommendations: [],
      tradeSignals: [],
      uccProspects: prospects,
    });

    expect(prospects).toEqual([{
      id: "delta-dirt-1",
      label: "Delta Dirt",
      lat: 35.148,
      lng: -90.049,
      source: "ucc_csv",
      lender: "Kubota Credit",
      filingDate: "2026-05-01",
      collateral: "Excavator",
    }]);
    expect(board.summary.mappedAccounts).toBe(1);
    expect(board.summary.routeCandidates).toBe(1);
    expect(board.rows[0]).toMatchObject({
      id: "prospect:delta-dirt-1",
      companyId: null,
      kind: "prospect",
      urgency: "hot",
      routeCandidate: true,
      reasons: [
        "UCC prospect import",
        "Lender: Kubota Credit",
        "Filed: 2026-05-01",
        "Collateral: Excavator",
      ],
    });
  });
});

describe("buildOpportunityRoute", () => {
  function makeRow(partial: Partial<OpportunityMapMarkerRow> & Pick<OpportunityMapMarkerRow, "id" | "label" | "lat" | "lng">): OpportunityMapMarkerRow {
    return {
      companyId: "company",
      kind: "account",
      openRevenue: 0,
      visitTargetCount: 0,
      tradeSignalCount: 0,
      score: 0,
      urgency: "cold",
      reasons: [],
      routeCandidate: false,
      openDealCount: 0,
      ...partial,
    };
  }

  it("selects visible route-candidate account rows by score and respects limit", () => {
    const rows: OpportunityMapMarkerRow[] = [
      makeRow({ id: "rental", label: "Rental", lat: 0, lng: 0, kind: "rental", routeCandidate: true, score: 100 }),
      makeRow({ id: "warm", label: "Warm", lat: 0, lng: 1, routeCandidate: false, score: 70 }),
      makeRow({ id: "hot-1", label: "Hot 1", lat: 0, lng: 2, routeCandidate: true, score: 60 }),
      makeRow({ id: "critical", label: "Critical", lat: 0, lng: 3, routeCandidate: true, score: 90 }),
      makeRow({ id: "hot-2", label: "Hot 2", lat: 0, lng: 4, routeCandidate: true, score: 60 }),
    ];

    const route = buildOpportunityRoute(rows, 2);
    expect(route.stops.map((row) => row.id)).toEqual(["critical", "hot-1"]);
  });

  it("orders selected stops using nearest-neighbor and returns total straight-line miles", () => {
    const route = buildOpportunityRoute([
      makeRow({ id: "start", label: "Start", lat: 40.7128, lng: -74.006, routeCandidate: true, score: 100 }),
      makeRow({ id: "near", label: "Near", lat: 40.73061, lng: -73.935242, routeCandidate: true, score: 80 }),
      makeRow({ id: "far", label: "Far", lat: 34.0522, lng: -118.2437, routeCandidate: true, score: 70 }),
    ]);

    expect(route.stops.map((stop) => stop.id)).toEqual(["start", "near", "far"]);
    expect(route.estimatedMiles).toBeGreaterThan(2400);
    expect(route.estimatedMiles).toBeLessThan(2600);
  });

  it("builds google maps URL when at least one stop exists and omits it when empty", () => {
    const empty = buildOpportunityRoute([]);
    expect(empty.googleMapsUrl).toBeNull();
    expect(empty.estimatedMiles).toBe(0);

    const single = buildOpportunityRoute([
      makeRow({ id: "only", label: "Only", lat: 41.8781, lng: -87.6298, routeCandidate: true, score: 90 }),
    ]);

    expect(single.googleMapsUrl).toContain("https://www.google.com/maps/dir/?api=1");
    expect(single.googleMapsUrl).toContain("destination=41.8781%2C-87.6298");
    expect(single.googleMapsUrl).not.toContain("waypoints=");
    expect(single.estimatedMiles).toBe(0);
  });

  it("includes routeable UCC prospects in the drive plan", () => {
    const route = buildOpportunityRoute([
      makeRow({
        id: "prospect:delta-dirt-1",
        label: "Delta Dirt",
        lat: 35.148,
        lng: -90.049,
        kind: "prospect",
        urgency: "hot",
        routeCandidate: true,
        score: 55,
      }),
    ]);

    expect(route.stops.map((stop) => stop.id)).toEqual(["prospect:delta-dirt-1"]);
    expect(route.googleMapsUrl).toContain("destination=35.148%2C-90.049");
  });
});
