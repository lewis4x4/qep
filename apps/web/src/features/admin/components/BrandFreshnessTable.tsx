import { UrgencyBadge } from "./UrgencyBadge";
import { Badge } from "@/components/ui/badge";
import type { BrandSheetStatus } from "../lib/price-sheets-api";

interface BrandFreshnessTableProps {
  rows: BrandSheetStatus[];
  onUpload: (brandId: string, brandCode: string, brandName: string) => void;
  onManageZones: (brandId: string, brandCode: string, brandName: string) => void;
}

export function BrandFreshnessTable({ rows, onUpload, onManageZones }: BrandFreshnessTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Brand</th>
            <th className="pb-2 pr-4 font-medium">Freshness</th>
            <th className="pb-2 pr-4 font-medium">Version</th>
            <th className="pb-2 pr-4 font-medium">Items</th>
            <th className="pb-2 pr-4 font-medium">Freight Zones</th>
            <th className="pb-2 pr-4 font-medium">Deal Engine</th>
            <th className="pb-2 pr-4 font-medium">Pending</th>
            <th className="pb-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.brand_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="py-3 pr-4 font-medium">{row.brand_name}</td>
              <td className="py-3 pr-4">
                <UrgencyBadge lastUploadedAt={row.last_uploaded_at} />
              </td>
              <td className="py-3 pr-4 text-muted-foreground">
                {row.active_sheet_version ?? "—"}
              </td>
              <td className="py-3 pr-4 text-muted-foreground">
                {row.active_sheet_item_count > 0 ? row.active_sheet_item_count.toLocaleString() : "—"}
              </td>
              <td className="py-3 pr-4">
                {row.freight_zone_count > 0 ? (
                  <span className="text-foreground">{row.freight_zone_count}</span>
                ) : (
                  <span className="text-destructive font-medium">None</span>
                )}
              </td>
              <td className="py-3 pr-4">
                {row.discount_configured ? (
                  <Badge variant="success">Enabled</Badge>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </td>
              <td className="py-3 pr-4 text-muted-foreground">
                {row.pending_review_count > 0 ? (
                  <Badge variant="warning">{row.pending_review_count}</Badge>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => onUpload(row.brand_id, row.brand_code, row.brand_name)}
                    className="text-xs text-primary hover:underline"
                  >
                    Upload
                  </button>
                  <button
                    onClick={() => onManageZones(row.brand_id, row.brand_code, row.brand_name)}
                    className="text-xs text-primary hover:underline"
                  >
                    Zones
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
