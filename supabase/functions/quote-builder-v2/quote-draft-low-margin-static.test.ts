import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("A5.8 manual low-margin Save Draft gets additive draft status", () => {
  assertStringIncludes(source, "const CUSTOMER_BLOCKED_QUOTE_STATUSES = new Set");
  assertStringIncludes(source, "\"draft_low_margin\"");
  assertStringIncludes(source, "function resolveDraftStatusAfterSave");
  assertStringIncludes(source, "input.saveMode === \"manual\"");
  assertStringIncludes(source, "? \"draft_low_margin\"");
  assertStringIncludes(source, "const saveMode = body.save_mode === \"autosave\" ? \"autosave\" : \"manual\"");
  assertStringIncludes(source, "const draftStatusForCurrentSave = resolveDraftStatusAfterSave");
});

Deno.test("A5.8 low-margin draft remains blocked from customer-facing paths", () => {
  const blockedUsages = Array.from(source.matchAll(/CUSTOMER_BLOCKED_QUOTE_STATUSES\.has\(/g));
  assert(blockedUsages.length >= 3);
  assertStringIncludes(source, "Cannot begin customer PDF upload while quote status is");
  assertStringIncludes(source, "This quote cannot be sent while status is");
  assertStringIncludes(source, "This quote cannot be shared while status is");
});
