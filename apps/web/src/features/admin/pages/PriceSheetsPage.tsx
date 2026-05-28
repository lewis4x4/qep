import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RequireAdmin } from "@/components/RequireAdmin";
import { supabase } from "@/lib/supabase";
import { BrandFreshnessTable } from "../components/BrandFreshnessTable";
import { UploadDrawer } from "../components/UploadDrawer";
import { FreightZoneDrawer } from "../components/FreightZoneDrawer";
import { BrandDrilldownDrawer } from "../components/BrandDrilldownDrawer";
import { SheetSourcesSection } from "../components/SheetSourcesSection";
import { WatchdogApprovalCard } from "../components/WatchdogApprovalCard";
import { getBrandSheetStatus, type BrandSheetStatus } from "../lib/price-sheets-api";

type SelectedBrand = { id: string; code: string; name: string } | null;
type PriceSheetsTab = "dashboard" | "watchdog";

/**
 * Staged price sheets awaiting admin review. Includes manual uploads and
 * watchdog-detected sheets; source metadata is label-only, never a filter.
 */
interface StagedReviewSheet {
  id:            string;
  brand_id:      string | null;
  brand_name:    string | null;
  brand_code:    string | null;
  source_label:  string | null;
}

type StagedReviewSheetJoinRow = {
  id: string;
  brand_id: string | null;
  qb_brands?: Array<{ name: string; code: string }> | { name: string; code: string } | null;
  qb_brand_sheet_sources?: Array<{ label: string }> | { label: string } | null;
};

export function PriceSheetsPage() {
  return (
    <RequireAdmin>
      <PriceSheetsPageInner />
    </RequireAdmin>
  );
}

function PriceSheetsPageInner() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<BrandSheetStatus[]>([]);
  const [pendingReviewSheets, setPendingReviewSheets] = useState<StagedReviewSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PriceSheetsTab>("dashboard");
  const [drilldownBrand, setDrilldownBrand] = useState<BrandSheetStatus | null>(null);
  const [uploadBrand, setUploadBrand] = useState<SelectedBrand>(null);
  const [zonesBrand,  setZonesBrand]  = useState<SelectedBrand>(null);

  const refetch = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getBrandSheetStatus(),
      loadStagedReviewSheets(),
    ]).then(([brandRows, pending]) => {
      if (!cancelled) {
        setRows(brandRows);
        setPendingReviewSheets(pending);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return refetch();
  }, [refetch]);

  // Aggregate stats
  const totalBrands = rows.length;
  const missingSheet = rows.filter((r) => !r.has_active_sheet).length;
  const urgentSheet = rows.filter((r) => {
    if (!r.last_uploaded_at) return false;
    const ageDays = (Date.now() - new Date(r.last_uploaded_at).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays > 60;
  }).length;
  const noFreight = rows.filter((r) => r.freight_zone_count === 0).length;

  const handleUpload = (brandId: string, brandCode: string, brandName: string) => {
    setUploadBrand({ id: brandId, code: brandCode, name: brandName });
  };

  const handleManageZones = (brandId: string, brandCode: string, brandName: string) => {
    setZonesBrand({ id: brandId, code: brandCode, name: brandName });
  };

  const currentDrilldownRow = drilldownBrand
    ? rows.find((row) => row.brand_id === drilldownBrand.brand_id) ?? drilldownBrand
    : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Price Sheets</h1>
        <p className="text-muted-foreground mt-1">
          Manage brand price sheet uploads, freight zones, Deal Engine configuration, and the
          auto-watchdog that monitors manufacturer URLs for new books.
        </p>
        <div className="mt-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/base-options">
              Open Base &amp; Options
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PriceSheetsTab)}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="watchdog">
            Review Queue
            {pendingReviewSheets.length > 0 && (
              <Badge variant="default" className="ml-2">{pendingReviewSheets.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4 space-y-6">
          {/* Stats bar */}
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-2xl font-bold">{totalBrands}</span>
              <span className="text-muted-foreground ml-1">Brands</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-destructive">{missingSheet}</span>
              <span className="text-muted-foreground ml-1">No Sheet</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-destructive">{urgentSheet}</span>
              <span className="text-muted-foreground ml-1">Urgent</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-warning">{noFreight}</span>
              <span className="text-muted-foreground ml-1">No Freight</span>
            </div>
          </div>

          {/* Staged review banners for manual and watchdog uploads */}
          {pendingReviewSheets.map((p) => (
            <WatchdogApprovalCard
              key={p.id}
              priceSheetId={p.id}
              brandName={p.brand_name}
              sourceLabel={p.source_label}
              onMutated={refetch}
              onReview={() => {
                const row = p.brand_id ? rows.find((candidate) => candidate.brand_id === p.brand_id) : null;
                if (row) setDrilldownBrand(row);
              }}
            />
          ))}

          {/* Main table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Brand Sheet Status</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-4 px-6">
              {loading ? (
                <p className="text-muted-foreground py-8 text-sm">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-muted-foreground py-8 text-sm">No brands configured.</p>
              ) : (
                <BrandFreshnessTable
                  rows={rows}
                  onViewDetails={setDrilldownBrand}
                  onUpload={handleUpload}
                  onManageZones={handleManageZones}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="watchdog" className="mt-4">
          <SheetSourcesSection />
        </TabsContent>
      </Tabs>

      <BrandDrilldownDrawer
        open={currentDrilldownRow !== null}
        statusRow={currentDrilldownRow}
        onClose={() => setDrilldownBrand(null)}
        onUpload={(brandId, brandCode, brandName) => {
          setDrilldownBrand(null);
          handleUpload(brandId, brandCode, brandName);
        }}
        onManageZones={(brandId, brandCode, brandName) => {
          setDrilldownBrand(null);
          handleManageZones(brandId, brandCode, brandName);
        }}
        onOpenWatchdog={() => {
          setDrilldownBrand(null);
          setActiveTab("watchdog");
        }}
      />

      <UploadDrawer
        open={uploadBrand !== null}
        onClose={() => setUploadBrand(null)}
        brandId={uploadBrand?.id ?? null}
        brandName={uploadBrand?.name ?? null}
        brandCode={uploadBrand?.code ?? null}
        onSuccess={() => {
          setUploadBrand(null);
          refetch();
        }}
      />

      <FreightZoneDrawer
        open={zonesBrand !== null}
        onClose={() => {
          setZonesBrand(null);
          refetch();
        }}
        brandId={zonesBrand?.id ?? null}
        brandName={zonesBrand?.name ?? null}
        workspaceId={profile?.active_workspace_id ?? null}
        onMutated={refetch}
      />
    </div>
  );
}

/**
 * Fetch every staged review sheet, including manual uploads and watchdog
 * detections. `source_id` is metadata only; manual uploads still need review.
 */
async function loadStagedReviewSheets(): Promise<StagedReviewSheet[]> {
  const { data } = await supabase
    .from("qb_price_sheets")
    .select("id, status, source_id, brand_id, qb_brands!brand_id(name, code), qb_brand_sheet_sources!source_id(label)")
    .in("status", ["pending_review", "extracted"])
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<StagedReviewSheetJoinRow[]>();

  const pickBrand = (v: StagedReviewSheetJoinRow["qb_brands"]): { name: string | null; code: string | null } => {
    if (!v) return { name: null, code: null };
    const row = Array.isArray(v) ? v[0] : v;
    return { name: row?.name ?? null, code: row?.code ?? null };
  };
  const pickLabel = (v: StagedReviewSheetJoinRow["qb_brand_sheet_sources"]): string | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0]?.label ?? null;
    return v.label ?? null;
  };

  return (data ?? []).map((row) => {
    const brand = pickBrand(row.qb_brands);
    return {
      id:           row.id,
      brand_id:     row.brand_id,
      brand_name:   brand.name,
      brand_code:   brand.code,
      source_label: pickLabel(row.qb_brand_sheet_sources) ?? "Manual upload",
    };
  });
}
