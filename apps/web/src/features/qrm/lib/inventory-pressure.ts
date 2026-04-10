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
  return (
    asset.ownership !== "customer_owned" &&
    asset.availability !== "sold" &&
    asset.availability !== "decommissioned"
  );
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
      reasons.push(`${days} days in inventory`);
      aged.push({ ...asset, pressureReasons: [...reasons] });
    }

    if (asset.openQuotes > 0 || asset.availability === "reserved") {
      const hotReasons = [];
      if (asset.openQuotes > 0) hotReasons.push(`${asset.openQuotes} open quote${asset.openQuotes === 1 ? "" : "s"}`);
      if (asset.availability === "reserved") hotReasons.push("reserved for live sales motion");
      hot.push({ ...asset, pressureReasons: hotReasons });
    }

    if ((asset.photoUrls.length === 0 || asset.currentMarketValue == null) && asset.availability === "available") {
      const underReasons = [];
      if (asset.photoUrls.length === 0) underReasons.push("no photos on file");
      if (asset.currentMarketValue == null) underReasons.push("no market price set");
      underMarketed.push({ ...asset, pressureReasons: underReasons });
    }

    if (
      asset.availability === "available" &&
      (
        asset.currentMarketValue == null ||
        asset.latestEstimatedFmv == null ||
        (marketDeltaPct != null && marketDeltaPct >= 0.15)
      )
    ) {
      const priceReasons = [];
      if (asset.currentMarketValue == null) {
        priceReasons.push("current market value missing");
      } else if (asset.latestEstimatedFmv == null) {
        priceReasons.push("no recent market valuation");
      } else {
        priceReasons.push(`FMV delta ${Math.round(marketDeltaPct! * 100)}%`);
      }
      priceMisaligned.push({ ...asset, pressureReasons: priceReasons });
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
