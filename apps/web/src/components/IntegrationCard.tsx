/**
 * IntegrationCard — individual integration tile in the Admin Integration Hub grid.
 * Per CDO design direction §1 (IntegrationCard anatomy).
 */

import { useState } from "react";
import { Settings, RefreshCw, Plug } from "lucide-react";
import { trackIntegrationEvent } from "@/lib/track-event";
import { Button } from "@/components/ui/button";
import { DataSourceBadge, type DataSourceState } from "./DataSourceBadge";
import { cn } from "@/lib/utils";
import type { IntegrationCardConfig } from "./IntegrationHub";

interface IntegrationCardProps {
  config: IntegrationCardConfig;
  onConfigure: (key: string) => void;
  onTestSync: (key: string) => void;
}

function statusToDataSource(status: IntegrationCardConfig["status"]): DataSourceState {
  switch (status) {
    case "connected": return "Live";
    case "demo_mode": return "Demo";
    case "pending_credentials": return "Manual";
    case "error": return "Error";
    default: return "Manual";
  }
}

function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Never synced";
  const date = new Date(lastSyncAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function IntegrationCard({ config, onConfigure, onTestSync }: IntegrationCardProps) {
  const [isTesting, setIsTesting] = useState(false);
  const dataSourceState = statusToDataSource(config.status);
  const isStale =
    config.lastSyncAt !== null &&
    new Date().getTime() - new Date(config.lastSyncAt).getTime() > 7 * 86_400_000;

  async function handleTestSync() {
    setIsTesting(true);
    try {
      await onTestSync(config.key);
    } finally {
      setIsTesting(false);
    }
  }

  function handleCardClick() {
    void trackIntegrationEvent("integration_card_clicked", { integration: config.key });
    onConfigure(config.key);
  }

  function handleCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Configure ${config.name}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      className={cn(
        "group bg-white rounded-xl border border-[#E2E8F0] p-5 flex flex-col gap-4",
        "transition-all duration-150 cursor-pointer",
        "hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87722] focus-visible:ring-offset-2"
      )}
    >
      {/* Header row: icon + name + status */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center shrink-0 text-[#1B2A3D] text-lg font-bold select-none"
          aria-hidden="true"
        >
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-[#1B2A3D] leading-5 truncate">
              {config.name}
            </h3>
            <DataSourceBadge state={isStale ? "Stale" : dataSourceState} />
          </div>
          <p className="text-xs text-[#64748B] mt-0.5">{config.category}</p>
        </div>
      </div>

      {/* Sync info */}
      <div className="flex items-center justify-between text-xs text-[#94A3B8]">
        <span>
          Last sync:{" "}
          <span className={cn(isStale ? "text-amber-600" : "text-[#64748B]", "font-medium")}>
            {formatLastSync(config.lastSyncAt)}
          </span>
        </span>
        {config.syncRecords !== null && (
          <span>{config.syncRecords.toLocaleString()} records</span>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-[#64748B] leading-relaxed flex-1 line-clamp-2">
        {config.description}
      </p>

      {/* Footer: environment state + actions */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#F1F5F9]">
        {/* Environment pill */}
        <div className="flex items-center gap-1.5 text-xs text-[#94A3B8]">
          <Plug className="w-3 h-3" aria-hidden="true" />
          <span>
            {config.status === "connected"
              ? "Live data"
              : config.status === "demo_mode"
              ? "Demo mode"
              : config.status === "error"
              ? "Connection error"
              : "Credentials needed"}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-3 text-xs text-[#64748B] hover:text-[#1B2A3D] focus-visible:ring-[#E87722]"
            onClick={(e) => { e.stopPropagation(); void handleTestSync(); }}
            disabled={isTesting}
            aria-label={`Test sync for ${config.name}`}
          >
            <RefreshCw
              className={cn("w-3 h-3 mr-1", isTesting && "animate-spin")}
              aria-hidden="true"
            />
            {isTesting ? "Testing…" : "Test sync"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 px-3 text-xs border-[#E2E8F0] text-[#1B2A3D] hover:bg-[#F8FAFC] focus-visible:ring-[#E87722]"
            onClick={(e) => { e.stopPropagation(); onConfigure(config.key); }}
            aria-label={`Configure ${config.name}`}
          >
            <Settings className="w-3 h-3 mr-1" aria-hidden="true" />
            Configure
          </Button>
        </div>
      </div>
    </div>
  );
}
