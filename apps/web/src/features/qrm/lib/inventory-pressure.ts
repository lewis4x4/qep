export interface InventoryPressureAsset {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  availability: "available" | "rented" | "sold" | "in_service" | "in_transit" | "reserved" | "decommissioned";
  condition: "new" | "excellent" | "good" | "fair" | "poor" | "salvage" | null;
  createdAt: string;
  currentMarketValue: number | null;
  replacementCost: number | null;
  photoUrls: string[];
  openQuotes: number;
  latestEstimatedFmv: number | null;
}

export interface InventoryPressureBucketItem extends InventoryPressureAsset {
  pressureReasons: string[];
}

export interface InventoryPressureBoard {
  aged: InventoryPressureBucketItem[];
  hot: InventoryPressureBucketItem[];
  underMarketed: InventoryPressureBucketItem[];
  priceMisaligned: InventoryPressureBucketItem[];
}

function ageDays(createdAt: string, nowTime: number): number {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor((nowTime - parsed) / 86_400_000);
}

function isInventoryUnit(asset: InventoryPressureAsset): boolean {
  // Every non-terminal unit is a potential pressure surface.
  //   - "sold" / "decommissioned" are out of play.
  //   - Owned, leased, rental-fleet units carry sales/inventory pressure.
  //   - Customer-owned units carry relationship pressure (aged since touch,
  //     missing photos for field ID, no valuation for trade-in quoting).
  // Ownership is reflected in the pressure reasons, not in the filter.
  return asset.availability !== "sold" && asset.availability !== "decommissioned";
}

function frameAge(days: number, ownership: InventoryPressureAsset["ownership"]): string {
  if (ownership === "customer_owned") return `${days} days since last touch`;
  if (ownership === "rental_fleet") return `${days} days on the lot`;
  return `${days} days in inventory`;
}

function frameUnderMerchandised(ownership: InventoryPressureAsset["ownership"]): {
  missingPhotos: string;
  missingPrice: string;
} {
  if (ownership === "customer_owned") {
    return {
      missingPhotos: "no photos — can't identify in field",
      missingPrice: "no valuation — can't quote trade-in",
    };
  }
  return {
    missingPhotos: "no photos on file",
    missingPrice: "no market price set",
  };
}

export function buildInventoryPressureBoard(
  assets: InventoryPressureAsset[],
  nowTime = Date.now(),
): InventoryPressureBoard {
  const inventory = assets.filter(isInventoryUnit);

  const aged: InventoryPressureBucketItem[] = [];
  const hot: InventoryPressureBucketItem[] = [];
  const underMarketed: InventoryPressureBucketItem[] = [];
  const priceMisaligned: InventoryPressureBucketItem[] = [];

  for (const asset of inventory) {
    const reasons: string[] = [];
    const days = ageDays(asset.createdAt, nowTime);
    const marketDeltaPct = asset.latestEstimatedFmv && asset.currentMarketValue
      ? Math.abs(asset.currentMarketValue - asset.latestEstimatedFmv) / asset.latestEstimatedFmv
      : null;

    if (days >= 90 && (asset.availability === "available" || asset.availability === "reserved")) {
      reasons.push(frameAge(days, asset.ownership));
      aged.push({ ...asset, pressureReasons: [...reasons] });
    }

    if (asset.openQuotes > 0 || asset.availability === "reserved") {
      const hotReasons = [];
      if (asset.openQuotes > 0) hotReasons.push(`${asset.openQuotes} open quote${asset.openQuotes === 1 ? "" : "s"}`);
      if (asset.availability === "reserved") hotReasons.push("reserved for live sales motion");
      hot.push({ ...asset, pressureReasons: hotReasons });
    }

    if ((asset.photoUrls.length === 0 || asset.currentMarketValue == null) && asset.availability === "available") {
      const frames = frameUnderMerchandised(asset.ownership);
      const underReasons = [];
      if (asset.photoUrls.length === 0) underReasons.push(frames.missingPhotos);
      if (asset.currentMarketValue == null) underReasons.push(frames.missingPrice);
      underMarketed.push({ ...asset, pressureReasons: underReasons });
    }

    // Price-misaligned is an OPINION lane — we only flag it when we have
    // enough data to form a real price judgment. Missing market value or
    // missing FMV is captured under under-marketed instead, so this lane
    // stays high-signal.
    if (
      asset.availability === "available" &&
      asset.currentMarketValue != null &&
      asset.latestEstimatedFmv != null &&
      marketDeltaPct != null &&
      marketDeltaPct >= 0.15
    ) {
      const direction = asset.currentMarketValue > asset.latestEstimatedFmv ? "over" : "under";
      priceMisaligned.push({
        ...asset,
        pressureReasons: [`${direction} FMV by ${Math.round(marketDeltaPct * 100)}%`],
      });
    }
  }

  const sortFn = (a: InventoryPressureBucketItem, b: InventoryPressureBucketItem) => {
    if (b.openQuotes !== a.openQuotes) return b.openQuotes - a.openQuotes;
    return ageDays(b.createdAt, nowTime) - ageDays(a.createdAt, nowTime);
  };

  return {
    aged: aged.sort(sortFn),
    hot: hot.sort(sortFn),
    underMarketed: underMarketed.sort(sortFn),
    priceMisaligned: priceMisaligned.sort(sortFn),
  };
}
