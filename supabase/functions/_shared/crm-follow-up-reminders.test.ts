import { assertEquals } from "jsr:@std/assert@1";
import { shouldSkipHubSpotSequenceTaskForNativeFollowUp } from "./crm-follow-up-reminders.ts";
import { suggestedFollowUpHintLine } from "./crm-follow-up-suggestions.ts";

Deno.test("shouldSkipHubSpotSequenceTaskForNativeFollowUp is false when no native follow-up", () => {
  assertEquals(shouldSkipHubSpotSequenceTaskForNativeFollowUp(null, 1_700_000_000_000), false);
  assertEquals(shouldSkipHubSpotSequenceTaskForNativeFollowUp(undefined, 1_700_000_000_000), false);
});

Deno.test("shouldSkipHubSpotSequenceTaskForNativeFollowUp is true inside 48h window", () => {
  const ref = 1_700_000_000_000;
  const near = new Date(ref + 12 * 60 * 60 * 1000).toISOString();
  assertEquals(shouldSkipHubSpotSequenceTaskForNativeFollowUp(near, ref), true);
});

Deno.test("shouldSkipHubSpotSequenceTaskForNativeFollowUp is false outside 48h window", () => {
  const ref = 1_700_000_000_000;
  const far = new Date(ref + 72 * 60 * 60 * 1000).toISOString();
  assertEquals(shouldSkipHubSpotSequenceTaskForNativeFollowUp(far, ref), false);
});

Deno.test("suggestedFollowUpHintLine returns null when follow-up not overdue", () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assertEquals(suggestedFollowUpHintLine(future), null);
});

Deno.test("suggestedFollowUpHintLine returns hint when overdue", () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const line = suggestedFollowUpHintLine(past);
  assertEquals(typeof line, "string");
  assertEquals(line!.includes("follow-up"), true);
});
