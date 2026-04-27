import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  canAccessCustomerEin,
  hasCustomerEinPayload,
  maskCustomerEin,
  normalizeCustomerEin,
} from "./customer-ein-access.ts";

Deno.test("canAccessCustomerEin denies reps and allows elevated roles", () => {
  assertEquals(canAccessCustomerEin({ isServiceRole: false, role: "rep" }), false);
  assertEquals(canAccessCustomerEin({ isServiceRole: false, role: "admin" }), true);
  assertEquals(canAccessCustomerEin({ isServiceRole: false, role: "manager" }), true);
  assertEquals(canAccessCustomerEin({ isServiceRole: false, role: "owner" }), true);
  assertEquals(canAccessCustomerEin({ isServiceRole: true, role: null }), true);
});

Deno.test("maskCustomerEin preserves only last four for unauthorized roles", () => {
  assertEquals(maskCustomerEin("12-3456789", false), "••-•••6789");
  assertEquals(maskCustomerEin("12-3456789", true), "12-3456789");
  assertEquals(maskCustomerEin(null, false), null);
});

Deno.test("normalizeCustomerEin enforces NN-NNNNNNN format", () => {
  assertEquals(normalizeCustomerEin(" 12-3456789 "), "12-3456789");
  assertEquals(normalizeCustomerEin(""), null);
  assertThrows(() => normalizeCustomerEin("123456789"), Error, "VALIDATION_EIN_FORMAT");
  assertThrows(() => normalizeCustomerEin(123), Error, "VALIDATION_EIN_FORMAT");
});

Deno.test("hasCustomerEinPayload distinguishes omitted EIN from explicit clear", () => {
  assertEquals(hasCustomerEinPayload({}), false);
  assertEquals(hasCustomerEinPayload({ ein: null }), true);
});
