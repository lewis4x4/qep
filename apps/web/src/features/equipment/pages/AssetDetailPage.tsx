import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Wrench, Package, FileText, Activity, FolderOpen, Image as ImageIcon, Briefcase,
} from "lucide-react";
import {
  AssetCountdownStack,
  AssetBadgeRow,
  Last24hStrip,
  AskIronAdvisorButton,
  StatusChipStack,
} from "@/components/primitives";
import { fetchAsset360, type Asset360Response } from "../lib/asset-360-api";
import { CommercialActionTab } from "../components/CommercialActionTab";
import { MachineLifecycleCard } from "../components/MachineLifecycleCard";
import { supabase } from "@/lib/supabase";
import {
  normalizeEquipmentDocumentRows,
  normalizeEquipmentPartsOrderRows,
  normalizeEquipmentTelematicsRows,
  type EquipmentPartsOrderRow,
  type EquipmentTelematicsRow,
  type EquipmentDocumentRow,
} from "../lib/equipment-row-normalizers";

type TabKey = "service" | "parts" | "deal" | "telematics" | "docs" | "photos" | "commercial";

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "commercial", label: "Commercial Action", icon: <Briefcase className="h-3 w-3" /> },
  { key: "service",    label: "Service",           icon: <Wrench className="h-3 w-3" /> },
  { key: "parts",      label: "Parts",             icon: <Package className="h-3 w-3" /> },
  { key: "deal",       label: "Deal",              icon: <FileText className="h-3 w-3" /> },
  { key: "telematics", label: "Telematics",        icon: <Activity className="h-3 w-3" /> },
  { key: "docs",       label: "Docs",              icon: <FolderOpen className="h-3 w-3" /> },
  { key: "photos",     label: "Photos",            icon: <ImageIcon className="h-3 w-3" /> },
];

const TELEMATICS_FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function AssetDetailPage() {
  const { equipmentId } = useParams<{ equipmentId: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>("commercial");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["asset-360", equipmentId],
    queryFn: () => fetchAsset360(equipmentId!),
    enabled: !!equipmentId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Card className="h-64 animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load asset.</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/qrm/companies">
              <ArrowLeft className="mr-1 h-3 w-3" /> Back
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const { equipment, company } = data;
  const titleParts = [equipment.year, equipment.make, equipment.model].filter(Boolean);

  const headerChips: Array<{ label: string; tone: "blue" | "neutral" | "orange" }> = [];
  if (equipment.serial_number) headerChips.push({ label: `S/N ${equipment.serial_number}`, tone: "neutral" });
  if (equipment.asset_tag) headerChips.push({ label: equipment.asset_tag, tone: "blue" });
  if (equipment.engine_hours != null) headerChips.push({ label: `${equipment.engine_hours.toLocaleString()} hrs`, tone: "orange" });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <Button asChild variant="ghost" size="sm" className="h-7 text-[11px] mb-2">
          <Link to={company ? `/qrm/companies/${company.id}` : "/qrm/companies"}>
            <ArrowLeft className="mr-1 h-3 w-3" aria-hidden />
            Back
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {company?.name ?? "—"}
            </p>
            <h1 className="mt-0.5 text-xl font-bold text-foreground">
              {titleParts.length > 0 ? titleParts.join(" ") : equipment.name}
            </h1>
            {titleParts.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">{equipment.name}</p>
            )}
            <div className="mt-2">
              <StatusChipStack chips={headerChips} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setActiveTab("telematics")}>
              <Activity className="mr-1 h-3 w-3" aria-hidden />
              Telematics lookup
            </Button>
            <Button size="sm" variant="outline" onClick={() => setActiveTab("commercial")}>
              Recommend Trade-Up
            </Button>
            <AskIronAdvisorButton contextType="equipment" contextId={equipment.id} variant="inline" />
          </div>
        </div>
      </div>

      {/* Badge row */}
      <MachineLifecycleCard
        equipmentId={equipment.id}
        serialNumber={equipment.serial_number}
        ownership={equipment.ownership}
        availability={equipment.availability}
      />

      <AssetBadgeRow equipmentId={equipment.id} />

      {/* Countdowns + Last24h */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AssetCountdownStack equipmentId={equipment.id} />
        <Last24hStrip equipmentId={equipment.id} />
      </div>

      {/* Tabs */}
      <div>
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => {
            const isActive = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? "border-qep-orange text-qep-orange"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          {activeTab === "commercial" && <CommercialActionTab data={data} />}
          {activeTab === "service" && <ServiceTab data={data} />}
          {activeTab === "parts" && <PartsTab equipmentId={equipment.id} lifetimeSpend={data.badges.lifetime_parts_spend} />}
          {activeTab === "deal" && <DealTab data={data} />}
          {activeTab === "telematics" && <TelematicsTab equipmentId={equipment.id} />}
          {activeTab === "docs" && <DocsTab equipmentId={equipment.id} />}
          {activeTab === "photos" && <PhotosTab photoUrls={equipment.photo_urls ?? []} />}
        </div>
      </div>
    </div>
  );
}

/* ── Tab subcomponents ──────────────────────────────────────────── */

function ServiceTab({ data }: { data: Asset360Response }) {
  if (!data.recent_service.length) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">No service history for this asset yet.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {data.recent_service.map((sj) => (
        <Card key={sj.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{sj.summary ?? "Service job"}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {sj.scheduled_for ? `Scheduled ${new Date(sj.scheduled_for).toLocaleDateString()}` : "Unscheduled"}
                {sj.completed_at && ` · Completed ${new Date(sj.completed_at).toLocaleDateString()}`}
              </p>
            </div>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
              {sj.status}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}

function DealTab({ data }: { data: Asset360Response }) {
  if (!data.open_deal) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">No open deal references this asset.</p>
      </Card>
    );
  }
  const d = data.open_deal;
  return (
    <Card className="p-4">
      <Link to={`/qrm/deals/${d.id}`} className="text-sm font-semibold text-foreground hover:text-qep-orange">
        {d.name}
      </Link>
      {d.amount && (
        <p className="mt-1 text-xs text-muted-foreground">${d.amount.toLocaleString()}</p>
      )}
    </Card>
  );
}

function PartsTab({ equipmentId, lifetimeSpend }: { equipmentId: string; lifetimeSpend: number }) {
  const fleetQuery = useQuery({
    queryKey: ["asset", "fleet-link", equipmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_fleet")
        .select("id")
        .eq("equipment_id", equipmentId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    staleTime: 60_000,
  });

  const ordersQuery = useQuery<EquipmentPartsOrderRow[]>({
    queryKey: ["asset", "parts-orders", equipmentId, fleetQuery.data],
    enabled: Boolean(fleetQuery.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_orders")
        .select("id, status, total, estimated_delivery, tracking_number, created_at")
        .eq("fleet_id", fleetQuery.data!)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return normalizeEquipmentPartsOrderRows(data);
    },
    staleTime: 60_000,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Parts history</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Lifetime parts spend {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(lifetimeSpend)}
          </p>
        </div>
      </div>
      {ordersQuery.isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading parts orders…</p>
      ) : (ordersQuery.data?.length ?? 0) === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No parts orders linked to this machine yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {ordersQuery.data?.map((order) => (
            <div key={order.id} className="rounded-lg border border-border/60 bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{order.status.replace(/_/g, " ")}</p>
                <p className="text-sm font-semibold text-foreground">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(order.total ?? 0)}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleDateString()}
                {order.estimated_delivery ? ` · ETA ${new Date(order.estimated_delivery).toLocaleDateString()}` : ""}
                {order.tracking_number ? ` · Tracking ${order.tracking_number}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TelematicsTab({ equipmentId }: { equipmentId: string }) {
  const telematicsQuery = useQuery<EquipmentTelematicsRow[]>({
    queryKey: ["asset", "telematics", equipmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telematics_feeds")
        .select("provider, device_serial, last_hours, last_lat, last_lng, last_reading_at, is_active")
        .eq("equipment_id", equipmentId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return normalizeEquipmentTelematicsRows(data);
    },
    staleTime: 60_000,
  });

  const activeFeeds = telematicsQuery.data ?? [];
  const freshFeedCount = activeFeeds.filter(isFreshTelematicsRow).length;
  const statusLabel = telematicsQuery.isLoading
    ? "Checking"
    : freshFeedCount > 0
      ? "Fresh feed"
      : activeFeeds.length > 0
        ? "Stale feed"
        : "Setup needed";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Telematics lookup</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tethr-ready fallback: shows linked feed data only; no live Tethr connection is configured here.
          </p>
        </div>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {statusLabel}
        </span>
      </div>
      {telematicsQuery.isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading telematics…</p>
      ) : activeFeeds.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border/70 bg-muted/10 p-3">
          <p className="text-sm font-medium text-foreground">Setup needed before Tethr fallback can show data.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Link an active provider-neutral telematics feed to this machine first. Once active feed rows exist, this lookup will surface hours, location, and last-reading data without claiming live Tethr integration.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {activeFeeds.map((row, index) => {
            const isFresh = isFreshTelematicsRow(row);
            return (
              <div key={`${row.provider}-${index}`} className="rounded-lg border border-border/60 bg-muted/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{row.provider}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Active feed data
                    </p>
                  </div>
                  <span className={`text-xs ${isFresh ? "text-emerald-400" : "text-amber-400"}`}>
                    {isFresh ? "fresh" : "stale"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.device_serial ? `Device ${row.device_serial}` : "No device serial"}
                  {row.last_hours != null ? ` · ${row.last_hours.toLocaleString()}h` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.last_reading_at ? `Last reading ${new Date(row.last_reading_at).toLocaleString()}` : "No recent reading"}
                  {row.last_lat != null && row.last_lng != null ? ` · ${row.last_lat}, ${row.last_lng}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function isFreshTelematicsRow(row: EquipmentTelematicsRow): boolean {
  if (!row.last_reading_at) return false;
  const lastReadingMs = new Date(row.last_reading_at).getTime();
  return Number.isFinite(lastReadingMs) && Date.now() - lastReadingMs <= TELEMATICS_FRESH_WINDOW_MS;
}

function DocsTab({ equipmentId }: { equipmentId: string }) {
  const docsQuery = useQuery<EquipmentDocumentRow[]>({
    queryKey: ["asset", "docs", equipmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipment_documents")
        .select("id, title, document_type, file_url, customer_visible, updated_at")
        .eq("crm_equipment_id", equipmentId)
        .order("updated_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return normalizeEquipmentDocumentRows(data);
    },
    staleTime: 60_000,
  });

  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-foreground">Documents</p>
      {docsQuery.isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading documents…</p>
      ) : (docsQuery.data?.length ?? 0) === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No documents linked to this machine yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {docsQuery.data?.map((doc) => (
            <a
              key={doc.id}
              href={doc.file_url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-border/60 bg-muted/10 p-3 hover:border-qep-orange/30"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{doc.title}</p>
                <span className="text-xs text-muted-foreground">{doc.document_type.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Updated {new Date(doc.updated_at).toLocaleDateString()} · {doc.customer_visible ? "customer visible" : "internal"}
              </p>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

function PhotosTab({ photoUrls }: { photoUrls: string[] }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-foreground">Photos</p>
      {photoUrls.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No equipment photos are linked to this machine yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photoUrls.map((url, index) => (
            <a key={index} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border/60 bg-muted/10">
              <img src={url} alt={`Equipment photo ${index + 1}`} className="h-32 w-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}
