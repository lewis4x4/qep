import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality for secret strings (e.g. cron Bearer tokens).
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
