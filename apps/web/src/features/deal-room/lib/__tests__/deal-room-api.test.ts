import { afterEach, describe, expect, mock, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("deal-room public acceptance API", () => {
  test("posts customer signature acceptance through the token-authorized public route", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({
        signature_id: "sig-1",
        signed_at: "2026-05-20T21:00:00.000Z",
        status: "accepted",
        document_hash: "abc123",
      }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const { PUBLIC_ACCEPT_TERMS_VERSION, acceptPublicQuote } = await import("../deal-room-api");
    const result = await acceptPublicQuote("share token/with space?", {
      signerName: "Taylor Buyer",
      signerEmail: "taylor@example.com",
      signatureDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      termsAccepted: true,
      termsVersion: PUBLIC_ACCEPT_TERMS_VERSION,
      customerConfiguration: {
        scenario_key: "finance-60",
        cash_down: 5000,
      },
    });

    expect(result.status).toBe("accepted");
    expect(calls).toHaveLength(1);
    const requestUrl = new URL(String(calls[0].input));
    expect(requestUrl.pathname).toBe("/functions/v1/quote-builder-v2/public-accept");
    expect(requestUrl.searchParams.get("token")).toBe("share token/with space?");
    expect(calls[0].init?.method).toBe("POST");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.apikey).toBeTruthy();
    expect(headers.Authorization).toBe(`Bearer ${headers.apikey}`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      signer_name: "Taylor Buyer",
      signer_email: "taylor@example.com",
      signature_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      terms_accepted: true,
      terms_version: "a3.5-payment-handoff-v1",
      customer_configuration: {
        scenario_key: "finance-60",
        cash_down: 5000,
      },
    });
  });

  test("surfaces public acceptance errors without requiring customer auth", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "Signature is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const { PUBLIC_ACCEPT_TERMS_VERSION, acceptPublicQuote } = await import("../deal-room-api");
    await expect(acceptPublicQuote("valid-share-token-123", {
      signerName: "Taylor Buyer",
      signatureDataUrl: "",
      termsAccepted: true,
      termsVersion: PUBLIC_ACCEPT_TERMS_VERSION,
      customerConfiguration: { scenario_key: "finance-60" },
    })).rejects.toThrow("Signature is required.");
  });
});
