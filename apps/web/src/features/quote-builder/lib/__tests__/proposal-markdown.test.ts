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
      calibrationDrift: null,
      factorDrift: { referenceDate: "2026-01-01T00:00:00.000Z", windowDays: 90, recentN: 0, priorN: 0, drifts: [], lowConfidence: true },
      urgency: { urgency: "medium", rationale: null },
      whatIf: null,
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
