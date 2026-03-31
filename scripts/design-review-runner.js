#!/usr/bin/env node
/**
 * CDO gate stub: `segment:gates --ui` invokes this via `bun run design:review`.
 * Replace with real visual/a11y checks when ready.
 */
const fs = require("node:fs");
const report = {
  gate: "cdo.design-review",
  verdict: "advisory",
  mission_alignment: "not_evaluated",
  note:
    "Stub runner only — no screenshots or a11y audit executed. Run manual CDO review for UI-changing releases.",
  timestamp: new Date().toISOString(),
};
fs.writeFileSync("/tmp/qep-design-review-report.json", JSON.stringify(report, null, 2));
process.exit(0);
