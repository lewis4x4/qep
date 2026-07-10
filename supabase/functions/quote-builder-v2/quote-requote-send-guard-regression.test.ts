import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const sendFenceMigration = await Deno.readTextFile(
  new URL(
    "../../migrations/818_quote_send_oem_authorization_fence.sql",
    import.meta.url,
  ),
);

Deno.test("pending OEM impacts block every customer share and send path", () => {
  assertStringIncludes(source, "function assertQuoteRequoteResolved(");
  assertStringIncludes(source, "quote.requires_requote === true");
  assertStringIncludes(
    source,
    "Resolve or dismiss the pending OEM price impact before sharing or sending this quote.",
  );

  const shareGateIndex = source.indexOf(
    "async function assertQuoteCustomerShareable(",
  );
  const shareRequoteIndex = source.indexOf(
    "assertQuoteRequoteResolved(input.quote)",
    shareGateIndex,
  );
  const sendPackageIndex = source.indexOf('if (action === "send-package")');
  const sendRequoteIndex = source.indexOf(
    "assertQuoteRequoteResolved(pkg as Record<string, unknown>)",
    sendPackageIndex,
  );

  assert(shareGateIndex > -1, "shared share-token gate must exist");
  assert(
    shareRequoteIndex > shareGateIndex,
    "share and ensure-share-token must enforce the OEM gate",
  );
  assert(sendPackageIndex > -1, "send-package branch must exist");
  assert(
    sendRequoteIndex > sendPackageIndex,
    "send-package must enforce the OEM gate",
  );
});

Deno.test("external email is fenced by a durable OEM-aware authorization", () => {
  const sendPackageIndex = source.indexOf('if (action === "send-package")');
  const authorizeIndex = source.indexOf(
    'admin.rpc("begin_quote_send_authorization"',
    sendPackageIndex,
  );
  const emailIndex = source.indexOf("sendResendEmail({", authorizeIndex);
  const commitIndex = source.indexOf(
    'admin.rpc("quote_send_package_commit"',
    emailIndex,
  );
  assert(authorizeIndex > sendPackageIndex);
  assert(emailIndex > authorizeIndex);
  assert(commitIndex > emailIndex);
  assertStringIncludes(
    source.slice(emailIndex, emailIndex + 300),
    "timeoutMs: 120_000",
  );
  assertStringIncludes(
    source.slice(commitIndex, commitIndex + 900),
    "p_send_authorization_id: sendAuthorizationId",
  );
  assertStringIncludes(
    sendFenceMigration,
    "QUOTE_SEND_IN_PROGRESS: retry OEM publication after customer send completes",
  );
  assertStringIncludes(
    sendFenceMigration,
    "quote.requires_requote is not true",
  );
});

Deno.test("customer-facing quote loads include requires_requote", () => {
  const customerFacingSelects = Array.from(
    source.matchAll(/\.select\("[^"]*requires_requote[^"]*"\)/g),
  );
  assertEquals(customerFacingSelects.length >= 3, true);

  for (const action of ["ensure-share-token", "share", "send-package"]) {
    const actionIndex = source.indexOf(`if (action === "${action}")`);
    const nextActionIndex = source.indexOf("if (action ===", actionIndex + 1);
    const actionBlock = source.slice(
      actionIndex,
      nextActionIndex === -1 ? source.length : nextActionIndex,
    );
    assertStringIncludes(actionBlock, "requires_requote");
  }
});

Deno.test("share-token issuance rechecks requote state under the quote row lock", () => {
  for (const action of ["ensure-share-token", "share", "send-package"]) {
    const actionIndex = source.indexOf(`if (action === "${action}")`);
    const nextActionIndex = source.indexOf("if (action ===", actionIndex + 1);
    const actionBlock = source.slice(
      actionIndex,
      nextActionIndex === -1 ? source.length : nextActionIndex,
    );
    assertStringIncludes(
      actionBlock,
      '"issue_quote_share_token_if_requote_resolved"',
    );
  }
  assertStringIncludes(
    sendFenceMigration,
    "from public.quote_packages quote",
  );
  assertStringIncludes(sendFenceMigration, "for update");
  assertStringIncludes(sendFenceMigration, "v_quote.requires_requote");
});
