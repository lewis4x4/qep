import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildRequiredVoiceGate,
  isVoiceGateSatisfied,
  markHumanEdited,
  mergeVoiceGate,
  readVoiceGate,
} from "./voice-compliance.ts";

Deno.test("pending generated drafts with a required voice gate are blocked", () => {
  const context = mergeVoiceGate({}, buildRequiredVoiceGate("draft-email", new Date("2026-05-20T00:00:00Z")));

  assertEquals(isVoiceGateSatisfied(context, "pending"), false);
});

Deno.test("edited generated drafts satisfy the voice gate", () => {
  const context = mergeVoiceGate({}, buildRequiredVoiceGate("draft-email", new Date("2026-05-20T00:00:00Z")));

  assertEquals(isVoiceGateSatisfied(context, "edited"), true);
});

Deno.test("email-voice passed gates satisfy the voice gate", () => {
  const context = mergeVoiceGate({}, {
    ...buildRequiredVoiceGate("draft-email", new Date("2026-05-20T00:00:00Z")),
    status: "email_voice_passed",
    pass_type: "email_voice",
    passed_at: "2026-05-20T00:01:00Z",
    passed_by: "email-voice",
  });

  assertEquals(isVoiceGateSatisfied(context, "pending"), true);
});

Deno.test("old drafts without a voice gate remain sendable", () => {
  assertEquals(isVoiceGateSatisfied({ legacy: true }, "pending"), true);
});

Deno.test("markHumanEdited updates an existing required gate", () => {
  const context = mergeVoiceGate({ source: "test" }, buildRequiredVoiceGate("draft-email", new Date("2026-05-20T00:00:00Z")));
  const marked = markHumanEdited(context, "user-1", new Date("2026-05-20T00:02:00Z"));
  const gate = readVoiceGate(marked);

  assertEquals(marked.source, "test");
  assertEquals(gate?.status, "human_edited");
  assertEquals(gate?.pass_type, "human_edit");
  assertEquals(gate?.passed_by, "user-1");
  assertEquals(isVoiceGateSatisfied(marked, "pending"), true);
});
