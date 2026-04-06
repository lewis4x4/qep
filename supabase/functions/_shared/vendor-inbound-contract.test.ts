import { assertEquals } from "jsr:@std/assert@1";
import { parseVendorInboundContract } from "./vendor-inbound-contract.ts";

Deno.test("parseVendorInboundContract — no contract keys yields null", () => {
  const { contract, error } = parseVendorInboundContract({ po_reference: "123" });
  assertEquals(error, null);
  assertEquals(contract, null);
});

Deno.test("parseVendorInboundContract — edi + line items", () => {
  const { contract, error } = parseVendorInboundContract({
    edi_control_number: " 856-CTRL ",
    line_items: [
      { part_number: "ABC-1", quantity_shipped: 3, unit_of_measure: "EA" },
    ],
  });
  assertEquals(error, null);
  assertEquals(contract?.edi_control_number, "856-CTRL");
  assertEquals(contract?.line_items?.length, 1);
  assertEquals(contract?.line_items?.[0].part_number, "ABC-1");
  assertEquals(contract?.line_items?.[0].quantity_shipped, 3);
});

Deno.test("parseVendorInboundContract — line_items must be array", () => {
  const { error } = parseVendorInboundContract(
    { line_items: "nope" } as Record<string, unknown>,
  );
  assertEquals(error != null, true);
});

Deno.test("parseVendorInboundContract — negative quantity fails", () => {
  const { error } = parseVendorInboundContract({
    line_items: [{ quantity_shipped: -0.01 }],
  });
  assertEquals(error != null, true);
});

Deno.test("parseVendorInboundContract — only whitespace structured fields fails", () => {
  const { contract, error } = parseVendorInboundContract({
    vendor_message_type: "   ",
  });
  assertEquals(contract, null);
  assertEquals(error != null, true);
});
