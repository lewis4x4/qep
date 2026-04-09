/**
 * Knowledge Gaps + Absence Engine — Track 1, Slice 1.7.
 *
 * Manager-only section showing unanswered questions and per-rep data
 * completeness gaps. Turns a manager from a scorekeeper into a coach.
 *
 * Non-managers: returns null (section doesn't render).
 */

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/primitives/GlassPanel";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  HelpCircle,
  Users,
} from "lucide-react";
import type {
  KnowledgeGapsPayload,
  KnowledgeGapItem,
  RepAbsenceRow,
  SectionFreshness,
} from "../api/commandCenter.types";

// ─── Animation ─────────────────────────────────────────────────────────────

const listVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" as const } },
};

// ─── Score bar ─────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[11px] tabular-nums font-medium", pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-rose-400")}>
        {pct}%
      </span>
    </div>
  );
}

// ─── Sub-sections ──────────────────────────────────────────────────────────

function TopGapsSection({ gaps }: { gaps: KnowledgeGapItem[] }) {
  if (gaps.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">Top Knowledge Gaps</span>
        <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-400 px-1.5">
          {gaps.length}
        </Badge>
      </div>
      <motion.div variants={listVariants} initial="hidden" animate="visible" className="space-y-1.5">
        {gaps.map((gap, i) => (
          <motion.div
            key={gap.id}
            variants={itemVariants}
            className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white">
                <span className="text-[11px] text-slate-500 mr-2">{i + 1}.</span>
                {gap.question}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] tabular-nums text-slate-500">Asked {gap.frequency}x</span>
              {gap.askedByRole && (
                <Badge variant="outline" className="text-[9px] border-white/10 text-white/40 px-1.5">
                  {gap.askedByRole.replace("iron_", "")}
                </Badge>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

function WorstFieldsSection({ fields }: { fields: Array<{ field: string; label: string; missingPct: number }> }) {
  if (fields.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400">Worst Data Gaps (Team-Wide)</span>
      </div>
      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.field} className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.03] px-4 py-2.5">
            <div className="flex-1">
              <span className="text-xs text-white/70">{f.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${f.missingPct}%` }} />
              </div>
              <span className="text-[11px] tabular-nums font-medium text-amber-400">{f.missingPct}% missing</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RepAbsenceTable({ reps }: { reps: RepAbsenceRow[] }) {
  if (reps.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Rep Data Completeness</span>
      </div>
      <GlassPanel className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="py-2 pl-4 pr-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Rep</th>
                <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 hidden sm:table-cell">Role</th>
                <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 text-right">Deals</th>
                <th className="py-2 px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 text-right">Gaps</th>
                <th className="py-2 pl-2 pr-4 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Score</th>
              </tr>
            </thead>
            <motion.tbody variants={listVariants} initial="hidden" animate="visible">
              {reps.map((rep) => {
                const totalGaps = rep.missingAmount + rep.missingCloseDate + rep.missingContact + rep.missingCompany;
                return (
                  <motion.tr
                    key={rep.repId}
                    variants={itemVariants}
                    className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="py-2.5 pl-4 pr-2">
                      <span className="text-sm font-medium text-white">{rep.repName}</span>
                    </td>
                    <td className="py-2.5 px-2 hidden sm:table-cell">
                      {rep.ironRole && (
                        <Badge variant="outline" className="text-[9px] border-white/10 text-white/40 px-1.5">
                          {rep.ironRole.replace("iron_", "")}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <span className="text-sm tabular-nums text-white/60">{rep.dealCount}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      <span className={cn("text-sm tabular-nums font-medium", totalGaps > 0 ? "text-amber-400" : "text-white/40")}>
                        {totalGaps}
                      </span>
                    </td>
                    <td className="py-2.5 pl-2 pr-4">
                      <ScoreBar score={rep.absenceScore} />
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      </GlassPanel>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

interface KnowledgeGapsEngineProps {
  payload: KnowledgeGapsPayload;
  freshness: SectionFreshness;
}

export function KnowledgeGapsEngine({ payload, freshness }: KnowledgeGapsEngineProps) {
  // Guard: undefined payload or non-manager view
  if (!payload || !payload.isManagerView) return null;

  const hasContent = payload.topGaps.length > 0 || payload.repAbsence.length > 0 || payload.worstFields.length > 0;

  if (!hasContent) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold tracking-tight text-white">Knowledge Gaps + Absence Engine</h3>
          <Badge variant="outline" className="text-[9px] border-qep-orange/30 text-qep-orange px-1.5">Manager</Badge>
        </div>
        <GlassPanel className="py-10 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-white/70">No data gaps detected</p>
          <p className="text-[11px] text-slate-500 mt-1">Team data completeness is healthy.</p>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-qep-orange" />
          <h3 className="text-sm font-semibold tracking-tight text-white">Knowledge Gaps + Absence Engine</h3>
          <Badge variant="outline" className="text-[9px] border-qep-orange/30 text-qep-orange px-1.5">Manager</Badge>
        </div>
        {freshness?.source !== "live" && (
          <span className="text-[11px] text-amber-500">{freshness?.source}</span>
        )}
      </div>

      <TopGapsSection gaps={payload.topGaps} />
      <WorstFieldsSection fields={payload.worstFields} />
      <RepAbsenceTable reps={payload.repAbsence} />
    </div>
  );
}
