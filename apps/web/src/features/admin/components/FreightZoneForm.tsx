import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Loader2 } from "lucide-react";
import { StateCodeMultiSelect } from "./StateCodeMultiSelect";
import {
  upsertFreightZone,
  parseDollarInput,
  formatCentsAsDollars,
  type FreightZone,
} from "../lib/price-sheets-api";
import type { StateCode } from "../lib/us-states";

interface FreightZoneFormProps {
  brandId: string;
  workspaceId: string;
  existingZone: FreightZone | null;
  /** All other zones for this brand (excluding the one being edited) — used for overlap preview. */
  siblingZones: FreightZone[];
  onSaved: (zone: FreightZone) => void;
  onCancel: () => void;
}

function isZeroDollar(cents: number | null): boolean {
  return cents !== null && cents === 0;
}

export function FreightZoneForm({
  brandId,
  workspaceId,
  existingZone,
  siblingZones,
  onSaved,
  onCancel,
}: FreightZoneFormProps) {
  const [zoneName, setZoneName]     = useState(existingZone?.zone_name ?? "");
  const [stateCodes, setStateCodes] = useState<StateCode[]>(
    (existingZone?.state_codes ?? []) as StateCode[],
  );
  const [largeInput, setLargeInput] = useState(
    formatCentsAsDollars(existingZone?.freight_large_cents),
  );
  const [smallInput, setSmallInput] = useState(
    formatCentsAsDollars(existingZone?.freight_small_cents),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Overlap preview: states that are already covered by another zone
  const siblingStates = new Map<string, string>(); // state → zone_name
  for (const z of siblingZones) {
    for (const s of (z.state_codes ?? []) as string[]) {
      if (!siblingStates.has(s)) siblingStates.set(s, z.zone_name);
    }
  }
  const overlapPreview = stateCodes.filter((s) => siblingStates.has(s));

  const largeCents = parseDollarInput(largeInput);
  const smallCents = parseDollarInput(smallInput);
  const largeIsValid = largeCents !== null;
  const smallIsValid = smallCents !== null;
  const zeroLarge = isZeroDollar(largeCents);
  const zeroSmall = isZeroDollar(smallCents);

  const canSave =
    zoneName.trim().length > 0 &&
    stateCodes.length > 0 &&
    largeIsValid &&
    smallIsValid &&
    !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const result = await upsertFreightZone({
      id: existingZone?.id,
      workspace_id: workspaceId,
      brand_id: brandId,
      zone_name: zoneName.trim(),
      state_codes: stateCodes,
      freight_large_cents: largeCents!,
      freight_small_cents: smallCents!,
    });

    setSaving(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSaved(result.zone);
  }

  const overlapSet = new Set(overlapPreview);

  return (
    <div className="space-y-4 p-4 border border-border rounded-md bg-muted/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {existingZone ? "Edit zone" : "New zone"}
        </h3>
      </div>

      {/* Zone name */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Zone name</label>
        <Input
          value={zoneName}
          onChange={(e) => setZoneName(e.target.value)}
          placeholder="e.g. Southeast"
          disabled={saving}
        />
      </div>

      {/* State codes */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            States ({stateCodes.length} selected)
          </label>
          {stateCodes.length > 0 && (
            <button
              type="button"
              onClick={() => setStateCodes([])}
              disabled={saving}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        <StateCodeMultiSelect
          selected={stateCodes}
          onChange={setStateCodes}
          disabled={saving}
          overlapStates={overlapSet}
        />
        {overlapPreview.length > 0 && (
          <div className="text-xs text-warning flex items-start gap-1.5 mt-1">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              {overlapPreview.length === 1
                ? `${overlapPreview[0]} also appears in zone "${siblingStates.get(overlapPreview[0])}".`
                : `${overlapPreview.length} states already in other zones. Overlaps shown with amber ring.`}
            </span>
          </div>
        )}
      </div>

      {/* Dollar inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Large equipment
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <Input
              value={largeInput}
              onChange={(e) => setLargeInput(e.target.value)}
              placeholder="1,942.00"
              disabled={saving}
              className="pl-6"
            />
          </div>
          {largeInput && !largeIsValid && (
            <p className="text-xs text-destructive">Invalid amount</p>
          )}
          {zeroLarge && (
            <p className="text-xs text-warning">Zero freight — pickup only?</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Small equipment
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <Input
              value={smallInput}
              onChange={(e) => setSmallInput(e.target.value)}
              placeholder="777.00"
              disabled={saving}
              className="pl-6"
            />
          </div>
          {smallInput && !smallIsValid && (
            <p className="text-xs text-destructive">Invalid amount</p>
          )}
          {zeroSmall && (
            <p className="text-xs text-warning">Zero freight — pickup only?</p>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-destructive flex items-start gap-1.5 p-2 border border-destructive/30 bg-destructive/10 rounded">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!canSave}>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
          {existingZone ? "Save changes" : "Create zone"}
        </Button>
      </div>
    </div>
  );
}
