// deno-lint-ignore-file no-import-prefix
import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const publisher = await Deno.readTextFile(
  new URL("../publish-price-sheet/index.ts", import.meta.url),
);

function functionBody(name: string): string {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `Expected ${name} in oem-price-feeds/index.ts`);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

Deno.test("existing-event replay is scoped by workspace before idempotent return", () => {
  const body = functionBody("maybeReturnExistingEvent");
  assertStringIncludes(body, '.eq("workspace_id", workspaceId)');
  assertStringIncludes(body, '.eq("price_sheet_id", priceSheetId)');
  assert(
    body.indexOf('.eq("workspace_id", workspaceId)') <
      body.indexOf('.eq("price_sheet_id", priceSheetId)'),
  );
});

Deno.test("publish pins lane lineage and delegates catalog mutation to one SQL RPC", () => {
  const body = functionBody("handlePublish");
  assertStringIncludes(body, "await pinResolvedLineage");
  assertStringIncludes(body, "await invokePublish");
  assertStringIncludes(publisher, '.rpc("publish_qb_price_sheet_atomic"');
  assert(!publisher.includes('.from("qb_equipment_models").insert'));
  assert(!publisher.includes('.from("qb_price_sheets").update'));
});

Deno.test("full scans use the workspace epoch while rep impacts expose draft state", () => {
  assertStringIncludes(source, '.from("qb_workspace_pricing_epochs")');
  const body = functionBody("handleRepImpacts");
  assertStringIncludes(source, "qb_quote_reprice_drafts(");
  assertStringIncludes(source, "approval_case_id");
  assertStringIncludes(source, "reversed_at");
  assertStringIncludes(body, '"qb_price_change_events.status"');
  assertStringIncludes(body, '"active"');
});

Deno.test("rep reads authorize current CRM assignment before loading history", () => {
  const listBody = functionBody("handleRepImpacts");
  assert(!listBody.includes('.eq("assigned_rep_id", ctx.userId)'));
  const assignmentCheck = listBody.indexOf("loadCurrentQuoteAssignees(");
  const enrichment = listBody.indexOf(
    "loadEnrichedImpacts(ctx, authorizedIds)",
  );
  assert(assignmentCheck >= 0 && enrichment > assignmentCheck);

  const actionBody = functionBody("loadImpactForAction");
  const scopeRead = actionBody.indexOf(
    '.select("id, quote_package_id, qb_price_change_events!inner(status)")',
  );
  const actionAssignment = actionBody.indexOf("loadCurrentQuoteAssignees(");
  const historyRead = actionBody.indexOf("IMPACT_ENRICHMENT_SELECT");
  assert(scopeRead >= 0);
  assert(actionAssignment > scopeRead);
  assert(historyRead > actionAssignment);
});
