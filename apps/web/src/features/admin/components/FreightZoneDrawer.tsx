import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { FreightCoverageGrid } from "./FreightCoverageGrid";
import { FreightZoneForm } from "./FreightZoneForm";
import {
  getFreightZones,
  deleteFreightZone,
  analyzeFreightCoverage,
  formatCentsAsDollars,
  type FreightZone,
} from "../lib/price-sheets-api";
import type { StateCode } from "../lib/us-states";

export interface FreightZoneDrawerProps {
  open: boolean;
  onClose: () => void;
  brandId: string | null;
  brandName: string | null;
  workspaceId: string | null;
  /** Fires whenever a zone is saved or deleted so the parent can refetch counts. */
  onMutated: () => void;
}

export function FreightZoneDrawer({
  open,
  onClose,
  brandId,
  brandName,
  workspaceId,
  onMutated,
}: FreightZoneDrawerProps) {
  const [zones, setZones]           = useState<FreightZone[]>([]);
  const [loading, setLoading]       = useState(true);
  const [editingZoneId, setEditing] = useState<string | null>(null);
  const [creating, setCreating]     = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<StateCode | null>(null);

  // Load zones whenever drawer opens for a new brand
  useEffect(() => {
    if (!open || !brandId) return;
    let cancelled = false;
    setLoading(true);
    setEditing(null);
    setCreating(false);
    setFilterState(null);
    setConfirmDeleteId(null);
    getFreightZones(brandId).then((data) => {
      if (!cancelled) {
        setZones(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [open, brandId]);

  const coverage = useMemo(() => analyzeFreightCoverage(zones), [zones]);
  const overlapZoneIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of coverage.overlaps) {
      for (const id of o.zone_ids) ids.add(id);
    }
    return ids;
  }, [coverage]);

  const visibleZones = useMemo(() => {
    if (!filterState) return zones;
    return zones.filter((z) => (z.state_codes ?? []).includes(filterState));
  }, [zones, filterState]);

  async function refreshZones() {
    if (!brandId) return;
    const data = await getFreightZones(brandId);
    setZones(data);
    onMutated();
  }

  function handleSaved(zone: FreightZone) {
    // Replace or append
    setZones((prev) => {
      const idx = prev.findIndex((z) => z.id === zone.id);
      if (idx === -1) return [...prev, zone].sort((a, b) => a.zone_name.localeCompare(b.zone_name));
      const next = [...prev];
      next[idx] = zone;
      return next.sort((a, b) => a.zone_name.localeCompare(b.zone_name));
    });
    setEditing(null);
    setCreating(false);
    onMutated();
  }

  async function handleDelete(zoneId: string) {
    setDeletingId(zoneId);
    const result = await deleteFreightZone(zoneId);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if ("error" in result) {
      // eslint-disable-next-line no-alert
      alert(`Could not delete: ${result.error}`);
      return;
    }
    await refreshZones();
  }

  function handleOpenChange(next: boolean) {
    if (!next) onClose();
  }

  const editingZone = editingZoneId ? zones.find((z) => z.id === editingZoneId) ?? null : null;
  const formMode = creating || editingZone !== null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-5">
          <SheetTitle>Freight zones</SheetTitle>
          <SheetDescription>
            {brandName ? (
              <>
                Configure per-state freight rates for <span className="font-medium">{brandName}</span>.
                Large and small rates are used by the quote calculator.
              </>
            ) : (
              "Select a brand first."
            )}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading zones…
          </div>
        ) : (
          <>
            {/* Coverage grid */}
            {zones.length > 0 && (
              <div className="mb-5 p-3 border border-border rounded-md bg-background">
                <FreightCoverageGrid
                  coverage={coverage}
                  activeFilter={filterState}
                  onFilter={setFilterState}
                />
              </div>
            )}

            {/* Zone list or inline form */}
            {formMode ? (
              brandId && workspaceId && (
                <FreightZoneForm
                  brandId={brandId}
                  workspaceId={workspaceId}
                  existingZone={editingZone}
                  siblingZones={zones.filter((z) => z.id !== editingZone?.id)}
                  onSaved={handleSaved}
                  onCancel={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
                />
              )
            ) : (
              <div className="space-y-2">
                {visibleZones.length === 0 ? (
                  <div className="text-center py-8 border border-dashed rounded-md">
                    <p className="text-sm text-muted-foreground">
                      {filterState
                        ? `No zones cover ${filterState}.`
                        : zones.length === 0
                        ? "No freight zones yet."
                        : "No zones match this filter."}
                    </p>
                    {zones.length === 0 && (
                      <Button
                        size="sm"
                        className="mt-3"
                        onClick={() => setCreating(true)}
                        disabled={!brandId}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        Add your first zone
                      </Button>
                    )}
                  </div>
                ) : (
                  visibleZones.map((zone) => {
                    const hasOverlap = overlapZoneIds.has(zone.id);
                    const isConfirming = confirmDeleteId === zone.id;
                    const isDeleting = deletingId === zone.id;
                    return (
                      <div
                        key={zone.id}
                        className="p-3 border border-border rounded-md bg-background hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{zone.zone_name}</span>
                              {hasOverlap && (
                                <Badge variant="warning" className="text-[10px]">
                                  <AlertCircle className="w-3 h-3 mr-1" />
                                  overlap
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mb-2">
                              {(zone.state_codes ?? []).join(" · ") || "no states"}
                            </div>
                            <div className="flex gap-4 text-xs">
                              <div>
                                <span className="text-muted-foreground">Large: </span>
                                <span className="font-medium">
                                  ${formatCentsAsDollars(zone.freight_large_cents)}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Small: </span>
                                <span className="font-medium">
                                  ${formatCentsAsDollars(zone.freight_small_cents)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 items-end">
                            {isConfirming ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleDelete(zone.id)}
                                  disabled={isDeleting}
                                >
                                  {isDeleting ? (
                                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                  ) : (
                                    <Trash2 className="w-3 h-3 mr-1" />
                                  )}
                                  Confirm
                                </Button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-xs text-muted-foreground hover:underline"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditing(zone.id)}
                                  className="text-xs text-primary hover:underline"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(zone.id)}
                                  className="text-xs text-destructive hover:underline"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Add zone CTA (only when there are already zones) */}
                {zones.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCreating(true)}
                    disabled={!brandId}
                    className="w-full mt-2"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Add zone
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
