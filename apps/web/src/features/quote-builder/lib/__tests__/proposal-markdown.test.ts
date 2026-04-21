/**
 * Proposal Markdown tests — Slice 20u.
 *
 * These tests pin the exact ticket-facing copy. The output of this
 * renderer becomes a PR / ticket description — if the headers or
 * ordering shift silently, a reviewer's muscle memory breaks. Every
 * section is pinned to its verbatim output for a representative
 * fixture, then edge cases (null ctx, empty drift, medium urgency
 * silent default) prove graceful degradation to the 20m baseline.
 */

import { describe, expect, test } from "bun:test";
import {
  renderProposalMarkdownWithContext,
  type ProposalMarkdownContext,
} from "../proposal-markdown";
import type { ScorerProposal } from "../scorer-proposal";
import type { CalibrationDriftReport } from "../calibration-drift";
import type { FactorDriftReport, FactorDrift } from "../factor-drift";
import type { ProposalUrgencyResult } from "../proposal-urgency";
import type { ScorerWhatIfResult } from "../scorer-what-if";
import type { ProposalConfidenceResult } from "../proposal-confidence";
import type { ProposalCallFlipReport } from "../proposal-call-flips";
import type { ProposalApplyVerdict } from "../proposal-apply-verdict";
import type { ProposalWatchlist } from "../proposal-watchlist";
import type { ProposalStabilityReport } from "../proposal-stability";
import type { ProposalRollbackPlan } from "../proposal-rollback";
import type { PreflightChecklist } from "../proposal-preflight-checklist";
import type { ProposalDiff } from "../proposal-diff";

function baseProposal(): ScorerProposal {
  return {
    headline: "2 factors actionable, 1 keep as-is.",
    changes: [
      {
        label: "Trade in hand",
        currentAvgWeight: 8,
        lift: -0.05,
        present: 20,
        absent: 30,
        action: "flip",
        rationale:
          "Scorer applies +8.0 but measured lift is -5%. Current sign is actively anti-predictive.",
      },
      {
        label: "Repeat buyer",
        currentAvgWeight: 2,
        lift: 0.3,
        present: 15,
        absent: 25,
        action: "strengthen",
        rationale:
          "Measured lift 30% but scorer only applies weight +2.0 — raise the weight to credit the signal properly.",
      },
      {
        label: "Margin above baseline",
        currentAvgWeight: 4,
        lift: 0.18,
        present: 28,
        absent: 22,
        action: "keep",
        rationale: "Weight +4.0 matches measured lift 18% directionally — no change needed.",
      },
    ],
    shadowCorroboration:
      "Corroborated by shadow K-NN: the shadow has won 8/10 historical disagreements (80%), adding independent support for scorer evolution.",
    lowConfidence: false,
  };
}

function nullCtx(): ProposalMarkdownContext {
  return {
    calibrationDrift: null,
    factorDrift: null,
    urgency: null,
    whatIf: null,
    confidence: null,
    callFlips: null,
    verdict: null,
    watchlist: null,
    stability: null,
    rollback: null,
    preflight: null,
    diff: null,
  };
}

describe("renderProposalMarkdownWithContext — degradation to 20m baseline", () => {
  test("all-null context → output identical to bare proposal renderer", () => {
    const md = renderProposalMarkdownWithContext(baseProposal(), nullCtx());
    expect(md).toBe(
      [
        "## Scorer Evolution Proposal",
        "",
        "2 factors actionable, 1 keep as-is.",
        "",
        "### Recommended changes",
        "- **FLIP** · `Trade in hand` — Scorer applies +8.0 but measured lift is -5%. Current sign is actively anti-predictive.",
        "- **STRENGTHEN** · `Repeat buyer` — Measured lift 30% but scorer only applies weight +2.0 — raise the weight to credit the signal properly.",
        "",
        "### Keep as-is",
        "- `Margin above baseline` — Weight +4.0 matches measured lift 18% directionally — no change needed.",
        "",
        "### Shadow K-NN corroboration",
        "Corroborated by shadow K-NN: the shadow has won 8/10 historical disagreements (80%), adding independent support for scorer evolution.",
      ].join("\n"),
    );
  });

  test("medium urgency + silent rationale + empty drift → no Context block emitted", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      factorDrift: { referenceDate: "2026-01-01T00:00:00.000Z", windowDays: 90, recentN: 0, priorN: 0, drifts: [], lowConfidence: true },
      urgency: { urgency: "medium", rationale: null },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md.startsWith("## Scorer Evolution Proposal")).toBe(true);
    expect(md).not.toContain("## Context");
  });
});

describe("renderProposalMarkdownWithContext — urgency", () => {
  test("high urgency with rationale → emits '🔴 HIGH PRIORITY' line", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      urgency: {
        urgency: "high",
        rationale: "Scorer dulled -12pp over the last 90 days — open a scorer PR this week.",
      },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Urgency**: 🔴 HIGH PRIORITY — Scorer dulled -12pp over the last 90 days — open a scorer PR this week.",
    );
  });

  test("low urgency with rationale → emits '🟢 LOW URGENCY' line", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      urgency: {
        urgency: "low",
        rationale:
          "Scorer is sharpening on its own (+12pp over the last 90 days) — these are polish changes, not firefighting.",
      },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Urgency**: 🟢 LOW URGENCY — Scorer is sharpening on its own (+12pp over the last 90 days) — these are polish changes, not firefighting.",
    );
  });

  test("medium urgency with a rationale still surfaces it (thin-sample directional warning)", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      urgency: {
        urgency: "medium",
        rationale: "Directional signal: scorer may be dulling (-25pp) but sample is thin.",
      },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Urgency**: 🟡 STANDARD — Directional signal: scorer may be dulling (-25pp) but sample is thin.",
    );
  });
});

describe("renderProposalMarkdownWithContext — calibration drift", () => {
  const calib: CalibrationDriftReport = {
    referenceDate: "2026-01-01T00:00:00.000Z",
    windowDays: 90,
    recentN: 25,
    priorN: 40,
    recentAccuracy: 0.58,
    priorAccuracy: 0.7,
    accuracyDelta: -0.12,
    recentBrier: 0.24,
    priorBrier: 0.2,
    brierDelta: 0.04,
    direction: "degrading",
    lowConfidence: false,
  };

  test("degrading calibration → full numeric line", () => {
    const ctx: ProposalMarkdownContext = { ...nullCtx(), calibrationDrift: calib };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Calibration drift** (90d): degrading · hit rate -12pp, Brier +0.040 · 25 recent vs 40 prior deals",
    );
  });

  test("low-confidence calibration → appends '_(directional only — thin sample)_'", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      calibrationDrift: { ...calib, recentN: 6, priorN: 4, lowConfidence: true },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("_(directional only — thin sample)_");
  });

  test("zero-data calibration drift → omitted entirely", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      calibrationDrift: {
        ...calib,
        recentN: 0,
        priorN: 0,
        accuracyDelta: null,
        brierDelta: null,
        direction: "stable",
      },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Calibration drift**");
  });
});

describe("renderProposalMarkdownWithContext — factor drift", () => {
  function mkDrift(
    label: string,
    direction: FactorDrift["direction"],
    drift: number,
    lowConfidence = false,
  ): FactorDrift {
    return {
      label,
      recentLift: null,
      priorLift: null,
      drift,
      direction,
      recentPresent: 10,
      priorPresent: 15,
      recentAvgWeight: 5,
      lowConfidence,
    };
  }

  test("top 3 drifting factors render as a bulleted list with sign-prefixed pp", () => {
    const report: FactorDriftReport = {
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 25,
      priorN: 40,
      drifts: [
        mkDrift("Trade in hand", "flipped", -0.4),
        mkDrift("Repeat buyer", "rising", 0.15),
        mkDrift("Heavy equipment", "falling", -0.2),
      ],
      lowConfidence: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), factorDrift: report };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Factor drift** (top 3):");
    expect(md).toContain("  - `Trade in hand` · flipped · -40pp");
    expect(md).toContain("  - `Repeat buyer` · rising · +15pp");
    expect(md).toContain("  - `Heavy equipment` · falling · -20pp");
  });

  test("more than 3 drifting factors → renders '+N more' footer", () => {
    const report: FactorDriftReport = {
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 25,
      priorN: 40,
      drifts: [
        mkDrift("A", "flipped", -0.5),
        mkDrift("B", "falling", -0.2),
        mkDrift("C", "rising", 0.15),
        mkDrift("D", "rising", 0.12),
        mkDrift("E", "rising", 0.11),
      ],
      lowConfidence: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), factorDrift: report };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("  - _+2 more drifting factors not shown_");
  });

  test("exactly one excess factor → singular 'factor not shown'", () => {
    const report: FactorDriftReport = {
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 25,
      priorN: 40,
      drifts: [
        mkDrift("A", "flipped", -0.5),
        mkDrift("B", "falling", -0.2),
        mkDrift("C", "rising", 0.15),
        mkDrift("D", "rising", 0.12),
      ],
      lowConfidence: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), factorDrift: report };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("  - _+1 more drifting factor not shown_");
  });

  test("empty drifts → section omitted entirely", () => {
    const report: FactorDriftReport = {
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 25,
      priorN: 40,
      drifts: [],
      lowConfidence: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), factorDrift: report };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Factor drift**");
  });

  test("thin-sample factor rows append '_(thin sample)_'", () => {
    const report: FactorDriftReport = {
      referenceDate: "2026-01-01T00:00:00.000Z",
      windowDays: 90,
      recentN: 5,
      priorN: 5,
      drifts: [mkDrift("Fragile", "falling", -0.2, true)],
      lowConfidence: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), factorDrift: report };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("  - `Fragile` · falling · -20pp _(thin sample)_");
  });
});

describe("renderProposalMarkdownWithContext — what-if preview", () => {
  const whatIf: ScorerWhatIfResult = {
    dealsSimulated: 18,
    currentBrier: 0.262,
    simulatedBrier: 0.201,
    brierDelta: -0.061,
    currentHitRate: 0.56,
    simulatedHitRate: 0.72,
    hitRateDelta: 0.16,
    perDeal: [],
    lowConfidence: false,
    noActionableChanges: false,
  };

  test("improving what-if → full Brier + hit-rate line", () => {
    const ctx: ProposalMarkdownContext = { ...nullCtx(), whatIf };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**What-if preview** (18 deals): Brier 0.262 → 0.201, hit rate 56% → 72%",
    );
  });

  test("noActionableChanges what-if → section omitted", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      whatIf: { ...whatIf, noActionableChanges: true },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**What-if preview**");
  });

  test("lowConfidence what-if appends '_(thin sample)_'", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      whatIf: { ...whatIf, lowConfidence: true, dealsSimulated: 4 },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("_(thin sample)_");
  });
});

describe("renderProposalMarkdownWithContext — composed output", () => {
  test("full context produces a canonical ticket body", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      urgency: {
        urgency: "high",
        rationale: "Scorer dulled -12pp over the last 90 days — open a scorer PR this week.",
      },
      calibrationDrift: {
        referenceDate: "2026-01-01T00:00:00.000Z",
        windowDays: 90,
        recentN: 25,
        priorN: 40,
        recentAccuracy: 0.58,
        priorAccuracy: 0.7,
        accuracyDelta: -0.12,
        recentBrier: 0.24,
        priorBrier: 0.2,
        brierDelta: 0.04,
        direction: "degrading",
        lowConfidence: false,
      },
      factorDrift: {
        referenceDate: "2026-01-01T00:00:00.000Z",
        windowDays: 90,
        recentN: 25,
        priorN: 40,
        drifts: [
          {
            label: "Trade in hand",
            recentLift: -0.05,
            priorLift: 0.3,
            drift: -0.35,
            direction: "flipped",
            recentPresent: 8,
            priorPresent: 15,
            recentAvgWeight: 8,
            lowConfidence: false,
          },
        ],
        lowConfidence: false,
      },
      whatIf: {
        dealsSimulated: 18,
        currentBrier: 0.262,
        simulatedBrier: 0.201,
        brierDelta: -0.061,
        currentHitRate: 0.56,
        simulatedHitRate: 0.72,
        hitRateDelta: 0.16,
        perDeal: [],
        lowConfidence: false,
        noActionableChanges: false,
      },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    // Verify ordering: Context → Urgency → Calibration drift →
    // Factor drift → What-if → proposal body.
    const idxContext = md.indexOf("## Context");
    const idxUrgency = md.indexOf("**Urgency**");
    const idxCalib = md.indexOf("**Calibration drift**");
    const idxFactor = md.indexOf("**Factor drift**");
    const idxWhatIf = md.indexOf("**What-if preview**");
    const idxProposal = md.indexOf("## Scorer Evolution Proposal");
    expect(idxContext).toBeGreaterThanOrEqual(0);
    expect(idxUrgency).toBeGreaterThan(idxContext);
    expect(idxCalib).toBeGreaterThan(idxUrgency);
    expect(idxFactor).toBeGreaterThan(idxCalib);
    expect(idxWhatIf).toBeGreaterThan(idxFactor);
    expect(idxProposal).toBeGreaterThan(idxWhatIf);
  });
});

// ── Slice 20x additions — confidence + call flips in the markdown ────

describe("renderProposalMarkdownWithContext — confidence section (20x)", () => {
  test("high-band confidence with drivers renders pill, rationale, and per-driver bullets", () => {
    const confidence: ProposalConfidenceResult = {
      confidence: 82,
      band: "high",
      drivers: [
        {
          signal: "what_if",
          contribution: 25,
          rationale:
            "Simulated Brier improves by 0.040 and hit rate lifts +9pp on 30 historical deals — strongest single signal.",
        },
        {
          signal: "sample_size",
          contribution: 20,
          rationale: "60 closed-deal audits back this proposal — substantial sample.",
        },
      ],
      rationale:
        "High confidence (82) — driven by what-if preview (+25) plus sample size (+20).",
      dampenedByThinSample: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), confidence };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Confidence**: 82/100 · HIGH CONFIDENCE");
    expect(md).toContain("_High confidence (82) — driven by what-if preview (+25) plus sample size (+20)._");
    expect(md).toContain("`+25` — Simulated Brier improves by 0.040");
    expect(md).toContain("`+20` — 60 closed-deal audits back this proposal");
  });

  test("low-band confidence with negative drivers — signs format correctly", () => {
    const confidence: ProposalConfidenceResult = {
      confidence: 28,
      band: "low",
      drivers: [
        {
          signal: "what_if",
          contribution: -15,
          rationale:
            "Simulated Brier worsens by 0.030 on 20 deals — applying this would hurt accuracy.",
        },
        {
          signal: "sample_size",
          contribution: -5,
          rationale: "Only 3 closed-deal audits — below the 11-deal minimum for trustworthy attribution.",
        },
      ],
      rationale:
        "Low confidence (28) — the dominant drag is what-if preview (-15), with sample size (-5). Hold until signals strengthen.",
      dampenedByThinSample: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), confidence };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Confidence**: 28/100 · LOW CONFIDENCE");
    expect(md).toContain("`-15` — Simulated Brier worsens");
    expect(md).toContain("`-5` — Only 3 closed-deal audits");
  });

  test("dampened confidence appends italicized '(dampened — thin attribution sample)'", () => {
    const confidence: ProposalConfidenceResult = {
      confidence: 55,
      band: "medium",
      drivers: [],
      rationale: "Medium confidence (55) — stub.",
      dampenedByThinSample: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), confidence };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Confidence**: 55/100 · MEDIUM CONFIDENCE _(dampened — thin attribution sample)_",
    );
  });
});

describe("renderProposalMarkdownWithContext — call flips section (20x)", () => {
  test("mixed call-flip report renders corroborating + regressing buckets", () => {
    const callFlips: ProposalCallFlipReport = {
      corroborating: [
        {
          packageId: "pkg_a1",
          outcome: "won",
          previousCall: "miss",
          proposedCall: "win",
          previous: 42,
          proposed: 70,
          delta: 28,
          kind: "corroborating",
        },
      ],
      regressing: [
        {
          packageId: "pkg_r1",
          outcome: "won",
          previousCall: "win",
          proposedCall: "miss",
          previous: 62,
          proposed: 40,
          delta: -22,
          kind: "regressing",
        },
      ],
      alignedUnchangedCount: 10,
      misalignedUnchangedCount: 2,
      expiredCount: 1,
      resolvedCount: 14,
      netImprovement: 0,
      totalFlips: 2,
      lowConfidence: false,
      empty: false,
      noActionableChanges: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), callFlips };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Call flips**: 1 corroborating, 1 regressing (net zero).");
    expect(md).toContain("✅ Corroborating");
    expect(md).toContain("`pkg_a1` · 42% (miss) → 70% (win) · won");
    expect(md).toContain("⚠️ Regressing");
    expect(md).toContain("`pkg_r1` · 62% (win) → 40% (miss) · won");
  });

  test("all-regressing call-flip report uses the warning headline", () => {
    const callFlips: ProposalCallFlipReport = {
      corroborating: [],
      regressing: [
        {
          packageId: "pkg_r1",
          outcome: "won",
          previousCall: "win",
          proposedCall: "miss",
          previous: 62,
          proposed: 40,
          delta: -22,
          kind: "regressing",
        },
      ],
      alignedUnchangedCount: 0,
      misalignedUnchangedCount: 0,
      expiredCount: 0,
      resolvedCount: 1,
      netImprovement: -1,
      totalFlips: 1,
      lowConfidence: false,
      empty: false,
      noActionableChanges: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), callFlips };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("⚠ 1 call would regress, none would corroborate");
    // No "Corroborating" section should render since bucket is empty.
    expect(md).not.toContain("✅ Corroborating");
  });

  test("zero-flip report ('refines without changing verdicts') still renders headline, no buckets", () => {
    const callFlips: ProposalCallFlipReport = {
      corroborating: [],
      regressing: [],
      alignedUnchangedCount: 15,
      misalignedUnchangedCount: 3,
      expiredCount: 0,
      resolvedCount: 18,
      netImprovement: 0,
      totalFlips: 0,
      lowConfidence: false,
      empty: false,
      noActionableChanges: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), callFlips };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Call flips**: No call flips on 18 resolved deals — the proposal refines scores without changing any verdicts.",
    );
    expect(md).not.toContain("✅ Corroborating");
    expect(md).not.toContain("⚠️ Regressing");
  });

  test("empty call-flip report → section omitted entirely", () => {
    const callFlips: ProposalCallFlipReport = {
      corroborating: [],
      regressing: [],
      alignedUnchangedCount: 0,
      misalignedUnchangedCount: 0,
      expiredCount: 0,
      resolvedCount: 0,
      netImprovement: 0,
      totalFlips: 0,
      lowConfidence: false,
      empty: true,
      noActionableChanges: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), callFlips };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Call flips**");
  });

  test("noActionableChanges call-flip report → section omitted entirely", () => {
    const callFlips: ProposalCallFlipReport = {
      corroborating: [],
      regressing: [],
      alignedUnchangedCount: 0,
      misalignedUnchangedCount: 0,
      expiredCount: 0,
      resolvedCount: 0,
      netImprovement: 0,
      totalFlips: 0,
      lowConfidence: false,
      empty: false,
      noActionableChanges: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), callFlips };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Call flips**");
  });
});

describe("renderProposalMarkdownWithContext — full ordering with 20v + 20w", () => {
  test("composed output reads top-down: urgency → calibration → factors → what-if → call flips → confidence → proposal body", () => {
    const confidence: ProposalConfidenceResult = {
      confidence: 75,
      band: "high",
      drivers: [
        {
          signal: "what_if",
          contribution: 25,
          rationale: "Strong what-if gain.",
        },
      ],
      rationale: "High confidence (75) — strong what-if.",
      dampenedByThinSample: false,
    };
    const callFlips: ProposalCallFlipReport = {
      corroborating: [
        {
          packageId: "pkg_a1",
          outcome: "won",
          previousCall: "miss",
          proposedCall: "win",
          previous: 42,
          proposed: 70,
          delta: 28,
          kind: "corroborating",
        },
      ],
      regressing: [],
      alignedUnchangedCount: 5,
      misalignedUnchangedCount: 0,
      expiredCount: 0,
      resolvedCount: 6,
      netImprovement: 1,
      totalFlips: 1,
      lowConfidence: false,
      empty: false,
      noActionableChanges: false,
    };
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      urgency: {
        urgency: "high",
        rationale: "Scorer dulled -10pp over the last 90 days — open a scorer PR this week.",
      },
      calibrationDrift: {
        referenceDate: "2026-04-01T00:00:00.000Z",
        windowDays: 90,
        recentN: 30,
        priorN: 45,
        recentAccuracy: 0.55,
        priorAccuracy: 0.65,
        accuracyDelta: -0.1,
        recentBrier: 0.26,
        priorBrier: 0.21,
        brierDelta: 0.05,
        direction: "degrading",
        lowConfidence: false,
      },
      factorDrift: {
        referenceDate: "2026-04-01T00:00:00.000Z",
        windowDays: 90,
        recentN: 30,
        priorN: 45,
        drifts: [
          {
            label: "Trade in hand",
            direction: "flipped",
            drift: -0.25,
            priorLift: 0.1,
            recentLift: -0.15,
            priorPresent: 20,
            recentPresent: 10,
            recentAvgWeight: 8,
            lowConfidence: false,
          },
        ],
        lowConfidence: false,
      },
      whatIf: {
        dealsSimulated: 18,
        currentBrier: 0.26,
        simulatedBrier: 0.2,
        brierDelta: -0.06,
        currentHitRate: 0.56,
        simulatedHitRate: 0.72,
        hitRateDelta: 0.16,
        perDeal: [],
        lowConfidence: false,
        noActionableChanges: false,
      },
      callFlips,
      confidence,
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const idxContext = md.indexOf("## Context");
    const idxUrgency = md.indexOf("**Urgency**");
    const idxCalib = md.indexOf("**Calibration drift**");
    const idxFactor = md.indexOf("**Factor drift**");
    const idxWhatIf = md.indexOf("**What-if preview**");
    const idxCallFlips = md.indexOf("**Call flips**");
    const idxConfidence = md.indexOf("**Confidence**");
    const idxProposal = md.indexOf("## Scorer Evolution Proposal");
    expect(idxContext).toBeGreaterThanOrEqual(0);
    expect(idxUrgency).toBeGreaterThan(idxContext);
    expect(idxCalib).toBeGreaterThan(idxUrgency);
    expect(idxFactor).toBeGreaterThan(idxCalib);
    expect(idxWhatIf).toBeGreaterThan(idxFactor);
    expect(idxCallFlips).toBeGreaterThan(idxWhatIf);
    expect(idxConfidence).toBeGreaterThan(idxCallFlips);
    expect(idxProposal).toBeGreaterThan(idxConfidence);
  });
});

// ── Slice 20y additions — apply verdict in the markdown ──────────────

describe("renderProposalMarkdownWithContext — verdict section (20y)", () => {
  test("apply verdict renders pill + headline + positive-first reasons", () => {
    const verdict: ProposalApplyVerdict = {
      verdict: "apply",
      headline:
        "Apply — evidence is aligned (confidence 82/100, 3 corroborating flips, Brier −0.040).",
      reasons: [
        {
          kind: "confidence",
          polarity: "positive",
          rationale: "Meta-confidence is 82/100 (HIGH band) — signals align.",
        },
        {
          kind: "flips",
          polarity: "positive",
          rationale:
            "3 calls would flip toward the right answer, none in the wrong direction.",
        },
        {
          kind: "what_if",
          polarity: "positive",
          rationale: "Simulated Brier improves by 0.040 on 30 closed deals.",
        },
      ],
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), verdict };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Verdict**: ✓ APPLY — Apply — evidence is aligned (confidence 82/100, 3 corroborating flips, Brier −0.040).",
    );
    expect(md).toContain(
      "  - ✓ Meta-confidence is 82/100 (HIGH band) — signals align.",
    );
    expect(md).toContain(
      "  - ✓ 3 calls would flip toward the right answer, none in the wrong direction.",
    );
  });

  test("hold verdict renders ✗ pill and ⚠ icons for negative reasons", () => {
    const verdict: ProposalApplyVerdict = {
      verdict: "hold",
      headline: "Hold — meta-confidence is 30/100 (low band) — signals don't yet support applying.",
      reasons: [
        {
          kind: "confidence",
          polarity: "negative",
          rationale:
            "Meta-confidence is 30/100 (LOW band) — signals don't yet support applying.",
        },
      ],
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), verdict };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Verdict**: ✗ HOLD — Hold —");
    expect(md).toContain("  - ⚠ Meta-confidence is 30/100 (LOW band)");
  });

  test("review verdict renders ⚠ pill and negative reasons first", () => {
    const verdict: ProposalApplyVerdict = {
      verdict: "review",
      headline: "Review before applying — 1 deal would regress.",
      reasons: [
        {
          kind: "flips",
          polarity: "negative",
          rationale:
            "1 deal would regress — review the specific flips before applying.",
        },
        {
          kind: "confidence",
          polarity: "positive",
          rationale: "Meta-confidence is 78/100 (HIGH band) — signals align.",
        },
      ],
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), verdict };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Verdict**: ⚠ REVIEW");
    expect(md).toContain("  - ⚠ 1 deal would regress");
    expect(md).toContain("  - ✓ Meta-confidence is 78/100");
  });

  test("defer verdict renders — pill with headline only (no reasons bullets)", () => {
    const verdict: ProposalApplyVerdict = {
      verdict: "defer",
      headline: "No proposal available.",
      reasons: [],
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), verdict };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Verdict**: — DEFER — No proposal available.");
    // No bullets should be rendered when reasons is empty.
    expect(md).not.toMatch(/Verdict[\s\S]{0,50}\n {2}-/);
  });

  test("verdict section sits above everything else — top of the Context block", () => {
    const verdict: ProposalApplyVerdict = {
      verdict: "apply",
      headline: "Apply — evidence is aligned.",
      reasons: [
        {
          kind: "confidence",
          polarity: "positive",
          rationale: "Signals align.",
        },
      ],
    };
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      verdict,
      urgency: {
        urgency: "high",
        rationale: "Some high-urgency reason.",
      },
      confidence: {
        confidence: 82,
        band: "high",
        drivers: [],
        rationale: "High.",
        dampenedByThinSample: false,
      },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const idxVerdict = md.indexOf("**Verdict**");
    const idxUrgency = md.indexOf("**Urgency**");
    const idxConfidence = md.indexOf("**Confidence**");
    const idxProposal = md.indexOf("## Scorer Evolution Proposal");
    expect(idxVerdict).toBeGreaterThan(0);
    expect(idxUrgency).toBeGreaterThan(idxVerdict);
    expect(idxConfidence).toBeGreaterThan(idxUrgency);
    expect(idxProposal).toBeGreaterThan(idxConfidence);
  });

  test("null verdict → no '**Verdict**' line rendered (back-compat)", () => {
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      urgency: { urgency: "medium", rationale: "Some rationale." },
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Verdict**");
    expect(md).toContain("**Urgency**");
  });
});

// ── Slice 20z additions — watchlist in the markdown ──────────────────

describe("renderProposalMarkdownWithContext — watchlist section (20z)", () => {
  test("non-empty watchlist renders headline + per-item priority + concern + trigger", () => {
    const watchlist: ProposalWatchlist = {
      items: [
        {
          label: "Trade in hand",
          action: "flip",
          concern: "Proposal flipped the sign of this factor — a sign reversal is the largest behavior change the scorer can make.",
          trigger: "If hit-rate-when-present drifts back within ±5pp of hit-rate-when-absent over the next 20 closed deals, reconsider — the flip may be chasing noise.",
          priority: "high",
        },
        {
          label: "Ancient factor",
          action: "drop",
          concern: "Proposal drops this factor from the scorer — after applying, the scorer will no longer consider it at all.",
          trigger: "If |lift| rises above ±10pp over the next 20 closed deals, reconsider — the signal may have come back.",
          priority: "medium",
        },
      ],
      headline: "2 factors to monitor after applying — 1 high-priority (sign reversals).",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), watchlist };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Watchlist**: 2 factors to monitor after applying — 1 high-priority (sign reversals).",
    );
    expect(md).toContain("  - `Trade in hand` · flip · 🔴 high");
    expect(md).toContain("    - _Concern_: Proposal flipped the sign of this factor");
    expect(md).toContain("    - _Trigger_: If hit-rate-when-present drifts back");
    expect(md).toContain("  - `Ancient factor` · drop · 🟡 medium");
  });

  test("empty watchlist (no items) → section omitted entirely", () => {
    const watchlist: ProposalWatchlist = {
      items: [],
      headline: null,
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), watchlist };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Watchlist**");
  });

  test("null watchlist → section omitted entirely", () => {
    const ctx: ProposalMarkdownContext = { ...nullCtx() };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Watchlist**");
  });

  test("low-priority item renders ⚪ icon", () => {
    const watchlist: ProposalWatchlist = {
      items: [
        {
          label: "Volatile factor",
          action: "weaken",
          concern: "Proposal weakens this factor — the signal survives but at reduced magnitude.",
          trigger: "If hit-rate-when-present recovers above its pre-weakening baseline, revisit.",
          priority: "low",
        },
      ],
      headline: "1 factor to monitor closely after applying.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), watchlist };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("  - `Volatile factor` · weaken · ⚪ low");
  });

  test("watchlist sits below confidence, above proposal body", () => {
    const watchlist: ProposalWatchlist = {
      items: [
        {
          label: "F",
          action: "flip",
          concern: "x",
          trigger: "y",
          priority: "high",
        },
      ],
      headline: "1 factor to monitor closely after applying.",
      empty: false,
    };
    const confidence: ProposalConfidenceResult = {
      confidence: 70,
      band: "high",
      drivers: [],
      rationale: "ok",
      dampenedByThinSample: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), confidence, watchlist };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const idxConfidence = md.indexOf("**Confidence**");
    const idxWatchlist = md.indexOf("**Watchlist**");
    const idxProposal = md.indexOf("## Scorer Evolution Proposal");
    expect(idxConfidence).toBeGreaterThanOrEqual(0);
    expect(idxWatchlist).toBeGreaterThan(idxConfidence);
    expect(idxProposal).toBeGreaterThan(idxWatchlist);
  });

  test("headline falls back to generic count when watchlist.headline is null", () => {
    const watchlist: ProposalWatchlist = {
      items: [
        {
          label: "F",
          action: "flip",
          concern: "x",
          trigger: "y",
          priority: "high",
        },
        {
          label: "G",
          action: "drop",
          concern: "x",
          trigger: "y",
          priority: "medium",
        },
      ],
      headline: null, // weird shape — item count > 0 but no headline
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), watchlist };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Watchlist**: 2 factors to monitor after applying.");
  });
});

describe("renderProposalMarkdownWithContext — stability section (20aa)", () => {
  test("empty stability report → no Stability block", () => {
    const stability: ProposalStabilityReport = {
      changes: [],
      meanStability: null,
      rating: null,
      headline: null,
      empty: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), stability };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("Stability");
  });

  test("null stability → no Stability block (silent fallthrough)", () => {
    const ctx: ProposalMarkdownContext = { ...nullCtx(), stability: null };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Stability**");
  });

  test("stable rating → emerald pill + 100% stable row, no drift hint", () => {
    const stability: ProposalStabilityReport = {
      changes: [
        {
          label: "Trade in hand",
          action: "flip",
          stability: 1,
          altAction: null,
          rating: "stable",
        },
      ],
      meanStability: 1,
      rating: "stable",
      headline: "Stable — 100% mean stability across 1 actionable change, all survive small lift perturbations.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), stability };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Stability**: ✓ STABLE 100%");
    expect(md).toContain("Stable — 100% mean stability");
    expect(md).toContain("`Trade in hand` · flip · 🟢 stable (100% stable)");
    expect(md).not.toContain("would drift to");
  });

  test("mixed rating → amber pill + includes altAction hint when present", () => {
    const stability: ProposalStabilityReport = {
      changes: [
        {
          label: "Tiny signal",
          action: "drop",
          stability: 0.6,
          altAction: "keep",
          rating: "mixed",
        },
      ],
      meanStability: 0.6,
      rating: "mixed",
      headline: "Mixed — 60% mean stability across 1 actionable change (0 stable, 1 mixed).",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), stability };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Stability**: ⚠ MIXED 60%");
    expect(md).toContain("🟡 mixed");
    expect(md).toContain("would drift to `keep`");
  });

  test("fragile rating → rose pill", () => {
    const stability: ProposalStabilityReport = {
      changes: [
        {
          label: "Edge",
          action: "strengthen",
          stability: 0.2,
          altAction: "keep",
          rating: "fragile",
        },
      ],
      meanStability: 0.2,
      rating: "fragile",
      headline: "Fragile — 20% mean stability, 1 of 1 change would pick a different action under small perturbations.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), stability };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Stability**: ✗ FRAGILE 20%");
    expect(md).toContain("🔴 fragile");
  });

  test("multiple changes → each gets its own row with label, action, rating, pct", () => {
    const stability: ProposalStabilityReport = {
      changes: [
        {
          label: "A",
          action: "drop",
          stability: 0.4,
          altAction: "keep",
          rating: "fragile",
        },
        {
          label: "B",
          action: "flip",
          stability: 1,
          altAction: null,
          rating: "stable",
        },
      ],
      meanStability: 0.7,
      rating: "mixed",
      headline: "Mixed — 70% mean stability, but 1 of 2 changes is fragile against small perturbations.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), stability };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("`A` · drop · 🔴 fragile (40% stable)");
    expect(md).toContain("`B` · flip · 🟢 stable (100% stable)");
    // Stable row should not have drift-to hint
    expect(md.includes("`B` · flip · 🟢 stable (100% stable) · would drift")).toBe(
      false,
    );
  });

  test("stability block sits between confidence and watchlist in ordering", () => {
    const stability: ProposalStabilityReport = {
      changes: [
        {
          label: "Trade in hand",
          action: "flip",
          stability: 1,
          altAction: null,
          rating: "stable",
        },
      ],
      meanStability: 1,
      rating: "stable",
      headline: "Stable — 100% mean stability.",
      empty: false,
    };
    const confidence: ProposalConfidenceResult = {
      confidence: 75,
      band: "high",
      rationale: "Signals aligned across drift, audit, and corroboration.",
      drivers: [],
      dampenedByThinSample: false,
    };
    const watchlist: ProposalWatchlist = {
      items: [
        {
          label: "Trade in hand",
          action: "flip",
          concern: "sign reversal",
          trigger: "revisit within 20 deals",
          priority: "high",
        },
      ],
      headline: "1 factor to monitor closely after applying.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      confidence,
      stability,
      watchlist,
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const confidenceIdx = md.indexOf("**Confidence**");
    const stabilityIdx = md.indexOf("**Stability**");
    const watchlistIdx = md.indexOf("**Watchlist**");
    expect(confidenceIdx).toBeGreaterThan(-1);
    expect(stabilityIdx).toBeGreaterThan(-1);
    expect(watchlistIdx).toBeGreaterThan(-1);
    expect(confidenceIdx).toBeLessThan(stabilityIdx);
    expect(stabilityIdx).toBeLessThan(watchlistIdx);
  });
});

describe("renderProposalMarkdownWithContext — rollback section (20ab)", () => {
  test("null rollback → no Rollback plan block", () => {
    const ctx: ProposalMarkdownContext = { ...nullCtx(), rollback: null };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Rollback plan**");
  });

  test("empty rollback → no Rollback plan block (silent fallthrough)", () => {
    const rollback: ProposalRollbackPlan = {
      steps: [],
      headline: null,
      empty: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), rollback };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Rollback plan**");
  });

  test("single flip step renders with priority + operation + impact", () => {
    const rollback: ProposalRollbackPlan = {
      steps: [
        {
          label: "Trade in hand",
          action: "flip",
          operation: "Revert sign flip — restore the positive weight direction at +8.0.",
          impact: "Deals that re-scored under the flipped sign return to their pre-proposal ranking on this factor.",
          priority: "high",
          hasWatchTrigger: false,
        },
      ],
      headline: "1 rollback step — 1 sign flip.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), rollback };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Rollback plan**: 1 rollback step — 1 sign flip.");
    expect(md).toContain("`Trade in hand` · flip · 🔴 high");
    expect(md).toContain("_Operation_:");
    expect(md).toContain("_Impact_:");
    // Not cross-linked → no 👁 watched tag
    expect(md).not.toContain("👁");
  });

  test("cross-linked step carries 👁 watched tag", () => {
    const rollback: ProposalRollbackPlan = {
      steps: [
        {
          label: "Trade in hand",
          action: "flip",
          operation: "Revert sign flip — restore +8.0.",
          impact: "Deals return to prior ranking.",
          priority: "high",
          hasWatchTrigger: true,
        },
      ],
      headline: "1 rollback step — 1 sign flip. All cross-linked to the watchlist.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), rollback };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("👁 watched");
    expect(md).toContain("All cross-linked to the watchlist");
  });

  test("multi-step rollback emits each step with its priority badge", () => {
    const rollback: ProposalRollbackPlan = {
      steps: [
        {
          label: "A",
          action: "flip",
          operation: "op a",
          impact: "impact a",
          priority: "high",
          hasWatchTrigger: true,
        },
        {
          label: "B",
          action: "drop",
          operation: "op b",
          impact: "impact b",
          priority: "medium",
          hasWatchTrigger: false,
        },
        {
          label: "C",
          action: "strengthen",
          operation: "op c",
          impact: "impact c",
          priority: "low",
          hasWatchTrigger: false,
        },
      ],
      headline: "3 rollback steps — 1 sign flip, 1 re-add, 1 weight adjustment. 1 of 3 cross-linked to the watchlist.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), rollback };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("`A` · flip · 🔴 high · 👁 watched");
    expect(md).toContain("`B` · drop · 🟡 medium");
    expect(md).toContain("`C` · strengthen · ⚪ low");
    // B and C have no watchtrigger so no 👁 on their lines
    expect(md).not.toContain("`B` · drop · 🟡 medium · 👁");
    expect(md).not.toContain("`C` · strengthen · ⚪ low · 👁");
  });

  test("rollback sits after watchlist in the context ordering", () => {
    const watchlist = {
      items: [
        {
          label: "Trade in hand",
          action: "flip" as const,
          concern: "sign reversal",
          trigger: "revisit in 20 deals",
          priority: "high" as const,
        },
      ],
      headline: "1 factor to monitor closely after applying.",
      empty: false,
    };
    const rollback: ProposalRollbackPlan = {
      steps: [
        {
          label: "Trade in hand",
          action: "flip",
          operation: "Revert sign flip.",
          impact: "Deals revert.",
          priority: "high",
          hasWatchTrigger: true,
        },
      ],
      headline: "1 rollback step — 1 sign flip. All cross-linked to the watchlist.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      watchlist,
      rollback,
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const watchlistIdx = md.indexOf("**Watchlist**");
    const rollbackIdx = md.indexOf("**Rollback plan**");
    expect(watchlistIdx).toBeGreaterThan(-1);
    expect(rollbackIdx).toBeGreaterThan(-1);
    expect(watchlistIdx).toBeLessThan(rollbackIdx);
  });
});

describe("preflight checklist section (20ac)", () => {
  test("null preflight → no '**Pre-flight**' line rendered", () => {
    const ctx: ProposalMarkdownContext = { ...nullCtx(), preflight: null };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Pre-flight**");
  });

  test("empty preflight → no section rendered", () => {
    const preflight: PreflightChecklist = {
      items: [],
      passCount: 0,
      warnCount: 0,
      failCount: 0,
      skippedCount: 0,
      readiness: "hold",
      headline: null,
      empty: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), preflight };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Pre-flight**");
  });

  test("ready preflight renders ✓ READY pill + per-row evidence", () => {
    const preflight: PreflightChecklist = {
      items: [
        {
          id: "sample",
          label: "Sample adequate",
          status: "pass",
          evidence: "50 deals analyzed (≥ 10)",
        },
        {
          id: "confidence",
          label: "Confidence",
          status: "pass",
          evidence: "82/100 (high)",
        },
        {
          id: "verdict",
          label: "Verdict",
          status: "pass",
          evidence: "apply",
        },
      ],
      passCount: 3,
      warnCount: 0,
      failCount: 0,
      skippedCount: 0,
      readiness: "ready",
      headline: "Ready to apply — 3 passed.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), preflight };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Pre-flight**: ✓ READY — Ready to apply — 3 passed.");
    expect(md).toContain("✓ pass · Sample adequate — 50 deals analyzed (≥ 10)");
    expect(md).toContain("✓ pass · Confidence — 82/100 (high)");
    expect(md).toContain("✓ pass · Verdict — apply");
  });

  test("review preflight renders ⚠ REVIEW pill", () => {
    const preflight: PreflightChecklist = {
      items: [
        {
          id: "confidence",
          label: "Confidence",
          status: "warn",
          evidence: "50/100 (medium)",
        },
        {
          id: "verdict",
          label: "Verdict",
          status: "warn",
          evidence: "review",
        },
      ],
      passCount: 0,
      warnCount: 2,
      failCount: 0,
      skippedCount: 5,
      readiness: "review",
      headline: "Review recommended — 2 warn, 5 skipped.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), preflight };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Pre-flight**: ⚠ REVIEW");
    expect(md).toContain("⚠ warn · Confidence — 50/100 (medium)");
  });

  test("hold preflight renders ✗ HOLD pill", () => {
    const preflight: PreflightChecklist = {
      items: [
        {
          id: "verdict",
          label: "Verdict",
          status: "fail",
          evidence: "hold",
        },
      ],
      passCount: 0,
      warnCount: 0,
      failCount: 1,
      skippedCount: 6,
      readiness: "hold",
      headline: "Not ready — 1 failed, 6 skipped.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), preflight };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Pre-flight**: ✗ HOLD");
    expect(md).toContain("✗ fail · Verdict — hold");
  });

  test("skipped row renders with · skipped prefix", () => {
    const preflight: PreflightChecklist = {
      items: [
        {
          id: "what_if",
          label: "What-if Brier",
          status: "skipped",
          evidence: "no historical audit sample",
        },
      ],
      passCount: 0,
      warnCount: 0,
      failCount: 0,
      skippedCount: 1,
      readiness: "ready",
      headline: "Ready to apply — 1 skipped.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), preflight };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("· skipped · What-if Brier — no historical audit sample");
  });

  test("preflight renders above urgency + calibration drift in ordering", () => {
    const preflight: PreflightChecklist = {
      items: [
        {
          id: "sample",
          label: "Sample adequate",
          status: "pass",
          evidence: "50 deals analyzed (≥ 10)",
        },
      ],
      passCount: 1,
      warnCount: 0,
      failCount: 0,
      skippedCount: 6,
      readiness: "ready",
      headline: "Ready to apply — 1 passed, 6 skipped.",
      empty: false,
    };
    const urgency: ProposalUrgencyResult = {
      urgency: "high",
      rationale: "Scorer is dulling.",
    };
    const calibrationDrift: CalibrationDriftReport = {
      referenceDate: "2026-04-20T00:00:00Z",
      windowDays: 30,
      recentN: 20,
      priorN: 20,
      recentAccuracy: 0.55,
      priorAccuracy: 0.65,
      accuracyDelta: -0.1,
      recentBrier: 0.25,
      priorBrier: 0.2,
      brierDelta: 0.05,
      direction: "degrading",
      lowConfidence: false,
    };
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      preflight,
      urgency,
      calibrationDrift,
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const idxPreflight = md.indexOf("**Pre-flight**");
    const idxUrgency = md.indexOf("**Urgency**");
    const idxCalib = md.indexOf("**Calibration drift**");
    expect(idxPreflight).toBeGreaterThan(-1);
    expect(idxUrgency).toBeGreaterThan(idxPreflight);
    expect(idxCalib).toBeGreaterThan(idxUrgency);
  });

  test("preflight renders below verdict in ordering", () => {
    const preflight: PreflightChecklist = {
      items: [
        {
          id: "verdict",
          label: "Verdict",
          status: "pass",
          evidence: "apply",
        },
      ],
      passCount: 1,
      warnCount: 0,
      failCount: 0,
      skippedCount: 6,
      readiness: "ready",
      headline: "Ready to apply — 1 passed, 6 skipped.",
      empty: false,
    };
    const verdict: ProposalApplyVerdict = {
      verdict: "apply",
      headline: "Apply.",
      reasons: [],
    };
    const ctx: ProposalMarkdownContext = {
      ...nullCtx(),
      verdict,
      preflight,
    };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const idxVerdict = md.indexOf("**Verdict**");
    const idxPreflight = md.indexOf("**Pre-flight**");
    expect(idxVerdict).toBeGreaterThan(-1);
    expect(idxPreflight).toBeGreaterThan(idxVerdict);
  });
});

describe("diff section (20ad)", () => {
  test("null diff → no '**Proposal diff**' line rendered", () => {
    const ctx: ProposalMarkdownContext = { ...nullCtx(), diff: null };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Proposal diff**");
  });

  test("empty diff with no unchanged → no section rendered", () => {
    const diff: ProposalDiff = {
      addedFactors: [],
      removedFactors: [],
      changedActions: [],
      unchangedCount: 0,
      headline: null,
      empty: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), diff };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).not.toContain("**Proposal diff**");
  });

  test("stable (empty + unchanged>0) still renders the stability line", () => {
    const diff: ProposalDiff = {
      addedFactors: [],
      removedFactors: [],
      changedActions: [],
      unchangedCount: 2,
      headline: "Proposal stable since last session — 2 unchanged calls.",
      empty: true,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), diff };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain(
      "**Proposal diff**: ◆ STABLE — Proposal stable since last session — 2 unchanged calls.",
    );
  });

  test("evolving diff (2 drift rows) renders added + moved sub-bullets", () => {
    const diff: ProposalDiff = {
      addedFactors: ["New-A"],
      removedFactors: [],
      changedActions: [
        {
          label: "Edge",
          previousAction: "flip",
          currentAction: "strengthen",
        },
      ],
      unchangedCount: 1,
      headline:
        "Since last session: 1 new call, 1 action moved · 1 unchanged call.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), diff };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Proposal diff**: ↻ EVOLVING");
    expect(md).toContain("➕ New call:");
    expect(md).toContain("`New-A`");
    expect(md).toContain("↻ Action moved:");
    expect(md).toContain("`Edge` · flip → strengthen");
  });

  test("diff with removedFactors renders dropped sub-bullet", () => {
    const diff: ProposalDiff = {
      addedFactors: [],
      removedFactors: ["Dropped-B"],
      changedActions: [],
      unchangedCount: 1,
      headline: "Since last session: 1 dropped · 1 unchanged call.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), diff };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("➖ Dropped from proposal:");
    expect(md).toContain("`Dropped-B`");
  });

  test("thrashing diff (3+ rows) surfaces ↯ THRASHING pill", () => {
    const diff: ProposalDiff = {
      addedFactors: ["A", "B"],
      removedFactors: [],
      changedActions: [
        { label: "C", previousAction: "flip", currentAction: "strengthen" },
      ],
      unchangedCount: 0,
      headline: "Since last session: 2 new calls, 1 action moved.",
      empty: false,
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), diff };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    expect(md).toContain("**Proposal diff**: ↯ THRASHING");
  });

  test("diff renders above preflight + urgency in ordering", () => {
    const diff: ProposalDiff = {
      addedFactors: [],
      removedFactors: [],
      changedActions: [
        { label: "Edge", previousAction: "flip", currentAction: "strengthen" },
      ],
      unchangedCount: 0,
      headline: "Since last session: 1 action moved.",
      empty: false,
    };
    const urgency: ProposalUrgencyResult = {
      urgency: "high",
      rationale: "Scorer is dulling.",
    };
    const ctx: ProposalMarkdownContext = { ...nullCtx(), diff, urgency };
    const md = renderProposalMarkdownWithContext(baseProposal(), ctx);
    const idxDiff = md.indexOf("**Proposal diff**");
    const idxUrgency = md.indexOf("**Urgency**");
    expect(idxDiff).toBeGreaterThan(-1);
    expect(idxUrgency).toBeGreaterThan(idxDiff);
  });
});
