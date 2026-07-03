import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "743_c41_native_signing_extension_closeout.sql");
const nativeSignatureSql = readText("supabase", "migrations", "607_native_invoice_rental_signatures.sql");
const portalApi = readText("supabase", "functions", "portal-api", "index.ts");
const signatureCard = readText(
  "apps",
  "web",
  "src",
  "features",
  "portal",
  "components",
  "PortalNativeSignatureCard.tsx",
);
const invoiceDetailPage = readText(
  "apps",
  "web",
  "src",
  "features",
  "portal",
  "pages",
  "PortalInvoiceDetailPage.tsx",
);
const invoicesPage = readText("apps", "web", "src", "features", "portal", "pages", "PortalInvoicesPage.tsx");
const rentalsPage = readText("apps", "web", "src", "features", "portal", "pages", "PortalRentalsPage.tsx");
const signingReadiness = readText("apps", "web", "src", "features", "portal", "lib", "signing-readiness.ts");
const signingReadinessTest = readText("apps", "web", "src", "features", "portal", "lib", "signing-readiness.test.ts");
const historicalGate = JSON.parse(
  readText("test-results", "agent-gates", "20260521T002558Z-C4.1-native-invoice-rental-esign.json"),
) as { segment: string; verdict: string };

const compactCloseout = compact(closeoutSql);
const compactNativeSignatureSql = compact(nativeSignatureSql);
const compactPortalApi = compact(portalApi);
const compactSignatureCard = compact(signatureCard);
const compactInvoiceDetailPage = compact(invoiceDetailPage);
const compactInvoicesPage = compact(invoicesPage);
const compactRentalsPage = compact(rentalsPage);
const compactSigningReadiness = compact(signingReadiness);
const compactSigningReadinessTest = compact(signingReadinessTest);

describe("743_c41_native_signing_extension_closeout.sql contract", () => {
  it("marks only C4.1 shipped with native-signing mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'c4.1'");
    expect(compactCloseout).toContain("ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("invoice and rental customers can sign critical qep documents inside the portal");
    expect(compactCloseout).toContain("native qep signatures are distinct from external vesign provider-envelope status");
    expect(compactCloseout).not.toContain("where task_id = 'd2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'c4.2'");
  });

  it("keeps provider, legal, live webhook, and UAT boundaries explicit", () => {
    expect(compactCloseout).toContain("no vitaledge/vesign contract");
    expect(compactCloseout).toContain("no legal/accounting policy decision");
    expect(compactCloseout).toContain("no live provider envelope");
    expect(compactCloseout).toContain("no real customer uat signature session");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("proves the database records native invoice and rental signature evidence separately from VESign", () => {
    expect(compactNativeSignatureSql).toContain("create table if not exists public.customer_invoice_signatures");
    expect(compactNativeSignatureSql).toContain("create table if not exists public.rental_contract_signatures");
    expect(compactNativeSignatureSql).toContain("signed_snapshot jsonb not null");
    expect(compactNativeSignatureSql).toContain("document_hash text not null");
    expect(compactNativeSignatureSql).toContain("signature_image_url text not null");
    expect(compactNativeSignatureSql).toContain("add column if not exists native_signature_id uuid references public.customer_invoice_signatures");
    expect(compactNativeSignatureSql).toContain("add column if not exists native_signature_id uuid references public.rental_contract_signatures");
    expect(compactNativeSignatureSql).toContain("idx_customer_invoice_signatures_one_valid");
    expect(compactNativeSignatureSql).toContain("idx_rental_contract_signatures_one_valid");
    expect(compactNativeSignatureSql).toContain("enable row level security");
    expect(compactNativeSignatureSql).toContain("does not imply external vesign envelope status");
  });

  it("proves portal-api signs invoices with ownership, PNG validation, hash, and idempotency guards", () => {
    expect(compactPortalApi).toContain("function validatenativesignaturebase64");
    expect(compactPortalApi).toContain("raw.length < 500");
    expect(compactPortalApi).toContain("raw.length > 400_000");
    expect(compactPortalApi).toContain("signature must be base64 png");
    expect(compactPortalApi).toContain("async function canonicalizeandhash");
    expect(compactPortalApi).toContain("function nativesignatureview");
    expect(compactPortalApi).toContain("req.method === \"post\" && subroute === \"sign\"");
    expect(compactPortalApi).toContain(".from(\"customer_invoices\")");
    expect(compactPortalApi).toContain("invoicecustomerid !== portalcustomer.id");
    expect(compactPortalApi).toContain("voided invoices cannot be signed");
    expect(compactPortalApi).toContain(".from(\"customer_invoice_signatures\")");
    expect(compactPortalApi).toContain(".eq(\"is_valid\", true)");
    expect(compactPortalApi).toContain("signed_snapshot: signedsnapshot");
    expect(compactPortalApi).toContain("document_hash: documenthash");
    expect(compactPortalApi).toContain("native_signature_id: inserted.id");
    expect(compactPortalApi).toContain("esign_envelope_id: `native:${inserted.id}`");
    expect(compactPortalApi).toContain("native signature captured");
  });

  it("proves portal-api signs rental terms with readiness and idempotency guards", () => {
    expect(compactPortalApi).toContain("subroute === \"sign\" && req.method === \"post\"");
    expect(compactPortalApi).toContain(".from(\"rental_contracts\")");
    expect(compactPortalApi).toContain(".eq(\"portal_customer_id\", portalcustomer.id)");
    expect(compactPortalApi).toContain("rental unit must be assigned before signing terms");
    expect(compactPortalApi).toContain("rental terms are not ready for signature");
    expect(compactPortalApi).toContain(".from(\"rental_contract_signatures\")");
    expect(compactPortalApi).toContain(".eq(\"rental_contract_id\", rentalcontractid)");
    expect(compactPortalApi).toContain("documenthash = await canonicalizeandhash");
    expect(compactPortalApi).toContain("native_signed_at: inserted.signed_at");
    expect(compactPortalApi).toContain("native_signer_name: signername");
  });

  it("proves portal UI exposes native capture and status for invoices and rentals", () => {
    expect(compactSignatureCard).toContain("native signature");
    expect(compactSignatureCard).toContain("signaturedataurltorawbase64");
    expect(compactSignatureCard).toContain("sign in qep portal");
    expect(compactSignatureCard).toContain("documenthash.slice(0, 16)");
    expect(compactInvoiceDetailPage).toContain("portalapi.signinvoice");
    expect(compactInvoiceDetailPage).toContain("no vesign envelope is required");
    expect(compactInvoiceDetailPage).toContain("voided invoices cannot be signed in the portal");
    expect(compactInvoicesPage).toContain("signed in qep portal");
    expect(compactInvoicesPage).toContain("open invoice detail to capture a native qep signature");
    expect(compactRentalsPage).toContain("portalapi.signrentalcontract");
    expect(compactRentalsPage).toContain("a rental unit must be assigned before terms can be signed");
    expect(compactRentalsPage).toContain("native portal signature for legacy active contracts");
  });

  it("proves readiness labels keep VESign false until external provider evidence exists", () => {
    expect(compactSigningReadiness).toContain("native qep invoice signing");
    expect(compactSigningReadiness).toContain("native qep rental signing");
    expect(compactSigningReadiness).toContain("vesignready: false");
    expect(compactSigningReadiness).toContain("vitaledge/vesign contract and sandbox credentials");
    expect(compactSigningReadinessTest).toContain("labels native invoice signatures as qep portal evidence");
    expect(compactSigningReadinessTest).toContain("labels native rental signatures as qep portal evidence");
    expect(compactSigningReadinessTest).toContain("keeps exact external requirements explicit");
  });

  it("references the historical C4.1 gate report as passing evidence", () => {
    expect(historicalGate.segment).toBe("C4.1-native-invoice-rental-esign");
    expect(historicalGate.verdict).toBe("PASS");
    expect(compactCloseout).toContain("20260521t002558z-c4.1-native-invoice-rental-esign.json");
  });
});
