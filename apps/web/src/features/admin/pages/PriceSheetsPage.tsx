import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RequireAdmin } from "@/components/RequireAdmin";
import { BrandFreshnessTable } from "../components/BrandFreshnessTable";
import { UploadDrawer } from "../components/UploadDrawer";
import { FreightZoneDrawer } from "../components/FreightZoneDrawer";
import { getBrandSheetStatus, type BrandSheetStatus } from "../lib/price-sheets-api";

type SelectedBrand = { id: string; code: string; name: string } | null;

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
  const [loading, setLoading] = useState(true);
  const [uploadBrand, setUploadBrand] = useState<SelectedBrand>(null);
  const [zonesBrand,  setZonesBrand]  = useState<SelectedBrand>(null);

  const refetch = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getBrandSheetStatus().then((data: BrandSheetStatus[]) => {
      if (!cancelled) {
        setRows(data);
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
          Manage brand price sheet uploads, freight zones, and Deal Engine configuration.
        </p>
      </div>

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
          <span className="text-2xl font-bold text-orange-500">{noFreight}</span>
          <span className="text-muted-foreground ml-1">No Freight</span>
        </div>
      </div>

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
