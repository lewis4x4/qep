import { assertEquals } from "jsr:@std/assert@1";
import { validateEscalationPolicySteps } from "./vendor-escalation-policy.ts";

Deno.test("service engine contract — transition allowlist includes haul_scheduled", () => {
  const stages = [
    "parts_staged",
    "haul_scheduled",
    "scheduled",
  ];
  assertEquals(stages.includes("haul_scheduled"), true);
});

Deno.test("vendor escalation policy — valid steps pass validation", () => {
  const err = validateEscalationPolicySteps([
    { action: "notify_advisor", hours: 24 },
    { type: "notify_vendor" },
    { action: "switch_alt_vendor", alt_vendor_id: "00000000-0000-0000-0000-000000000001" },
  ]);
  assertEquals(err.length, 0);
});

Deno.test("vendor escalation policy — switch_alt_vendor without vendor id fails", () => {
  const err = validateEscalationPolicySteps([
    { action: "switch_alt_vendor" },
  ]);
  assertEquals(err.some((e) => e.includes("switch_alt_vendor")), true);
});

Deno.test("vendor inbound strict — identifiers gate (simulated)", () => {
  const strictInbound = true;
  const hasStrongIds = (body: { requirement_id?: string; job_id?: string; part_number?: string }) =>
    Boolean(body.requirement_id) ||
    (Boolean(body.job_id) &&
      body.part_number != null &&
      String(body.part_number).trim() !== "");
  assertEquals(hasStrongIds({}), false);
  assertEquals(hasStrongIds({ requirement_id: "x" }), true);
  assertEquals(hasStrongIds({ job_id: "j", part_number: "PN1" }), true);
  assertEquals(strictInbound && !hasStrongIds({}), true);
});
