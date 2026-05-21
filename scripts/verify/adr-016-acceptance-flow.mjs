#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const adrPath = join(root, "docs/adr/ADR-016-acceptance-flow-e-signature.md");

const requiredFiles = [
  "supabase/migrations/370_quote_share_tokens.sql",
  "supabase/migrations/256_quote_package_viewed_at.sql",
  "supabase/migrations/087_quote_builder_v2.sql",
  "supabase/migrations/082_customer_portal.sql",
  "supabase/migrations/085_portal_rls_hardening.sql",
  "supabase/migrations/599_quote_pdf_r2_versions.sql",
  "supabase/functions/quote-builder-v2/index.ts",
  "supabase/functions/portal-api/index.ts",
  "supabase/functions/portal-stripe/index.ts",
  "supabase/functions/_shared/quote-document-hash.ts",
  "docs/quote-flow-audit.md",
  "docs/quote-flow-backend-plan.md",
];

const requiredPhrases = [
  "Status: Accepted",
  "Roadmap item: E1.16 / QEP-123",
  "share_token",
  "short-lived server-signed R2 GET URL",
  "quote_signatures",
  "portal_quote_reviews",
  "portal-stripe",
  "Stripe payment state mutates quote/deposit state only from verified webhook events",
  "Browser clients must not directly mutate signature, payment, quote-stage, or deposit-status fields.",
  "Internal Deal IQ, margin, commission, approval, and cost fields remain rep/manager-only",
  "Payment alone does not imply `accepted_signed`.",
  "Signature alone does not imply `deposit_paid`.",
  "VESign",
  "bun run adr:016:verify",
];

const failures = [];

if (!existsSync(adrPath)) {
  failures.push(`Missing ADR file: ${adrPath}`);
} else {
  const content = readFileSync(adrPath, "utf8");

  for (const phrase of requiredPhrases) {
    if (!content.includes(phrase)) {
      failures.push(`ADR missing required phrase: ${phrase}`);
    }
  }

  for (const relativePath of requiredFiles) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      failures.push(`Referenced implementation anchor does not exist: ${relativePath}`);
      continue;
    }
    if (!content.includes(relativePath)) {
      failures.push(`ADR does not cite implementation anchor: ${relativePath}`);
    }
  }
}

if (failures.length > 0) {
  console.error("ADR-016 acceptance-flow verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("ADR-016 acceptance-flow verification passed.");
console.log(`- ADR: ${adrPath}`);
console.log(`- Implementation anchors: ${requiredFiles.length}`);
console.log(`- Required decision phrases: ${requiredPhrases.length}`);
