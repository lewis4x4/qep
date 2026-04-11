import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Cog,
  Eye,
  ShieldCheck,
  Truck,
  Wrench,
} from "lucide-react";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  buildEmbeddedExecutivePreviewHref,
  EXECUTIVE_DEPARTMENT_VIEWS,
  type ExecutiveDepartmentKey,
} from "../lib/department-view-deck";

const DEPARTMENT_ACCENTS: Record<
  ExecutiveDepartmentKey,
  {
    icon: React.ComponentType<{ className?: string }>;
    chipClassName: string;
    cardClassName: string;
  }
> = {
  qrm: {
    icon: Eye,
    chipClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
    cardClassName: "border-cyan-500/25 bg-cyan-500/[0.08]",
  },
  service: {
    icon: Wrench,
    chipClassName: "border-qep-orange/30 bg-qep-orange/10 text-qep-orange",
    cardClassName: "border-qep-orange/25 bg-qep-orange/[0.08]",
  },
  parts: {
    icon: Cog,
    chipClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    cardClassName: "border-emerald-500/25 bg-emerald-500/[0.08]",
  },
  rental: {
    icon: Truck,
    chipClassName: "border-violet-500/30 bg-violet-500/10 text-violet-200",
    cardClassName: "border-violet-500/25 bg-violet-500/[0.08]",
  },
};

interface ExecutiveDepartmentDeckProps {
  viewerName?: string | null;
}

export function ExecutiveDepartmentDeck({
  viewerName,
}: ExecutiveDepartmentDeckProps) {
  const [activeKey, setActiveKey] = useState<ExecutiveDepartmentKey>(
    EXECUTIVE_DEPARTMENT_VIEWS[0]?.key ?? "qrm",
  );

  const activeDepartment = useMemo(
    () =>
      EXECUTIVE_DEPARTMENT_VIEWS.find((department) => department.key === activeKey) ??
      EXECUTIVE_DEPARTMENT_VIEWS[0],
    [activeKey],
  );

  if (!activeDepartment) {
    return null;
  }

  const accent = DEPARTMENT_ACCENTS[activeDepartment.key];
  const Icon = accent.icon;
  const embeddedHref = buildEmbeddedExecutivePreviewHref(activeDepartment.href);
  const viewerLabel = viewerName?.trim() ? viewerName.trim() : "Leadership";

  return (
    <GlassPanel className="border-white/12 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-qep-orange">
            <ShieldCheck className="h-3 w-3" />
            Leadership View Deck
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Open every department’s live command center from one owner-grade deck.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            {viewerLabel} can jump between the real department surfaces without leaving the executive operating room.
            The preview below is the actual route each team works from, rendered in an embedded shell.
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/80">
          This preview is live. Any actions taken inside it affect the same data the department uses.
        </div>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-4">
        {EXECUTIVE_DEPARTMENT_VIEWS.map((department) => {
          const departmentAccent = DEPARTMENT_ACCENTS[department.key];
          const DepartmentIcon = departmentAccent.icon;
          const active = department.key === activeDepartment.key;

          return (
            <button
              key={department.key}
              type="button"
              onClick={() => setActiveKey(department.key)}
              className={cn(
                "rounded-[1.5rem] border p-4 text-left transition duration-200",
                active
                  ? departmentAccent.cardClassName
                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-2xl border",
                      active ? departmentAccent.chipClassName : "border-white/10 bg-white/[0.03] text-white/80",
                    )}
                  >
                    <DepartmentIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{department.label}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{department.audience}</p>
                  </div>
                </div>
                {active && <Badge className="border-white/10 bg-white/[0.08] text-[10px] text-white">Live</Badge>}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-300/90">{department.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.45fr]">
        <div className="space-y-4">
          <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/40 p-5">
            <div className="flex items-center gap-3">
              <div className={cn("inline-flex h-11 w-11 items-center justify-center rounded-2xl border", accent.chipClassName)}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-qep-orange">
                  Active Department
                </p>
                <h3 className="text-lg font-semibold text-foreground">{activeDepartment.label}</h3>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className={cn("border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]", accent.chipClassName)}>
                {activeDepartment.audience}
              </Badge>
              <Badge className="border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75">
                {activeDepartment.href}
              </Badge>
            </div>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {activeDepartment.leadershipPrompt}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to={activeDepartment.href}>Open full screen</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={activeDepartment.href} target="_blank" rel="noreferrer">
                  Open in new tab <ArrowUpRight className="ml-2 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-qep-orange">
              Why this matters
            </p>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
              <li>Owners stop reviewing department summaries and start seeing the exact operating surface the team is navigating.</li>
              <li>Admin can validate whether a department command center is surfacing the right exceptions before a coaching conversation starts.</li>
              <li>Leadership can step from preview into the full route in one click when a queue, customer, or operational failure needs direct intervention.</li>
            </ul>
          </div>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/80 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-900/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
                Department Preview
              </span>
            </div>
            <div className="truncate rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-white/75">
              {activeDepartment.href}
            </div>
          </div>

          <div className="bg-white">
            <iframe
              key={activeDepartment.key}
              title={`${activeDepartment.label} live preview`}
              src={embeddedHref}
              loading="lazy"
              className="h-[720px] w-full border-0 bg-white"
            />
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
