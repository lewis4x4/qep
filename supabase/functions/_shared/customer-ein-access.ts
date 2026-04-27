import type { UserRole } from "./dge-auth.ts";

export interface CustomerEinAccessCaller {
  isServiceRole: boolean;
  role: UserRole | null;
}

export function canAccessCustomerEin(caller: CustomerEinAccessCaller): boolean {
  return caller.isServiceRole ||
    caller.role === "admin" ||
    caller.role === "manager" ||
    caller.role === "owner";
}

export function maskCustomerEin(ein: string | null | undefined, canAccess: boolean): string | null {
  if (!ein) return null;
  if (canAccess) return ein;
  const digits = ein.replace(/\D/g, "");
  const lastFour = digits.length >= 4 ? digits.slice(-4) : "••••";
  return `••-•••${lastFour}`;
}

export function normalizeCustomerEin(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("VALIDATION_EIN_FORMAT");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{2}-\d{7}$/.test(trimmed)) throw new Error("VALIDATION_EIN_FORMAT");
  return trimmed;
}

export function hasCustomerEinPayload(payload: { ein?: unknown }): boolean {
  return Object.prototype.hasOwnProperty.call(payload, "ein");
}
