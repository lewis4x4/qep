/**
 * QEP Moonshot Command Center — single page, three lenses.
 *
 * Canonical owner command center served at `/executive` and `/executive/live`.
 * Managers share the same executive route but land on the scoped summary page
 * until the branch/team executive surface is ready. Owners get the full
 * overview / CEO / CFO / COO control room here.
 *
 * Slice 1: CEO lens is wired against migration 187 + live fallback queries.
 * CFO + COO are stub views; sub-views land in slices 3 + 4.
 * Drill drawer is a no-op stub here; full drawer ships in Slice 5.
 */
import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Crown,
  Wallet,
  Truck,
  Gauge,
  RefreshCcw,
  ArrowRight,
  AlertTriangle,
  ShieldAlert,
  Activity,
  Wrench,
  Sparkles,
} from "lucide-react";
import { DashboardPivotToggle } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { CeoCommandCenterView } from "../views/CeoCommandCenterView";
import { CfoCommandCenterView } from "../views/CfoCommandCenterView";
import { CooCommandCenterView } from "../views/CooCommandCenterView";
import { ExecutiveOverviewView } from "../views/ExecutiveOverviewView";
import { MetricDrillDrawer } from "../components/MetricDrillDrawer";
import { CommandCenterExportMenu } from "../components/CommandCenterExportMenu";
import type { ExecRoleTab } from "../lib/types";

type ExecutiveTab = "overview" | ExecRoleTab;

const TABS = [
  { key: "overview" as const, label: "Overview", icon: <Gauge className="h-3 w-3" /> },
  { key: "ceo" as const, label: "CEO", icon: <Crown className="h-3 w-3" /> },
  { key: "cfo" as const, label: "CFO", icon: <Wallet className="h-3 w-3" /> },
  { key: "coo" as const, label: "COO", icon: <Truck className="h-3 w-3" /> },
];

const LENS_SUMMARIES: Record<ExecRoleTab, { title: string; detail: string }> = {
  ceo: {
    title: "Growth, risk concentration, and operating leverage",
    detail: "Use this lens to pressure-test pipeline quality, branch variance, customer health, and where the business is gaining or leaking momentum.",
  },
  cfo: {
    title: "Cash discipline, margin integrity, and policy pressure",
    detail: "Use this lens to spot AR exposure, margin leakage, deposit misses, payment breakdowns, and the next finance interventions that matter.",
  },
  coo: {
    title: "Execution reliability, backlog recovery, and operating throughput",
    detail: "Use this lens to run service, logistics, and recovery queues before they turn into customer-facing misses or revenue drag.",
  },
};

const CONTROL_LINKS = [
  {
    title: "Exception Inbox",
    detail: "Work the unresolved business failures that need human intervention.",
    href: "/exceptions",
    icon: AlertTriangle,
    tone: "border-red-500/30 bg-red-500/5 text-red-300",
  },
  {
    title: "Data Quality",
    detail: "Repair structural issues before they distort executive reporting.",
    href: "/admin/data-quality",
    icon: ShieldAlert,
    tone: "border-amber-500/30 bg-amber-500/5 text-amber-200",
  },
  {
    title: "Nervous System",
    detail: "Open customer health, AR blocks, and lifecycle risk signals.",
    href: "/nervous-system",
    icon: Activity,
    tone: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
  },
  {
    title: "Service Dashboard",
    detail: "Jump straight into execution drag and overdue operating queues.",
    href: "/service/dashboard",
    icon: Wrench,
    tone: "border-cyan-500/30 bg-cyan-500/5 text-cyan-200",
  },
  {
    title: "Price Intelligence",
    detail: "See pricing pressure, requote exposure, and sourcing advantage.",
    href: "/price-intelligence",
    icon: Sparkles,
    tone: "border-qep-orange/30 bg-qep-orange/5 text-qep-orange",
  },
] as const;

export function CommandCenterPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ExecutiveTab>("overview");

  // Resolve the calling user's workspace once. Threaded into the drill drawer
  // so its snapshot history + alerts queries can explicitly filter by
  // workspace_id (P1-2 fix). Cached indefinitely — workspace doesn't change.
  const { data: workspaceId = "default" } = useQuery({
    queryKey: ["exec", "my-workspace"],
    queryFn: async (): Promise<string> => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) return "default";
      const res = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { workspace_id: string | null } | null; error: unknown }> } };
        };
      }).from("profiles").select("workspace_id").eq("id", uid).maybeSingle();
      return res.data?.workspace_id ?? "default";
    },
    staleTime: Infinity,
  });
  const [drillMetric, setDrillMetric] = useState<string | null>(null);

  const handleDrill = useCallback((metricKey: string) => {
    setDrillMetric(metricKey);
  }, []);

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["exec"] });
  }, [qc]);

  const exportRole: ExecRoleTab = tab === "overview" ? "ceo" : tab;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-24 pt-2 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-qep-orange">
            QEP OS · Live Executive Operating Room
          </p>
          <h1 className="text-2xl font-bold text-foreground">Executive Command Center</h1>
          <p className="mt-0.5 max-w-3xl text-[11px] text-muted-foreground">
            The leadership control surface for revenue, finance discipline, execution reliability, and intervention
            flow. This is the live command layer, not the showcase.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CommandCenterExportMenu role={exportRole} />
          <Button size="sm" variant="outline" onClick={handleRefresh}>
            <RefreshCcw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {tab !== "overview" && (
        <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
          <Card className="overflow-hidden border-qep-orange/20 bg-[radial-gradient(circle_at_top_left,rgba(184,115,51,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
            <div className="flex flex-col gap-5">
              <div className="space-y-2">
                <div className="inline-flex items-center rounded-full border border-qep-orange/25 bg-qep-orange/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-qep-orange">
                  Leadership signal stack
                </div>
                <div className="space-y-2">
                  <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                    Run the business from one analytical command surface.
                  </h2>
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    Every lens is built to answer four questions in real time: what changed, what is off track, what
                    requires intervention today, and exactly where leadership should go next.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {TABS.filter((entry) => entry.key !== "overview").map((entry) => {
                  const active = tab === entry.key;
                  const lens = LENS_SUMMARIES[entry.key as ExecRoleTab];
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => setTab(entry.key as ExecRoleTab)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        active
                          ? "border-qep-orange/40 bg-qep-orange/10 shadow-[0_0_0_1px_rgba(184,115,51,0.14)]"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${active ? "bg-qep-orange/15 text-qep-orange" : "bg-white/8 text-white/70"}`}>
                          {entry.icon}
                        </span>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
                            {entry.label}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{lens.title}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">{lens.detail}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-qep-orange">Intervention paths</p>
                <h2 className="mt-1 text-base font-semibold text-foreground">Where leadership can act now</h2>
              </div>
              <Link
                to="/os"
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted/20"
              >
                OS Hub <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="mt-4 space-y-2.5">
              {CONTROL_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    className={`block rounded-xl border p-3 transition hover:border-qep-orange/35 hover:bg-white/[0.04] ${link.tone}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          <p className="text-xs font-semibold text-foreground">{link.title}</p>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{link.detail}</p>
                      </div>
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Lens switcher */}
      <DashboardPivotToggle
        value={tab}
        onChange={(v) => setTab(v as ExecutiveTab)}
        pivots={TABS}
      />

      {/* Lens content */}
      {tab === "overview" && <ExecutiveOverviewView onOpenLens={(lens) => setTab(lens)} />}
      {tab === "ceo" && <CeoCommandCenterView onDrill={handleDrill} />}
      {tab === "cfo" && <CfoCommandCenterView onDrill={handleDrill} />}
      {tab === "coo" && <CooCommandCenterView onDrill={handleDrill} />}

      {/* Universal drill drawer (Slice 5) */}
      <MetricDrillDrawer metricKey={drillMetric} workspaceId={workspaceId} onClose={() => setDrillMetric(null)} />
    </div>
  );
}
