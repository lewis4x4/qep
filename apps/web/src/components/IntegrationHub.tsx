/**
 * IntegrationHub — Admin Integration Hub page at /admin/integrations.
 * Card grid layout per CDO design direction §1.
 * Owner-only access (enforced at route and RLS layer).
 */

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, Clock, Wifi, Settings } from "lucide-react";
import { IntegrationCard } from "./IntegrationCard";
import { IntegrationPanel } from "./IntegrationPanel";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { trackIntegrationEvent } from "@/lib/track-event";

export interface IntegrationCardConfig {
  key: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  status: "connected" | "pending_credentials" | "error" | "demo_mode";
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncRecords: number | null;
  endpointUrl: string | null;
}

// Static display config per integration key
const INTEGRATION_DISPLAY: Record<
  string,
  Pick<IntegrationCardConfig, "name" | "category" | "description" | "icon">
> = {
  intellidealer: {
    name: "IntelliDealer (VitalEdge)",
    category: "Inventory & CRM",
    description:
      "Live inventory, customer master data, and deal history from your dealer management system.",
    icon: "ID",
  },
  ironguides: {
    name: "Iron Solutions / IronGuides",
    category: "Equipment Valuations",
    description:
      "Fair market valuations and comparable sales data for used equipment pricing confidence.",
    icon: "IG",
  },
  rouse: {
    name: "Rouse Analytics",
    category: "Rental Rate & Utilization",
    description:
      "Regional rental benchmarks and fleet utilization signals to sharpen deal structuring.",
    icon: "RA",
  },
  aemp: {
    name: "AEMP 2.0 Telematics",
    category: "Fleet Intelligence",
    description:
      "Machine telemetry (hours, location, utilization) for replacement prediction and proactive outreach.",
    icon: "AT",
  },
  financing: {
    name: "Financing Partners",
    category: "Financing Rates",
    description:
      "Live rate tables from AgDirect, CNH Capital, John Deere Financial, and AGCO Finance.",
    icon: "FP",
  },
  manufacturer_incentives: {
    name: "Manufacturer Incentives",
    category: "Incentive Programs",
    description:
      "Active OEM incentive and rebate programs from Barko, ASV, Bandit, Yanmar, and others.",
    icon: "MI",
  },
  auction_data: {
    name: "Auction Data",
    category: "Market Comps",
    description:
      "Historical auction results from Ritchie Bros., IronPlanet, and PurpleWave for comp-based pricing.",
    icon: "AD",
  },
  fred_usda: {
    name: "FRED / USDA Economic Data",
    category: "Economic Indicators",
    description:
      "Housing starts, construction spending, timber prices, and macro indicators from FRED and USDA.",
    icon: "FU",
  },
};

function SummaryStrip({ cards }: { cards: IntegrationCardConfig[] }) {
  const connected = cards.filter((c) => c.status === "connected").length;
  const demo = cards.filter((c) => c.status === "demo_mode").length;
  const pendingSetup = cards.filter((c) => c.status === "pending_credentials").length;
  const errors = cards.filter((c) => c.status === "error").length;
  const lastSync = cards
    .filter((c) => c.lastSyncAt)
    .sort((a, b) => new Date(b.lastSyncAt!).getTime() - new Date(a.lastSyncAt!).getTime())[0]
    ?.lastSyncAt;

  return (
    <div className="flex items-center gap-6 flex-wrap text-sm">
      <div className="flex items-center gap-1.5 text-[#16A34A]">
        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
        <span className="font-semibold">{connected}</span>
        <span className="text-[#64748B]">Connected</span>
      </div>
      {demo > 0 && (
        <div className="flex items-center gap-1.5 text-[#E87722]">
          <Wifi className="w-4 h-4" aria-hidden="true" />
          <span className="font-semibold">{demo}</span>
          <span className="text-[#64748B]">Demo</span>
        </div>
      )}
      {pendingSetup > 0 && (
        <div className="flex items-center gap-1.5 text-[#94A3B8]">
          <Settings className="w-4 h-4" aria-hidden="true" />
          <span className="font-semibold">{pendingSetup}</span>
          <span className="text-[#64748B]">Setup required</span>
        </div>
      )}
      {errors > 0 && (
        <div className="flex items-center gap-1.5 text-[#DC2626]">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          <span className="font-semibold">{errors}</span>
          <span className="text-[#64748B]">Attention needed</span>
        </div>
      )}
      {lastSync && (
        <div className="flex items-center gap-1.5 text-[#94A3B8]">
          <Clock className="w-4 h-4" aria-hidden="true" />
          <span className="text-[#64748B]">
            Last sync:{" "}
            <span className="font-medium text-[#374151]">
              {new Date(lastSync).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex flex-col gap-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#F1F5F9] shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 bg-[#F1F5F9] rounded" />
          <div className="h-3 w-20 bg-[#F1F5F9] rounded" />
        </div>
      </div>
      <div className="h-3 w-24 bg-[#F1F5F9] rounded" />
      <div className="space-y-1.5">
        <div className="h-3 w-full bg-[#F1F5F9] rounded" />
        <div className="h-3 w-3/4 bg-[#F1F5F9] rounded" />
      </div>
      <div className="flex justify-between items-center pt-1 border-t border-[#F1F5F9]">
        <div className="h-3 w-20 bg-[#F1F5F9] rounded" />
        <div className="h-11 w-24 bg-[#F1F5F9] rounded" />
      </div>
    </div>
  );
}

export function IntegrationHub() {
  const [cards, setCards] = useState<IntegrationCardConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const loadIntegrations = useCallback(async () => {
    try {
      const fetchPromise = supabase
        .from("integration_status")
        .select(
          "integration_key, status, last_sync_at, last_sync_records, last_sync_error, endpoint_url"
        )
        .order("integration_key");

      const { data, error: queryError } = await Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Request timed out. Please try again.")), 10_000)
        ),
      ]);

      if (queryError) throw queryError;

      const rows = (data ?? []) as Array<{
        integration_key: string;
        status: IntegrationCardConfig["status"];
        last_sync_at: string | null;
        last_sync_records: number | null;
        last_sync_error: string | null;
        endpoint_url: string | null;
      }>;

      const mapped: IntegrationCardConfig[] = rows
        .filter((r) => INTEGRATION_DISPLAY[r.integration_key])
        .map((r) => ({
          key: r.integration_key,
          status: r.status,
          lastSyncAt: r.last_sync_at,
          syncRecords: r.last_sync_records,
          lastSyncError: r.last_sync_error,
          endpointUrl: r.endpoint_url,
          ...INTEGRATION_DISPLAY[r.integration_key],
        }));

      setCards(mapped);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  function handleConfigure(key: string) {
    setSelectedKey(key);
    setPanelOpen(true);
    void trackIntegrationEvent("integration_panel_opened", { integration: key });
  }

  async function handleTestSync(key: string) {
    void trackIntegrationEvent("integration_connection_tested", {
      integration: key,
      trigger: "card_test_sync",
    });
    const { data } = await supabase.functions.invoke("admin-users", {
      body: { action: "test_integration", integration_key: key },
    });
    if (data) {
      await loadIntegrations();
    }
  }

  const selectedCard = cards.find((c) => c.key === selectedKey) ?? null;

  if (error) {
    return (
      <div className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 flex items-center justify-center py-24">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-10 h-10 text-[#DC2626] mx-auto mb-3" aria-hidden="true" />
          <h3 className="text-base font-semibold text-[#1B2A3D] mb-1">Failed to load integrations</h3>
          <p className="text-sm text-[#64748B]">{error}</p>
          <button
            onClick={() => { setLoading(true); void loadIntegrations(); }}
            className="mt-4 text-sm text-[#E87722] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87722] rounded"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 flex flex-col gap-6">
      {/* Page header */}
      <div className="space-y-3">
        <div>
          <h1 className="text-[28px] font-bold text-[#1B2A3D] leading-8">Integrations</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Connect external data sources to power the Deal Genome Engine.
          </p>
        </div>
        {!loading && cards.length > 0 && <SummaryStrip cards={cards} />}
      </div>

      {/* Integration grid */}
      <div
        className={cn(
          "grid gap-4",
          "grid-cols-1",
          "md:grid-cols-2",
          "lg:grid-cols-3",
          "[@media(min-width:1440px)]:grid-cols-4"
        )}
        aria-label="Integration cards"
        aria-busy={loading}
      >
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
          : cards.map((card) => (
              <IntegrationCard
                key={card.key}
                config={card}
                onConfigure={handleConfigure}
                onTestSync={handleTestSync}
              />
            ))}
      </div>

      {/* Empty state (no rows seeded yet) */}
      {!loading && cards.length === 0 && (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-sm">
            <Wifi className="w-10 h-10 text-[#E2E8F0] mx-auto mb-3" aria-hidden="true" />
            <h3 className="text-base font-semibold text-[#1B2A3D] mb-1">No integrations found</h3>
            <p className="text-sm text-[#64748B]">
              Your integrations aren't set up yet. Contact your administrator or QEP support to complete initial setup.
            </p>
          </div>
        </div>
      )}

      {/* Configuration panel */}
      <IntegrationPanel
        integration={selectedCard}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSaved={loadIntegrations}
      />
    </div>
  );
}
