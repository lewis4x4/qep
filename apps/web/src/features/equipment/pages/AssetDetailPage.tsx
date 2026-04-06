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
          <AskIronAdvisorButton contextType="equipment" contextId={equipment.id} variant="inline" />
        </div>
      </div>

      {/* Badge row */}
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
          {activeTab === "parts" && <PlaceholderTab label="Parts spend history" detail="Lifetime parts orders for this asset will render here." />}
          {activeTab === "deal" && <DealTab data={data} />}
          {activeTab === "telematics" && <PlaceholderTab label="Telematics trend" detail="Run/idle hours, fault codes, and coolant trends from telematics_readings." />}
          {activeTab === "docs" && <PlaceholderTab label="Documents" detail="Operator manuals, warranty certs, service records — see /portal/documents for the customer view." />}
          {activeTab === "photos" && <PlaceholderTab label="Photos" detail="Equipment photos from the equipment_photos bucket." />}
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

function PlaceholderTab({ label, detail }: { label: string; detail: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
