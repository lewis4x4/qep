import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BrandDrilldownDetail, BrandSheetStatus } from "../../lib/price-sheets-api";

const mockLoadDetail = mock(async () => ({ ok: true as const, detail: fixtureDetail }));
const mockLoadSources = mock(async () => fixtureSources);
const mockLoadEvents = mock(async () => fixtureEvents);

const { BrandDrilldownDrawer } = await import("../BrandDrilldownDrawer");

const statusRow: BrandSheetStatus = {
  brand_id: "brand-asv",
  brand_name: "ASV",
  brand_code: "ASV",
  has_active_sheet: true,
  active_sheet_version: "v2026.04",
  active_sheet_item_count: 42,
  last_uploaded_at: new Date().toISOString(),
  pending_review_count: 1,
  discount_configured: true,
  has_inbound_freight_key: true,
  freight_zone_count: 2,
};

const fixtureDetail: BrandDrilldownDetail = {
  brand: { id: "brand-asv", code: "ASV", name: "ASV", discount_configured: true, has_inbound_freight_key: true },
  activeSheet: { id: "sheet-live", brand_id: "brand-asv", filename: "asv-2026.pdf", file_type: "pdf", sheet_type: "price_book", status: "published", uploaded_at: "2026-04-15T10:00:00Z", published_at: "2026-04-15T11:00:00Z", created_at: "2026-04-15T09:00:00Z", source_id: "source-1", version: "v2026.04" },
  sheetHistory: [{ id: "sheet-live", brand_id: "brand-asv", filename: "asv-2026.pdf", file_type: "pdf", sheet_type: "price_book", status: "published", uploaded_at: "2026-04-15T10:00:00Z", published_at: "2026-04-15T11:00:00Z", created_at: "2026-04-15T09:00:00Z", source_id: "source-1", version: "v2026.04" }],
  pendingSheets: [{ id: "sheet-pending", brand_id: "brand-asv", filename: "asv-pending.xlsx", file_type: "excel", sheet_type: "price_book", status: "pending_review", uploaded_at: "2026-05-01T10:00:00Z", published_at: null, created_at: "2026-05-01T09:00:00Z", source_id: null, version: "v2026.05" }],
  products: { rows: [{ id: "item-1", model_code: "RT-40", name_display: "Compact track loader", category: "Loaders", list_price_cents: 6425000 }], loadedCount: 1, limit: 100, hasMore: false },
  freight: {
    zones: [
      { id: "zone-1", workspace_id: "ws-test", brand_id: "brand-asv", zone_name: "Southeast", state_codes: ["FL", "GA"], freight_large_cents: 120000, freight_small_cents: 80000, effective_from: null, effective_to: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "zone-2", workspace_id: "ws-test", brand_id: "brand-asv", zone_name: "Northeast", state_codes: ["NY", "PA"], freight_large_cents: 140000, freight_small_cents: 90000, effective_from: null, effective_to: null, created_at: "2026-01-02T00:00:00Z" },
    ],
    coverage: { covered: ["FL", "GA", "NY", "PA"], uncovered: ["AL", "AK"], overlaps: [] },
  },
  readiness: { publishedSheetCount: 1, freightZoneCount: 2, activeProgramCount: 3, dealEngineEnabled: true, hasInboundFreightKey: true },
};

const fixtureSources = [
  { id: "source-1", workspace_id: "ws-test", brand_id: "brand-asv", label: "OEM portal", url: "https://example.com/asv", check_freq_hours: 24, last_checked_at: "2026-05-01T12:00:00Z", last_hash: null, last_etag: null, last_http_status: 500, last_error: "Portal timeout", consecutive_failures: 3, notes: null, active: true, created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", brand_name: "ASV", brand_code: "ASV" },
  { id: "source-other", workspace_id: "ws-test", brand_id: "brand-cat", label: "CAT source", url: null, check_freq_hours: 24, last_checked_at: "2026-05-01T12:00:00Z", last_hash: null, last_etag: null, last_http_status: 200, last_error: null, consecutive_failures: 0, notes: null, active: true, created_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", brand_name: "CAT", brand_code: "CAT" },
];
const fixtureEvents = [
  { id: "event-1", workspace_id: "ws-test", source_id: "source-1", event_type: "error", detail: null, price_sheet_id: null, created_at: "2026-05-01T12:00:00Z" },
  { id: "event-other", workspace_id: "ws-test", source_id: "source-other", event_type: "checked_unchanged", detail: null, price_sheet_id: null, created_at: "2026-05-01T12:00:00Z" },
];

function renderDrawer(overrides: Partial<Parameters<typeof BrandDrilldownDrawer>[0]> = {}) {
  return render(<BrandDrilldownDrawer open={true} statusRow={statusRow} onClose={() => undefined} onUpload={() => undefined} onManageZones={() => undefined} onOpenWatchdog={() => undefined} loadDetail={mockLoadDetail} loadSources={mockLoadSources} loadEvents={mockLoadEvents} {...overrides} />);
}

describe("BrandDrilldownDrawer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockLoadDetail.mockClear();
    mockLoadSources.mockClear();
    mockLoadEvents.mockClear();
  });

  test("loads and renders manager-facing brand detail", async () => {
    renderDrawer();
    expect(await screen.findByText("Products & pricing")).toBeTruthy();
    expect(screen.getByText("RT-40")).toBeTruthy();
    expect(screen.getByText("Compact track loader")).toBeTruthy();
    expect(screen.getByText("$64,250.00")).toBeTruthy();
    expect(screen.getByText("Pending uploads need review")).toBeTruthy();
    expect(screen.getByText("Freight coverage has gaps")).toBeTruthy();
    expect(screen.getByText("Deal Engine readiness")).toBeTruthy();
    expect(screen.getByText("Watchdog source unhealthy")).toBeTruthy();
    expect(screen.getByText("OEM portal")).toBeTruthy();
    expect(mockLoadDetail).toHaveBeenCalledWith("brand-asv");
  });

  test("actions close the drawer and call parent callbacks with brand context", async () => {
    const onClose = mock(() => undefined);
    const onUpload = mock(() => undefined);
    const onManageZones = mock(() => undefined);
    const onOpenWatchdog = mock(() => undefined);
    renderDrawer({ onClose, onUpload, onManageZones, onOpenWatchdog });
    await screen.findByText("Products & pricing");
    fireEvent.click(screen.getByRole("button", { name: /upload new sheet/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onUpload).toHaveBeenCalledWith("brand-asv", "ASV", "ASV");
    fireEvent.click(screen.getByRole("button", { name: /manage freight zones/i }));
    expect(onManageZones).toHaveBeenCalledWith("brand-asv", "ASV", "ASV");
    fireEvent.click(screen.getByRole("button", { name: /open watchdog/i }));
    expect(onOpenWatchdog).toHaveBeenCalled();
  });

  test("shows an API error state", async () => {
    mockLoadDetail.mockImplementationOnce(async () => ({ error: "Brand not found" }));
    renderDrawer();
    await waitFor(() => expect(screen.getByText("Could not load brand detail")).toBeTruthy());
    expect(screen.getByText("Brand not found")).toBeTruthy();
  });
});
