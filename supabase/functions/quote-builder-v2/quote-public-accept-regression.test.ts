import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("public accept route stays token-authorized before staff auth gate", () => {
  const publicAcceptIndex = source.indexOf('publicAction === "public-accept"');
  const authGateIndex = source.indexOf('const authHeader = req.headers.get("Authorization")?.trim();');

  assert(publicAcceptIndex > 0, "public-accept route should be registered");
  assert(authGateIndex > 0, "staff auth gate should be present");
  assert(publicAcceptIndex < authGateIndex, "public-accept must run before staff JWT auth gate");
});

Deno.test("public accept records existing quote signature and verifies accepted package status", () => {
  const handlerStart = source.indexOf("async function handlePublicAccept");
  const handlerEnd = source.indexOf("// Public social-proof", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assertStringIncludes(handler, "body.terms_accepted === true");
  assertStringIncludes(handler, "termsVersion !== PUBLIC_ACCEPT_TERMS_VERSION");
  assertStringIncludes(handler, "terms_accepted: true");
  assertStringIncludes(handler, "terms_version: termsVersion");
  assertStringIncludes(handler, '.from("quote_signatures")');
  assertStringIncludes(handler, "signed_via: \"deal_room\"");
  assertStringIncludes(handler, 'document_hash: documentHash');
  assertStringIncludes(handler, '.from("quote_packages")');
  assertStringIncludes(handler, '.in("status", PUBLIC_ACCEPT_READY_STATUSES)');
  assertStringIncludes(handler, '.select("id, status, accepted_at")');
  assertStringIncludes(handler, "if (!updatedQuote)");
  assertStringIncludes(handler, "racedQuote.status");
  assertStringIncludes(handler, 'status: verifiedPackageStatus');
  assertStringIncludes(handler, "Quote acceptance could not be completed. Please refresh and try again.");
  assertStringIncludes(handler, "QUOTE_PIPELINE_STAGE_TARGETS.salesOrderSigned");
  assertStringIncludes(handler, "resolveLatestSentQuoteRepUserId");
  assertStringIncludes(handler, "recordPublicAcceptRepEvidence");
  assertStringIncludes(source, "quote_public_accept_signed");
  assertStringIncludes(source, "const sentRepUserId = await resolveLatestSentQuoteRepUserId");
  assertStringIncludes(source, "const resolvedRepUserId = sentRepUserId");
  assertStringIncludes(source, '.from("qb_notifications")');
  assertStringIncludes(source, '.eq("metadata->>quote_package_id", input.quotePackageId)');
  assertStringIncludes(source, '.eq("metadata->>signature_id", input.signatureId)');
  assertStringIncludes(source, '.from("quote_delivery_events")');
  assertStringIncludes(source, '.eq("provider", "quote_public_accept")');
  assertStringIncludes(source, '.eq("subject", "public_accept_signed")');
  assertStringIncludes(source, "if (existingTimeline?.id) return;");
  assertStringIncludes(source, "created_by: input.repUserId");
});

Deno.test("public accept handles idempotent already-accepted retries before inserting another signature", () => {
  const handlerStart = source.indexOf("async function handlePublicAccept");
  const handlerEnd = source.indexOf("// Public social-proof", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const idempotentCheckIndex = handler.indexOf('["accepted", "converted_to_deal"].includes(String(quote.status))');
  const signatureInsertIndex = handler.indexOf('.from("quote_signatures")\n    .insert');

  assert(idempotentCheckIndex > 0, "already-accepted idempotency check should exist");
  assert(signatureInsertIndex > 0, "signature insert should exist");
  assert(idempotentCheckIndex < signatureInsertIndex, "idempotent retry should return before inserting a duplicate signature");
  const idempotentBlock = handler.slice(idempotentCheckIndex, signatureInsertIndex);
  assertStringIncludes(idempotentBlock, '.select("id, signed_at, document_hash")');
  assertStringIncludes(idempotentBlock, "sentRepUserId");
  assertStringIncludes(idempotentBlock, "recordPublicAcceptRepEvidence");
  assertStringIncludes(idempotentBlock, "documentHash: typeof latestSig?.document_hash === \"string\"");
  assertStringIncludes(idempotentBlock, "status: String(quote.status)");
});

Deno.test("public deposit checkout route stays token-authorized before staff auth gate", () => {
  const publicDepositIndex = source.indexOf('publicAction === "public-deposit-checkout"');
  const authGateIndex = source.indexOf('const authHeader = req.headers.get("Authorization")?.trim();');

  assert(publicDepositIndex > 0, "public-deposit-checkout route should be registered");
  assert(authGateIndex > 0, "staff auth gate should be present");
  assert(publicDepositIndex < authGateIndex, "public deposit checkout must run before staff JWT auth gate");
});

Deno.test("public deposit checkout reuses token gate, Stripe REST, fallback, and intent reconciliation metadata", () => {
  const handlerStart = source.indexOf("async function handlePublicDepositCheckout");
  const handlerEnd = source.indexOf("async function handlePublicAccept", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assertStringIncludes(handler, '.eq("share_token", token)');
  assertStringIncludes(handler, '["accepted", "converted_to_deal"].includes(status)');
  assertStringIncludes(handler, "assertPublicQuoteReadReady");
  assertStringIncludes(handler, '.from("crm_deals")');
  assertStringIncludes(source, '.from("deposits")');
  assertStringIncludes(source, '.rpc("calculate_deposit_tier"');
  assertStringIncludes(source, "COLLECTIBLE_DEPOSIT_STATUSES");
  assertStringIncludes(source, "PAID_DEPOSIT_STATUSES");
  assertStringIncludes(source, "Deposit has already been received and is pending verification.");
  assertStringIncludes(source, "Deposit status does not allow checkout.");
  assertStringIncludes(handler, "STRIPE_SECRET_KEY");
  assertStringIncludes(handler, 'fetch(`${STRIPE_API_BASE}/checkout/sessions`');
  assertStringIncludes(handler, "buildQuoteDepositMailtoFallback");
  assertStringIncludes(handler, '.from("portal_payment_intents").insert');
  assertStringIncludes(handler, 'payment_kind: "quote_deposit"');
  assertStringIncludes(handler, "checkout_session_id");
  assertStringIncludes(handler, "share_token");
});
