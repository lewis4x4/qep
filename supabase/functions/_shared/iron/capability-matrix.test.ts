import { assertEquals } from "jsr:@std/assert@1";
import {
  IRON_CAPABILITY_MATRIX,
  IRON_TOOLS_BY_SURFACE,
  type IronSurface,
} from "./capability-matrix.ts";

function findCapability(surface: IronSurface, question: string) {
  return IRON_CAPABILITY_MATRIX.find((item) =>
    item.surface === surface && item.question.toLowerCase() === question.toLowerCase()
  );
}

Deno.test("supported and partial capabilities reference existing tools on their declared surface", () => {
  for (const capability of IRON_CAPABILITY_MATRIX) {
    if (capability.status === "known_gap") continue;
    const catalog = new Set(IRON_TOOLS_BY_SURFACE[capability.surface]);
    assertEquals(
      catalog.has(capability.expected_tool),
      true,
      `${capability.status} capability ${capability.id} references missing tool ${capability.expected_tool} on ${capability.surface}`,
    );
  }
});

Deno.test("quote pending approval capability is present and supported on both surfaces", () => {
  const question = "Are there any quotes pending approval?";
  const qrm = findCapability("qrm_ask_iron", question);
  const global = findCapability("iron_global", question);
  assertEquals(Boolean(qrm), true);
  assertEquals(Boolean(global), true);
  assertEquals(qrm?.status, "supported");
  assertEquals(global?.status, "supported");
});

Deno.test("known gaps must include owner, risk, and next tool guidance", () => {
  for (const capability of IRON_CAPABILITY_MATRIX) {
    if (capability.status !== "known_gap") continue;
    assertEquals(Boolean(capability.owner && capability.owner.trim().length > 0), true, `${capability.id} missing owner`);
    assertEquals(Boolean(capability.risk), true, `${capability.id} missing risk`);
    assertEquals(
      Boolean(capability.next_tool_guidance && capability.next_tool_guidance.trim().length > 0),
      true,
      `${capability.id} missing next_tool_guidance`,
    );
  }
});

Deno.test("qrm equipment and rental search capabilities stay declared as supported", () => {
  const equipment = IRON_CAPABILITY_MATRIX.find((item) => item.id === "qrm-equipment-search");
  const rental = IRON_CAPABILITY_MATRIX.find((item) => item.id === "qrm-rental-search");
  assertEquals(equipment?.surface, "qrm_ask_iron");
  assertEquals(equipment?.expected_tool, "search_entities");
  assertEquals(equipment?.status, "supported");
  assertEquals(rental?.surface, "qrm_ask_iron");
  assertEquals(rental?.expected_tool, "search_entities");
  assertEquals(rental?.status, "supported");
});
