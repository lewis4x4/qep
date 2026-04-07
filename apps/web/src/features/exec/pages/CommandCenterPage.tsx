/**
 * QEP Moonshot Command Center — single page, three lenses.
 *
 * Per the locked role gate, only `profiles.role = 'owner'` can reach this
 * page (enforced by App.tsx route + RLS on every analytics_* table). The
 * page renders a tab switcher across CEO / CFO / COO so the same user can
 * pivot between perspectives without leaving the surface.
 *
 * Slice 1: CEO lens is wired against migration 187 + live fallback queries.
 * CFO + COO are stub views; sub-views land in slices 3 + 4.
 * Drill drawer is a no-op stub here; full drawer ships in Slice 5.
 */
import { useState, useCallback } from "react";
import { Crown, Wallet, Truck, RefreshCcw } from "lucide-react";
import { DashboardPivotToggle } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { CeoCommandCenterView } from "../views/CeoCommandCenterView";
import { CfoCommandCenterView } from "../views/CfoCommandCenterView";
import { CooCommandCenterView } from "../views/CooCommandCenterView";
import type { ExecRoleTab } from "../lib/types";

const TABS = [
  { key: "ceo" as const, label: "CEO", icon: <Crown className="h-3 w-3" /> },
  { key: "cfo" as const, label: "CFO", icon: <Wallet className="h-3 w-3" /> },
  { key: "coo" as const, label: "COO", icon: <Truck className="h-3 w-3" /> },
];

export function CommandCenterPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ExecRoleTab>("ceo");

  const handleDrill = useCallback((metricKey: string) => {
    // Slice 5: opens MetricDrillDrawer. For now, log + no-op.
    // eslint-disable-next-line no-console
    console.info("[exec] drill request:", metricKey);
  }, []);

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["exec"] });
  }, [qc]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Command Center</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Live operating layer · CEO / CFO / COO lenses · owner-only
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleRefresh}>
            <RefreshCcw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {/* Lens switcher */}
      <DashboardPivotToggle
        value={tab}
        onChange={(v) => setTab(v as ExecRoleTab)}
        pivots={TABS}
      />

      {/* Lens content */}
      {tab === "ceo" && <CeoCommandCenterView onDrill={handleDrill} />}
      {tab === "cfo" && <CfoCommandCenterView onDrill={handleDrill} />}
      {tab === "coo" && <CooCommandCenterView onDrill={handleDrill} />}
    </div>
  );
}
