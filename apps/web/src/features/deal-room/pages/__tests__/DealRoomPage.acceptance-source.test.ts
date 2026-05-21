import { describe, expect, test } from "bun:test";

const sourcePath = new URL("../DealRoomPage.tsx", import.meta.url);

describe("DealRoomPage public acceptance wiring", () => {
  test("reuses the shared portal signature pad instead of a bespoke canvas", async () => {
    const source = await Bun.file(sourcePath).text();

    expect(source).toContain("PortalSignaturePad");
    expect(source).toContain("PortalSignaturePadHandle");
    expect(source).not.toContain("function SignaturePad(");
  });

  test("gates customer acceptance before token-authorized deposit checkout", async () => {
    const source = await Bun.file(sourcePath).text();

    expect(source).toContain("acceptedTerms");
    expect(source).toContain("PUBLIC_ACCEPT_TERMS_VERSION");
    expect(source).toContain("termsAccepted: true");
    expect(source).toContain("secure checkout after signing");
    expect(source).toContain("acceptPublicQuote(token");
    expect(source).toContain("createPublicQuoteDepositCheckout(token)");
    expect(source).toContain("Pay deposit");
    expect(source).toContain("Deposit checkout opens after you accept the proposal");
    expect(source).toContain("Deposit received and pending verification");
    expect(source).toContain("Deposit checkout is paused");
    expect(source).not.toContain("Deposit/payment instructions will be coordinated by my QEP representative");
    expect(source).not.toContain("Your rep has been notified");
    expect(source).not.toContain("PayInvoiceButton");
    expect(source).not.toContain("portal-stripe");
  });
});
