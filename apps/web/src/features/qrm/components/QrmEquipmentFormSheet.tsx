import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  QrmEquipment,
  QrmEquipmentCategory,
  QrmEquipmentCondition,
  QrmEquipmentAvailability,
  QrmEquipmentOwnership,
} from "../lib/types";

const CATEGORY_OPTIONS: { value: QrmEquipmentCategory; label: string }[] = [
  { value: "excavator", label: "Excavator" },
  { value: "loader", label: "Loader" },
  { value: "backhoe", label: "Backhoe" },
  { value: "dozer", label: "Dozer" },
  { value: "skid_steer", label: "Skid Steer" },
  { value: "crane", label: "Crane" },
  { value: "forklift", label: "Forklift" },
  { value: "telehandler", label: "Telehandler" },
  { value: "truck", label: "Truck" },
  { value: "trailer", label: "Trailer" },
  { value: "dump_truck", label: "Dump Truck" },
  { value: "aerial_lift", label: "Aerial Lift" },
  { value: "boom_lift", label: "Boom Lift" },
  { value: "scissor_lift", label: "Scissor Lift" },
  { value: "compactor", label: "Compactor" },
  { value: "roller", label: "Roller" },
  { value: "generator", label: "Generator" },
  { value: "compressor", label: "Compressor" },
  { value: "pump", label: "Pump" },
  { value: "welder", label: "Welder" },
  { value: "attachment", label: "Attachment" },
  { value: "bucket", label: "Bucket" },
  { value: "breaker", label: "Breaker" },
  { value: "concrete", label: "Concrete" },
  { value: "paving", label: "Paving" },
  { value: "drill", label: "Drill" },
  { value: "boring", label: "Boring" },
  { value: "other", label: "Other" },
];

const CONDITION_OPTIONS: { value: QrmEquipmentCondition; label: string }[] = [
  { value: "new", label: "New" },
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "salvage", label: "Salvage" },
];

const AVAILABILITY_OPTIONS: { value: QrmEquipmentAvailability; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "rented", label: "Rented" },
  { value: "sold", label: "Sold" },
  { value: "in_service", label: "In Service" },
  { value: "in_transit", label: "In Transit" },
  { value: "reserved", label: "Reserved" },
  { value: "decommissioned", label: "Decommissioned" },
];

const OWNERSHIP_OPTIONS: { value: QrmEquipmentOwnership; label: string }[] = [
  { value: "owned", label: "Company Owned" },
  { value: "leased", label: "Leased" },
  { value: "customer_owned", label: "Customer Owned" },
  { value: "rental_fleet", label: "Rental Fleet" },
  { value: "consignment", label: "Consignment" },
];

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none";

interface EquipmentDraft {
  name: string;
  make: string;
  model: string;
  year: string;
  category: QrmEquipmentCategory | "";
  assetTag: string;
  serialNumber: string;
  vinPin: string;
  condition: QrmEquipmentCondition | "";
  availability: QrmEquipmentAvailability;
  ownership: QrmEquipmentOwnership;
  engineHours: string;
  mileage: string;
  fuelType: string;
  weightClass: string;
  operatingCapacity: string;
  locationDescription: string;
  purchasePrice: string;
  currentMarketValue: string;
  replacementCost: string;
  dailyRentalRate: string;
  weeklyRentalRate: string;
  monthlyRentalRate: string;
  warrantyExpiresOn: string;
  lastInspectionAt: string;
  nextServiceDueAt: string;
  notes: string;
}

function emptyDraft(): EquipmentDraft {
  return {
    name: "",
    make: "",
    model: "",
    year: "",
    category: "",
    assetTag: "",
    serialNumber: "",
    vinPin: "",
    condition: "",
    availability: "available",
    ownership: "customer_owned",
    engineHours: "",
    mileage: "",
    fuelType: "",
    weightClass: "",
    operatingCapacity: "",
    locationDescription: "",
    purchasePrice: "",
    currentMarketValue: "",
    replacementCost: "",
    dailyRentalRate: "",
    weeklyRentalRate: "",
    monthlyRentalRate: "",
    warrantyExpiresOn: "",
    lastInspectionAt: "",
    nextServiceDueAt: "",
    notes: "",
  };
}

function draftFromEquipment(eq: QrmEquipment): EquipmentDraft {
  return {
    name: eq.name,
    make: eq.make ?? "",
    model: eq.model ?? "",
    year: eq.year != null ? String(eq.year) : "",
    category: eq.category ?? "",
    assetTag: eq.assetTag ?? "",
    serialNumber: eq.serialNumber ?? "",
    vinPin: eq.vinPin ?? "",
    condition: eq.condition ?? "",
    availability: eq.availability,
    ownership: eq.ownership,
    engineHours: eq.engineHours != null ? String(eq.engineHours) : "",
    mileage: eq.mileage != null ? String(eq.mileage) : "",
    fuelType: eq.fuelType ?? "",
    weightClass: eq.weightClass ?? "",
    operatingCapacity: eq.operatingCapacity ?? "",
    locationDescription: eq.locationDescription ?? "",
    purchasePrice: eq.purchasePrice != null ? String(eq.purchasePrice) : "",
    currentMarketValue: eq.currentMarketValue != null ? String(eq.currentMarketValue) : "",
    replacementCost: eq.replacementCost != null ? String(eq.replacementCost) : "",
    dailyRentalRate: eq.dailyRentalRate != null ? String(eq.dailyRentalRate) : "",
    weeklyRentalRate: eq.weeklyRentalRate != null ? String(eq.weeklyRentalRate) : "",
    monthlyRentalRate: eq.monthlyRentalRate != null ? String(eq.monthlyRentalRate) : "",
    warrantyExpiresOn: eq.warrantyExpiresOn ?? "",
    lastInspectionAt: eq.lastInspectionAt ? eq.lastInspectionAt.split("T")[0] : "",
    nextServiceDueAt: eq.nextServiceDueAt ? eq.nextServiceDueAt.split("T")[0] : "",
    notes: eq.notes ?? "",
  };
}

export function draftToPayload(draft: EquipmentDraft) {
  const numOrNull = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const dateOrNull = (v: string) => (v ? new Date(v).toISOString() : null);

  return {
    name: draft.name.trim(),
    make: draft.make.trim() || null,
    model: draft.model.trim() || null,
    year: numOrNull(draft.year),
    category: draft.category || null,
    assetTag: draft.assetTag.trim() || null,
    serialNumber: draft.serialNumber.trim() || null,
    vinPin: draft.vinPin.trim() || null,
    condition: draft.condition || null,
    availability: draft.availability,
    ownership: draft.ownership,
    engineHours: numOrNull(draft.engineHours),
    mileage: numOrNull(draft.mileage),
    fuelType: draft.fuelType.trim() || null,
    weightClass: draft.weightClass.trim() || null,
    operatingCapacity: draft.operatingCapacity.trim() || null,
    locationDescription: draft.locationDescription.trim() || null,
    purchasePrice: numOrNull(draft.purchasePrice),
    currentMarketValue: numOrNull(draft.currentMarketValue),
    replacementCost: numOrNull(draft.replacementCost),
    dailyRentalRate: numOrNull(draft.dailyRentalRate),
    weeklyRentalRate: numOrNull(draft.weeklyRentalRate),
    monthlyRentalRate: numOrNull(draft.monthlyRentalRate),
    warrantyExpiresOn: draft.warrantyExpiresOn || null,
    lastInspectionAt: dateOrNull(draft.lastInspectionAt),
    nextServiceDueAt: dateOrNull(draft.nextServiceDueAt),
    notes: draft.notes.trim() || null,
  };
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="border-b border-border pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:pt-0">
      {children}
    </h3>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

interface QrmEquipmentFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: QrmEquipment | null;
  isPending: boolean;
  onSubmit: (payload: ReturnType<typeof draftToPayload>) => void;
}

export function QrmEquipmentFormSheet({
  open,
  onOpenChange,
  existing,
  isPending,
  onSubmit,
}: QrmEquipmentFormSheetProps) {
  const [draft, setDraft] = useState<EquipmentDraft>(() =>
    existing ? draftFromEquipment(existing) : emptyDraft(),
  );

  useEffect(() => {
    if (open) {
      setDraft(existing ? draftFromEquipment(existing) : emptyDraft());
    }
  }, [open, existing?.id]);

  const isEdit = !!existing;
  const canSave = draft.name.trim().length > 0;

  const update = <K extends keyof EquipmentDraft>(key: K, value: EquipmentDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) setDraft(existing ? draftFromEquipment(existing) : emptyDraft());
        onOpenChange(v);
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            {isEdit ? "Edit Equipment" : "Add Equipment"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update the equipment record with current information."
              : "Full equipment profile — fill in what you know now, add the rest later."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {/* ─── Identity ─────────────────────────────── */}
          <SectionHeading>Identity</SectionHeading>
          <div>
            <Label htmlFor="eq-name">Name *</Label>
            <Input id="eq-name" value={draft.name} onChange={(e) => update("name", e.target.value)} placeholder="CAT 320 Excavator" />
          </div>
          <FieldRow>
            <div>
              <Label htmlFor="eq-make">Make</Label>
              <Input id="eq-make" value={draft.make} onChange={(e) => update("make", e.target.value)} placeholder="Caterpillar" />
            </div>
            <div>
              <Label htmlFor="eq-model">Model</Label>
              <Input id="eq-model" value={draft.model} onChange={(e) => update("model", e.target.value)} placeholder="320F" />
            </div>
          </FieldRow>
          <FieldRow>
            <div>
              <Label htmlFor="eq-year">Year</Label>
              <Input id="eq-year" type="number" min={1900} max={2100} value={draft.year} onChange={(e) => update("year", e.target.value)} placeholder="2022" />
            </div>
            <div>
              <Label htmlFor="eq-category">Category</Label>
              <select id="eq-category" className={selectClass} value={draft.category} onChange={(e) => update("category", e.target.value as QrmEquipmentCategory)}>
                <option value="">Select…</option>
                {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </FieldRow>

          {/* ─── Identification ────────────────────────── */}
          <SectionHeading>Identification</SectionHeading>
          <FieldRow>
            <div>
              <Label htmlFor="eq-asset-tag">Asset Tag</Label>
              <Input id="eq-asset-tag" value={draft.assetTag} onChange={(e) => update("assetTag", e.target.value)} placeholder="QEP-EX-1003" />
            </div>
            <div>
              <Label htmlFor="eq-serial">Serial Number</Label>
              <Input id="eq-serial" value={draft.serialNumber} onChange={(e) => update("serialNumber", e.target.value)} placeholder="SN12345" />
            </div>
          </FieldRow>
          <div>
            <Label htmlFor="eq-vin">VIN / PIN</Label>
            <Input id="eq-vin" value={draft.vinPin} onChange={(e) => update("vinPin", e.target.value)} placeholder="Vehicle or Product ID Number" />
          </div>

          {/* ─── Status ────────────────────────────────── */}
          <SectionHeading>Status &amp; Ownership</SectionHeading>
          <FieldRow>
            <div>
              <Label htmlFor="eq-condition">Condition</Label>
              <select id="eq-condition" className={selectClass} value={draft.condition} onChange={(e) => update("condition", e.target.value as QrmEquipmentCondition)}>
                <option value="">Select…</option>
                {CONDITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="eq-availability">Availability</Label>
              <select id="eq-availability" className={selectClass} value={draft.availability} onChange={(e) => update("availability", e.target.value as QrmEquipmentAvailability)}>
                {AVAILABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </FieldRow>
          <div>
            <Label htmlFor="eq-ownership">Ownership</Label>
            <select id="eq-ownership" className={selectClass} value={draft.ownership} onChange={(e) => update("ownership", e.target.value as QrmEquipmentOwnership)}>
              {OWNERSHIP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* ─── Specs ─────────────────────────────────── */}
          <SectionHeading>Specifications</SectionHeading>
          <FieldRow>
            <div>
              <Label htmlFor="eq-hours">Engine Hours</Label>
              <Input id="eq-hours" type="number" min={0} step="0.1" value={draft.engineHours} onChange={(e) => update("engineHours", e.target.value)} placeholder="3,240" />
            </div>
            <div>
              <Label htmlFor="eq-miles">Mileage</Label>
              <Input id="eq-miles" type="number" min={0} step="0.1" value={draft.mileage} onChange={(e) => update("mileage", e.target.value)} placeholder="45,000" />
            </div>
          </FieldRow>
          <FieldRow>
            <div>
              <Label htmlFor="eq-fuel">Fuel Type</Label>
              <Input id="eq-fuel" value={draft.fuelType} onChange={(e) => update("fuelType", e.target.value)} placeholder="Diesel" />
            </div>
            <div>
              <Label htmlFor="eq-weight">Weight Class</Label>
              <Input id="eq-weight" value={draft.weightClass} onChange={(e) => update("weightClass", e.target.value)} placeholder="20-ton" />
            </div>
          </FieldRow>
          <div>
            <Label htmlFor="eq-capacity">Operating Capacity</Label>
            <Input id="eq-capacity" value={draft.operatingCapacity} onChange={(e) => update("operatingCapacity", e.target.value)} placeholder="3,200 lbs" />
          </div>

          {/* ─── Location ──────────────────────────────── */}
          <SectionHeading>Location</SectionHeading>
          <div>
            <Label htmlFor="eq-location">Location</Label>
            <Input id="eq-location" value={draft.locationDescription} onChange={(e) => update("locationDescription", e.target.value)} placeholder="Yard A — Memphis" />
          </div>

          {/* ─── Financials ────────────────────────────── */}
          <SectionHeading>Financials</SectionHeading>
          <FieldRow>
            <div>
              <Label htmlFor="eq-purchase">Purchase Price</Label>
              <Input id="eq-purchase" type="number" min={0} step="0.01" value={draft.purchasePrice} onChange={(e) => update("purchasePrice", e.target.value)} placeholder="$" />
            </div>
            <div>
              <Label htmlFor="eq-market">Market Value</Label>
              <Input id="eq-market" type="number" min={0} step="0.01" value={draft.currentMarketValue} onChange={(e) => update("currentMarketValue", e.target.value)} placeholder="$" />
            </div>
          </FieldRow>
          <div>
            <Label htmlFor="eq-replacement">Replacement Cost</Label>
            <Input id="eq-replacement" type="number" min={0} step="0.01" value={draft.replacementCost} onChange={(e) => update("replacementCost", e.target.value)} placeholder="$" />
          </div>

          {/* ─── Rental Rates ──────────────────────────── */}
          <SectionHeading>Rental Rates</SectionHeading>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="eq-daily">Daily</Label>
              <Input id="eq-daily" type="number" min={0} step="0.01" value={draft.dailyRentalRate} onChange={(e) => update("dailyRentalRate", e.target.value)} placeholder="$" />
            </div>
            <div>
              <Label htmlFor="eq-weekly">Weekly</Label>
              <Input id="eq-weekly" type="number" min={0} step="0.01" value={draft.weeklyRentalRate} onChange={(e) => update("weeklyRentalRate", e.target.value)} placeholder="$" />
            </div>
            <div>
              <Label htmlFor="eq-monthly">Monthly</Label>
              <Input id="eq-monthly" type="number" min={0} step="0.01" value={draft.monthlyRentalRate} onChange={(e) => update("monthlyRentalRate", e.target.value)} placeholder="$" />
            </div>
          </div>

          {/* ─── Service & Compliance ──────────────────── */}
          <SectionHeading>Service &amp; Compliance</SectionHeading>
          <FieldRow>
            <div>
              <Label htmlFor="eq-warranty">Warranty Expires</Label>
              <Input id="eq-warranty" type="date" value={draft.warrantyExpiresOn} onChange={(e) => update("warrantyExpiresOn", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="eq-inspection">Last Inspection</Label>
              <Input id="eq-inspection" type="date" value={draft.lastInspectionAt} onChange={(e) => update("lastInspectionAt", e.target.value)} />
            </div>
          </FieldRow>
          <div>
            <Label htmlFor="eq-next-service">Next Service Due</Label>
            <Input id="eq-next-service" type="date" value={draft.nextServiceDueAt} onChange={(e) => update("nextServiceDueAt", e.target.value)} />
          </div>

          {/* ─── Notes ─────────────────────────────────── */}
          <SectionHeading>Notes</SectionHeading>
          <div>
            <textarea
              id="eq-notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => update("notes", e.target.value)}
              className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              placeholder="Known issues, recent repairs, special attachments…"
            />
          </div>

          {/* ─── Actions ───────────────────────────────── */}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !canSave} onClick={() => onSubmit(draftToPayload(draft))}>
              {isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : isEdit ? (
                <Save className="mr-1 h-4 w-4" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              {isEdit ? "Save Changes" : "Add Equipment"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
