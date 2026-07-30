import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { validNextStatuses } from "./order-status-machine";

const managerSource = readFileSync(
  new URL("../../../../../../supabase/functions/parts-order-manager/index.ts", import.meta.url),
  "utf8",
);

function backendTransitions(): Record<string, string[]> {
  const transitionBlock = managerSource.match(
    /const VALID_TRANSITIONS: Record<string, string\[\]> = \{([\s\S]*?)\n\};/,
  )?.[1];

  if (!transitionBlock) throw new Error("parts-order-manager VALID_TRANSITIONS contract not found");

  return Object.fromEntries(
    [...transitionBlock.matchAll(/^\s*(\w+): \[([^\]]*)\],?$/gm)].map(([, status, values]) => [
      status,
      values ? JSON.parse(`[${values}]`) as string[] : [],
    ]),
  );
}

describe("validNextStatuses", () => {
  it("keeps draft advancement aligned with parts-order-manager", () => {
    expect(validNextStatuses("draft")).toEqual(["cancelled"]);
    expect(backendTransitions().draft).toEqual(["cancelled"]);
    expect(managerSource).toContain('if (action === "submit_internal_order")');
    expect(managerSource).toContain(
      '"Draft orders must use submit_internal_order before status advancement"',
    );
  });

  it("matches every direct backend fulfillment transition after submission", () => {
    const backend = backendTransitions();

    for (const status of ["submitted", "confirmed", "processing", "shipped"] as const) {
      expect(validNextStatuses(status)).toEqual(backend[status]);
    }
  });
});
