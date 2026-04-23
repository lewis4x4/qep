/**
 * DecisionRoomScoreboard — four real scores with visible traces.
 *
 * Every number is clickable: the trace list explains exactly why this value
 * came out. No opaque magic. This pattern scales into Phase 2 (delta chips
 * after each move) and Phase 4 (futures panel on the time scrubber).
 */
import { useState } from "react";
import { Gauge, ShieldAlert, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CoverageScore, DecisionRoomScores } from "../lib/decision-room-simulator";
import { ARCHETYPE_DEFS, type ConfidenceLevel } from "../lib/decision-room-archetype";

interface Props {
  scores: DecisionRoomScores;
  /** Velocity delta from the most recent tried move — positive = slower,
   *  negative = faster. Renders as an animated chip on the Velocity tile. */
  velocityDelta?: number | null;
}

function levelTone(level: ConfidenceLevel, invert: boolean): string {
  // `invert: true` means "high level is bad" (Consensus Risk, Latent Veto).
  if (invert) {
    if (level === "high") return "text-red-300";
    if (level === "medium") return "text-amber-300";
    return "text-emerald-300";
  }
  if (level === "high") return "text-emerald-300";
  if (level === "medium") return "text-amber-300";
  return "text-white/70";
}

function levelLabel(level: ConfidenceLevel, invert: boolean): string {
  if (invert) {
    if (level === "high") return "High risk";
    if (level === "medium") return "Moderate risk";
    return "Low risk";
  }
  if (level === "high") return "High confidence";
  if (level === "medium") return "Moderate";
  return "Low";
}

function velocityTone(days: number | null): string {
  if (days == null) return "text-white/60";
  if (days < 0) return "text-red-300";
  if (days <= 14) return "text-emerald-300";
  if (days <= 45) return "text-amber-300";
  return "text-white/80";
}

function velocityLabel(days: number | null): string {
  if (days == null) return "—";
  if (days < 0) return `${Math.abs(days)}d past due`;
  if (days === 0) return "Today";
  return `${days}d to close`;
}

function coverageTone(value: number): string {
  if (value >= 0.8) return "text-emerald-300";
  if (value >= 0.5) return "text-amber-300";
  return "text-red-300";
}

/** Short label for each archetype — we use these in the coverage story
 *  because the full labels ("Operations / Plant Manager") are too long
 *  to comfortably fit in the tile's sub line. */
const SHORT_ARCHETYPE_LABEL: Record<string, string> = {
  champion: "champion",
  economic_buyer: "economic buyer",
  operations: "operations",
  procurement: "procurement",
  operator: "operator",
  maintenance: "maintenance",
  executive_sponsor: "exec sponsor",
};

/** Human-readable coverage story — same data as "0 of 5 named" but tells
 *  the rep *which* seats are missing instead of hiding the names behind a
 *  ratio. Bare ratios read as failure even when the work is on track. */
function coverageStory(cov: CoverageScore): string {
  if (cov.expected === 0) return "No seats expected for this deal size";
  if (cov.missingArchetypes.length === 0) {
    return `All ${cov.expected} expected seats named`;
  }
  const labels = cov.missingArchetypes
    .slice(0, 2)
    .map((a) => SHORT_ARCHETYPE_LABEL[a] ?? ARCHETYPE_DEFS[a].label.toLowerCase());
  const extra = cov.missingArchetypes.length - labels.length;
  const list = labels.length <= 1
    ? labels[0]
    : `${labels[0]} and ${labels[1]}`;
  const tail = extra > 0 ? ` (+${extra} more)` : "";
  return `Missing ${list}${tail}`;
}

interface TileProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: string;
  tone: string;
  trace: string[];
  progressPct?: number;
  progressTone?: string;
  deltaChip?: { text: string; tone: string } | null;
}

function Tile({ icon, label, value, sub, tone, trace, progressPct, progressTone, deltaChip }: TileProps) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-qep-deck-rule bg-qep-deck-elevated/60 p-4",
        "transition-colors hover:border-qep-orange/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-qep-orange">{icon}</span>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className={cn("text-2xl font-semibold", tone)}>{value}</p>
        {deltaChip ? (
          <span
            className={cn(
              "animate-in fade-in slide-in-from-left-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              deltaChip.tone,
            )}
          >
            {deltaChip.text}
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
      {progressPct != null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className={cn("h-full rounded-full", progressTone ?? "bg-qep-orange")}
            style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="mt-3 flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-qep-orange"
      >
        {open ? "Hide why" : "Why?"}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {trace.map((line, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-qep-orange">›</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DecisionRoomScoreboard({ scores, velocityDelta }: Props) {
  const velocityDays = scores.decisionVelocity.days;
  const coveragePct = Math.round(scores.coverage.value * 100);

  const velocityDeltaChip =
    typeof velocityDelta === "number" && velocityDelta !== 0
      ? velocityDelta < 0
        ? {
            text: `${Math.abs(velocityDelta)}d faster`,
            tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
          }
        : {
            text: `${velocityDelta}d slower`,
            tone: "border-red-400/40 bg-red-500/10 text-red-200",
          }
      : null;

  return (
    <div className="grid gap-3 md:grid-cols-4">
      <Tile
        icon={<Zap className="h-4 w-4" aria-hidden />}
        label="Decision Velocity"
        value={velocityLabel(velocityDays)}
        sub={levelLabel(scores.decisionVelocity.confidence, false)}
        tone={velocityTone(velocityDays)}
        trace={scores.decisionVelocity.trace}
        deltaChip={velocityDeltaChip}
      />
      <Tile
        icon={<Users className="h-4 w-4" aria-hidden />}
        label="Coverage"
        value={`${coveragePct}%`}
        sub={coverageStory(scores.coverage)}
        tone={coverageTone(scores.coverage.value)}
        trace={scores.coverage.trace}
        progressPct={coveragePct}
        progressTone={
          scores.coverage.value >= 0.8
            ? "bg-emerald-400"
            : scores.coverage.value >= 0.5
              ? "bg-amber-400"
              : "bg-red-400"
        }
      />
      <Tile
        icon={<ShieldAlert className="h-4 w-4" aria-hidden />}
        label="Consensus Risk"
        value={levelLabel(scores.consensusRisk.level, true)}
        sub="Disagreement inside the room"
        tone={levelTone(scores.consensusRisk.level, true)}
        trace={scores.consensusRisk.trace}
      />
      <Tile
        icon={<Gauge className="h-4 w-4" aria-hidden />}
        label="Latent Veto"
        value={levelLabel(scores.latentVeto.level, true)}
        sub={
          scores.latentVeto.topGhostArchetype
            ? `Top risk: ${scores.latentVeto.topGhostArchetype.replace(/_/g, " ")}`
            : "No ghost seats"
        }
        tone={levelTone(scores.latentVeto.level, true)}
        trace={scores.latentVeto.trace}
      />
    </div>
  );
}
