/**
 * WAVE CI / Quality — Slice 2: axe-playwright scan helper.
 *
 * Runs an axe accessibility scan against the current page and fails the
 * test when any violation with the configured impact lands. Default
 * impact gate: serious + critical (the two levels that block product
 * shipping per the existing CLAUDE.md mission lock).
 *
 * Each violation is surfaced as a Playwright soft assert with the
 * impact, rule id, node count, help text, helpUrl, and the first
 * three CSS selectors so a rep / engineer can pinpoint the bad
 * element without leaving the CI log.
 */

import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export type AxeImpact = "minor" | "moderate" | "serious" | "critical";

export interface AxeOptions {
  /** Impact levels that should fail the test. Defaults to ["serious", "critical"]. */
  failOn?: AxeImpact[];
  /** CSS selectors to exclude from the scan (e.g. third-party iframes). */
  exclude?: string[];
  /** WCAG tag filter — defaults to wcag2a + wcag2aa + wcag21aa. */
  tags?: string[];
}

const DEFAULT_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

function formatOffenders(
  offenders: Awaited<ReturnType<InstanceType<typeof AxeBuilder>["analyze"]>>["violations"],
): string {
  return offenders
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ");
      const nodeWord = v.nodes.length === 1 ? "node" : "nodes";
      return `[${v.impact}] ${v.id} (${v.nodes.length} ${nodeWord})\n  ${v.help}\n  ${v.helpUrl}\n  nodes: ${nodes}`;
    })
    .join("\n\n");
}

export async function expectNoAxeViolations(
  page: Page,
  routeName: string,
  options: AxeOptions = {},
): Promise<void> {
  const failOn = new Set<AxeImpact>(options.failOn ?? ["serious", "critical"]);
  const builder = new AxeBuilder({ page }).withTags(options.tags ?? DEFAULT_TAGS);
  if (options.exclude) {
    for (const selector of options.exclude) {
      builder.exclude(selector);
    }
  }
  const result = await builder.analyze();
  const offenders = result.violations.filter((violation) =>
    failOn.has((violation.impact ?? "minor") as AxeImpact),
  );
  if (offenders.length === 0) return;

  const summary = formatOffenders(offenders);
  // Soft assert first so the CI log carries the human-readable summary,
  // then throw so the test stops once the surrounding step ends.
  expect
    .soft(offenders, `axe violations on ${routeName}:\n\n${summary}`)
    .toHaveLength(0);
  throw new Error(`axe violations on ${routeName} — see soft assert above`);
}
