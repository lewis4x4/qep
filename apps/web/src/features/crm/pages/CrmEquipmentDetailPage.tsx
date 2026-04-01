import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  DollarSign,
  Edit,
  Fuel,
  Gauge,
  MapPin,
  Ruler,
  Shield,
  Tag,
  Wrench,
} from "lucide-react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserRole } from "@/lib/database.types";
import { useToast } from "@/hooks/use-toast";
import { getEquipmentById, patchEquipment } from "../lib/crm-router-api";
import { CrmEquipmentFormSheet, draftToPayload } from "../components/CrmEquipmentFormSheet";
import { EquipmentVision } from "@/components/EquipmentVision";

interface CrmEquipmentDetailPageProps {
  userId: string;
  userRole: UserRole;
}

const conditionColor: Record<string, string> = {
  new: "bg-emerald-500/15 text-emerald-400",
  excellent: "bg-emerald-500/15 text-emerald-400",
  good: "bg-sky-500/15 text-sky-400",
  fair: "bg-amber-500/15 text-amber-400",
  poor: "bg-orange-500/15 text-orange-400",
  salvage: "bg-red-500/15 text-red-400",
};

const availabilityColor: Record<string, string> = {
  available: "bg-emerald-500/15 text-emerald-400",
  rented: "bg-violet-500/15 text-violet-400",
  sold: "bg-zinc-500/15 text-zinc-400",
  in_service: "bg-amber-500/15 text-amber-400",
  in_transit: "bg-sky-500/15 text-sky-400",
  reserved: "bg-indigo-500/15 text-indigo-400",
  decommissioned: "bg-red-500/15 text-red-400",
};

function fmt(v: string) {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function currency(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function InfoRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {icon && <div className="mt-0.5 text-muted-foreground">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground">{value || "—"}</div>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border bg-card p-4 sm:p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </Card>
  );
}

export function CrmEquipmentDetailPage({ userId: _userId, userRole: _userRole }: CrmEquipmentDetailPageProps) {
  const { equipmentId } = useParams<{ equipmentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);

  const equipmentQuery = useQuery({
    queryKey: ["crm", "equipment", equipmentId],
    queryFn: () => getEquipmentById(equipmentId!),
    enabled: Boolean(equipmentId),
    staleTime: 15_000,
  });

  const patchMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof draftToPayload>) =>
      patchEquipment(equipmentId!, payload),
    onSuccess: async () => {
      setEditorOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["crm", "equipment", equipmentId] });
      toast({ title: "Equipment updated" });
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!equipmentId) return <Navigate to="/crm/companies" replace />;

  if (equipmentQuery.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted/40" />
        <div className="h-64 animate-pulse rounded bg-muted/40" />
      </div>
    );
  }

  if (equipmentQuery.isError || !equipmentQuery.data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Card className="p-8 text-center">
          <p className="text-destructive">Equipment not found or inaccessible.</p>
        </Card>
      </div>
    );
  }

  const eq = equipmentQuery.data;
  const subtitle = [eq.year, eq.make, eq.model].filter(Boolean).join(" ");
  const hasFinancials = eq.purchasePrice != null || eq.currentMarketValue != null || eq.replacementCost != null;
  const hasRates = eq.dailyRentalRate != null || eq.weeklyRentalRate != null || eq.monthlyRentalRate != null;
  const hasService = !!eq.warrantyExpiresOn || !!eq.lastInspectionAt || !!eq.nextServiceDueAt;

  const isOverdueInspection = eq.lastInspectionAt && new Date(eq.lastInspectionAt) < new Date(Date.now() - 365 * 86400000);
  const isServiceDueSoon = eq.nextServiceDueAt && new Date(eq.nextServiceDueAt) < new Date(Date.now() + 14 * 86400000);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      {/* ─── Header ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">{eq.name}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={availabilityColor[eq.availability] ?? ""}>
            {fmt(eq.availability)}
          </Badge>
          {eq.condition && (
            <Badge variant="outline" className={conditionColor[eq.condition] ?? ""}>
              {fmt(eq.condition)}
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
            <Edit className="mr-1 h-4 w-4" /> Edit
          </Button>
        </div>
      </div>

      {/* ─── Alerts ──────────────────────────────────── */}
      {(isOverdueInspection || isServiceDueSoon) && (
        <div className="space-y-2">
          {isOverdueInspection && (
            <div className="rounded-md border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm text-orange-300">
              <Shield className="mr-2 inline h-4 w-4" />
              Last inspection was over a year ago ({new Date(eq.lastInspectionAt!).toLocaleDateString()}).
            </div>
          )}
          {isServiceDueSoon && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
              <Wrench className="mr-2 inline h-4 w-4" />
              Service due {new Date(eq.nextServiceDueAt!).toLocaleDateString()}.
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─── Identity & Identification ─────────────── */}
        <SectionCard title="Identity">
          <div className="divide-y divide-border">
            <InfoRow label="Category" value={eq.category ? fmt(eq.category) : null} icon={<Wrench className="h-4 w-4" />} />
            <InfoRow label="Ownership" value={fmt(eq.ownership)} />
            <InfoRow label="Asset Tag" value={eq.assetTag} icon={<Tag className="h-4 w-4" />} />
            <InfoRow label="Serial Number" value={eq.serialNumber} />
            <InfoRow label="VIN / PIN" value={eq.vinPin} />
            {eq.companyId && (
              <InfoRow
                label="Company"
                value={<Link to={`/crm/companies/${eq.companyId}`} className="text-primary hover:underline">View company</Link>}
              />
            )}
          </div>
        </SectionCard>

        {/* ─── Specifications ────────────────────────── */}
        <SectionCard title="Specifications">
          <div className="divide-y divide-border">
            <InfoRow label="Engine Hours" value={eq.engineHours != null ? `${eq.engineHours.toLocaleString()} hrs` : null} icon={<Gauge className="h-4 w-4" />} />
            <InfoRow label="Mileage" value={eq.mileage != null ? `${eq.mileage.toLocaleString()} mi` : null} />
            <InfoRow label="Fuel Type" value={eq.fuelType} icon={<Fuel className="h-4 w-4" />} />
            <InfoRow label="Weight Class" value={eq.weightClass} icon={<Ruler className="h-4 w-4" />} />
            <InfoRow label="Operating Capacity" value={eq.operatingCapacity} />
          </div>
        </SectionCard>

        {/* ─── Location ──────────────────────────────── */}
        <SectionCard title="Location">
          <InfoRow label="Current Location" value={eq.locationDescription} icon={<MapPin className="h-4 w-4" />} />
          {eq.latitude != null && eq.longitude != null && (
            <InfoRow label="Coordinates" value={`${eq.latitude}, ${eq.longitude}`} />
          )}
        </SectionCard>

        {/* ─── Financials ────────────────────────────── */}
        {(hasFinancials || hasRates) && (
          <SectionCard title="Financials">
            <div className="divide-y divide-border">
              {hasFinancials && (
                <>
                  <InfoRow label="Purchase Price" value={currency(eq.purchasePrice)} icon={<DollarSign className="h-4 w-4" />} />
                  <InfoRow label="Market Value" value={currency(eq.currentMarketValue)} />
                  <InfoRow label="Replacement Cost" value={currency(eq.replacementCost)} />
                </>
              )}
              {hasRates && (
                <>
                  <InfoRow label="Daily Rate" value={currency(eq.dailyRentalRate)} />
                  <InfoRow label="Weekly Rate" value={currency(eq.weeklyRentalRate)} />
                  <InfoRow label="Monthly Rate" value={currency(eq.monthlyRentalRate)} />
                </>
              )}
            </div>
          </SectionCard>
        )}

        {/* ─── Service & Compliance ──────────────────── */}
        {hasService && (
          <SectionCard title="Service & Compliance">
            <div className="divide-y divide-border">
              <InfoRow label="Warranty Expires" value={eq.warrantyExpiresOn ? new Date(eq.warrantyExpiresOn).toLocaleDateString() : null} icon={<Shield className="h-4 w-4" />} />
              <InfoRow label="Last Inspection" value={eq.lastInspectionAt ? new Date(eq.lastInspectionAt).toLocaleDateString() : null} icon={<CalendarDays className="h-4 w-4" />} />
              <InfoRow label="Next Service Due" value={eq.nextServiceDueAt ? new Date(eq.nextServiceDueAt).toLocaleDateString() : null} icon={<Wrench className="h-4 w-4" />} />
            </div>
          </SectionCard>
        )}
      </div>

      {/* ─── Notes ───────────────────────────────────── */}
      {eq.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{eq.notes}</p>
        </SectionCard>
      )}

      {/* ─── Timestamps ──────────────────────────────── */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Created {new Date(eq.createdAt).toLocaleDateString()}</span>
        <span>Updated {new Date(eq.updatedAt).toLocaleDateString()}</span>
      </div>

      {/* ─── AI Vision Analysis ─────────────────────── */}
      <Card className="p-4 bg-white/5 border-white/10">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-qep-orange" />
          AI Equipment Analysis
        </h3>
        <EquipmentVision />
      </Card>

      {/* ─── Editor Sheet ────────────────────────────── */}
      <CrmEquipmentFormSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        existing={eq}
        isPending={patchMutation.isPending}
        onSubmit={(payload) => patchMutation.mutate(payload)}
      />
    </div>
  );
}
