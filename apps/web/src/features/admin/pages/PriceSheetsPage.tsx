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
import { SheetSourcesSection } from "../components/SheetSourcesSection";
import { WatchdogApprovalCard } from "../components/WatchdogApprovalCard";
import { getBrandSheetStatus, type BrandSheetStatus } from "../lib/price-sheets-api";

type SelectedBrand = { id: string; code: string; name: string } | null;

/**
 * Slice 16: shape of a watchdog-ingested sheet awaiting review. Loaded via
 * a separate query alongside the dashboard so the Moonshot banner is
 * visible on the main tab without a click.
 */
interface WatchdogPendingSheet {
  id:            string;
  brand_name:    string | null;
  source_label:  string | null;
}

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
  const [pendingWatchdog, setPendingWatchdog] = useState<WatchdogPendingSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadBrand, setUploadBrand] = useState<SelectedBrand>(null);
  const [zonesBrand,  setZonesBrand]  = useState<SelectedBrand>(null);

  const refetch = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getBrandSheetStatus(),
      loadWatchdogPending(),
    ]).then(([brandRows, pending]) => {
      if (!cancelled) {
        setRows(brandRows);
        setPendingWatchdog(pending);
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

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="watchdog">
            Watchdog
            {pendingWatchdog.length > 0 && (
              <Badge variant="default" className="ml-2">{pendingWatchdog.length}</Badge>
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

          {/* Slice 16: Watchdog pending-review banners */}
          {pendingWatchdog.map((p) => (
            <WatchdogApprovalCard
              key={p.id}
              priceSheetId={p.id}
              brandName={p.brand_name}
              sourceLabel={p.source_label}
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
 * Fetch every pending_review sheet that was auto-ingested via the watchdog
 * (source_id is not null), along with the human-readable brand + source
 * label for the approval banner.
 */
async function loadWatchdogPending(): Promise<WatchdogPendingSheet[]> {
  const { data } = await supabase
    .from("qb_price_sheets")
    .select("id, status, source_id, qb_brands!brand_id(name), qb_brand_sheet_sources!source_id(label)")
    .eq("status", "pending_review")
    .not("source_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  // The Supabase client types this join as `<table>: Array<{...}>`; in
  // practice the FK is 1:1 so we receive a single-element array or null.
  // Unwrap defensively to avoid runtime surprises.
  type JoinedRow = {
    id:                       string;
    qb_brands?:               Array<{ name: string }> | { name: string } | null;
    qb_brand_sheet_sources?:  Array<{ label: string }> | { label: string } | null;
  };
  const rows = (data ?? []) as unknown as JoinedRow[];
  const pickName = (v: JoinedRow["qb_brands"]): string | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0]?.name ?? null;
    return v.name ?? null;
  };
  const pickLabel = (v: JoinedRow["qb_brand_sheet_sources"]): string | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0]?.label ?? null;
    return v.label ?? null;
  };

  return rows.map((row) => ({
    id:           row.id,
    brand_name:   pickName(row.qb_brands),
    source_label: pickLabel(row.qb_brand_sheet_sources),
  }));
}
