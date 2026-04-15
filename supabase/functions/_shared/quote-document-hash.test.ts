/**
 * Quote document hash — unit tests.
 *
 * Run with: deno test supabase/functions/_shared/quote-document-hash.test.ts
 */

import { assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalJsonStringify,
  computeQuoteDocumentHash,
} from "./quote-document-hash.ts";

const BASE_INPUT = {
  quote_package_id: "pkg-1",
  pdf_url: "https://s3.example.com/pkg-1.pdf",
  equipment: [
    { make: "CAT", model: "259D", price: 75000 },
    { make: "John Deere", model: "325G", price: 78500 },
  ],
  equipment_total: 153500,
  attachment_total: 4200,
  subtotal: 157700,
  trade_credit: 12000,
  net_total: 145700,
};

Deno.test("canonicalJsonStringify sorts keys deterministically", () => {
  const a = canonicalJsonStringify({ b: 1, a: 2 });
  const b = canonicalJsonStringify({ a: 2, b: 1 });
  assertEquals(a, b);
});

Deno.test("canonicalJsonStringify handles nested objects + arrays", () => {
  const input = { z: [3, 2, 1], a: { y: 1, x: 2 } };
  const out = canonicalJsonStringify(input);
  assertEquals(out, '{"a":{"x":2,"y":1},"z":[3,2,1]}');
});

Deno.test("hash is 64-char lowercase hex", async () => {
  const hash = await computeQuoteDocumentHash(BASE_INPUT);
  assertMatch(hash ?? "", /^[0-9a-f]{64}$/);
});

Deno.test("hash is deterministic for the same input", async () => {
  const a = await computeQuoteDocumentHash(BASE_INPUT);
  const b = await computeQuoteDocumentHash(BASE_INPUT);
  assertEquals(a, b);
});

Deno.test("hash changes when net_total changes", async () => {
  const a = await computeQuoteDocumentHash(BASE_INPUT);
  const b = await computeQuoteDocumentHash({ ...BASE_INPUT, net_total: 145701 });
  assertNotEquals(a, b);
});

Deno.test("hash changes when equipment order changes (order is semantic)", async () => {
  const reversed = [...(BASE_INPUT.equipment as Array<Record<string, unknown>>)].reverse();
  const a = await computeQuoteDocumentHash(BASE_INPUT);
  const b = await computeQuoteDocumentHash({ ...BASE_INPUT, equipment: reversed });
  assertNotEquals(a, b);
});

Deno.test("null pdf_url does not break hashing", async () => {
  const hash = await computeQuoteDocumentHash({ ...BASE_INPUT, pdf_url: null });
  assertMatch(hash ?? "", /^[0-9a-f]{64}$/);
});
