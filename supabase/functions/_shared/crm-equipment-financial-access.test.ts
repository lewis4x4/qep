import { assertEquals } from "jsr:@std/assert@1";
import {
  canAccessEquipmentFinancials,
  hasRestrictedEquipmentFinancialPayload,
} from "./crm-equipment-financial-access.ts";

Deno.test("canAccessEquipmentFinancials denies reps", () => {
  assertEquals(canAccessEquipmentFinancials({ isServiceRole: false, role: "rep" }), false);
});

Deno.test("canAccessEquipmentFinancials allows elevated roles and service callers", () => {
  assertEquals(canAccessEquipmentFinancials({ isServiceRole: false, role: "admin" }), true);
  assertEquals(canAccessEquipmentFinancials({ isServiceRole: false, role: "manager" }), true);
  assertEquals(canAccessEquipmentFinancials({ isServiceRole: false, role: "owner" }), true);
  assertEquals(canAccessEquipmentFinancials({ isServiceRole: true, role: null }), true);
});

Deno.test("hasRestrictedEquipmentFinancialPayload only flags restricted financial keys", () => {
  assertEquals(hasRestrictedEquipmentFinancialPayload({ purchasePrice: 10 }), true);
  assertEquals(hasRestrictedEquipmentFinancialPayload({ weeklyRentalRate: null }), true);
  assertEquals(hasRestrictedEquipmentFinancialPayload({}), false);
});
