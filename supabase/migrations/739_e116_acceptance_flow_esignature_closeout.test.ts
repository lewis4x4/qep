import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "739_e116_acceptance_flow_esignature_closeout.sql");
const adr = readText("docs", "adr", "ADR-016-acceptance-flow-e-signature.md");
const verifier = readText("scripts", "verify", "adr-016-acceptance-flow.mjs");
const a35Closeout = readText("supabase", "migrations", "704_a35_branded_acceptance_flow_closeout.sql");
const quoteBuilder = readText("supabase", "functions", "quote-builder-v2", "index.ts");
const portalApi = readText("supabase", "functions", "portal-api", "index.ts");
const portalStripe = readText("supabase", "functions", "portal-stripe", "index.ts");
const quoteHash = readText("supabase", "functions", "_shared", "quote-document-hash.ts");

const compactCloseout = compact(closeoutSql);
const compactAdr = compact(adr);
const compactVerifier = compact(verifier);
const compactA35Closeout = compact(a35Closeout);
const compactQuoteBuilder = compact(quoteBuilder);
const compactPortalApi = compact(portalApi);
const compactPortalStripe = compact(portalStripe);
const compactQuoteHash = compact(quoteHash);

describe("739_e116_acceptance_flow_esignature_closeout.sql contract", () => {
  it("marks only E1.16 shipped with mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'e1.16'");
    expect(compactCloseout).toContain("ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("customer acceptance architecture");
    expect(compactCloseout).not.toContain("where task_id = 'a3.5'");
    expect(compactCloseout).not.toContain("where task_id = 'c4.1'");
  });

  it("proves ADR-016 is accepted and has the required control language", () => {
    expect(compactAdr).toContain("status: accepted");
    expect(compactAdr).toContain("roadmap item: e1.16 / qep-123");
    expect(compactAdr).toContain("share_token");
    expect(compactAdr).toContain("short-lived server-signed r2 get url");
    expect(compactAdr).toContain("native qep e-signature is the default acceptance mechanism");
    expect(compactAdr).toContain("browser clients must not directly mutate signature, payment, quote-stage, or deposit-status fields");
    expect(compactAdr).toContain("internal deal iq, margin, commission, approval, and cost fields remain rep/manager-only");
    expect(compactAdr).toContain("payment alone does not imply `accepted_signed`");
    expect(compactAdr).toContain("signature alone does not imply `deposit_paid`");
  });

  it("proves the ADR verifier guards the expected implementation anchors", () => {
    for (const anchor of [
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
    ]) {
      expect(compactVerifier).toContain(anchor);
      expect(compactAdr).toContain(anchor);
      expect(compactCloseout).toContain(anchor);
    }
  });

  it("proves A3.5 shipped the branded implementation governed by ADR-016", () => {
    expect(compactA35Closeout).toContain("where task_id = 'a3.5'");
    expect(compactA35Closeout).toContain("adr-016 resolves the docusign-style provider ambiguity");
    expect(compactA35Closeout).toContain("branded /q/:share_token customer landing experience");
    expect(compactA35Closeout).toContain("handlepublicaccept");
    expect(compactA35Closeout).toContain("handlepublicdepositcheckout");
    expect(compactA35Closeout).toContain("stripe redirect is not treated as payment proof");
  });

  it("proves runtime anchors preserve server-side acceptance and payment controls", () => {
    expect(compactQuoteBuilder).toContain("handlepublicaccept");
    expect(compactQuoteBuilder).toContain("recordpublicacceptrepevidence");
    expect(compactQuoteBuilder).toContain("handlepublicdepositcheckout");
    expect(compactQuoteBuilder).toContain("share_token");
    expect(compactQuoteBuilder).toContain("document_hash");
    expect(compactQuoteBuilder).toContain("quote_signatures");
    expect(compactPortalApi).toContain("portal_quote_reviews");
    expect(compactPortalStripe).toContain("stripe-signature");
    expect(compactPortalStripe).toContain("payment_intent");
    expect(compactQuoteHash).toContain("sha-256");
  });

  it("keeps live provider and environment boundaries explicit", () => {
    expect(compactCloseout).toContain("live stripe secret and webhook configuration");
    expect(compactCloseout).toContain("r2 production bucket credentials");
    expect(compactCloseout).toContain("external vesign or docusign provider contract");
    expect(compactCloseout).toContain("business deposit sop and production uat signoff");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });
});
