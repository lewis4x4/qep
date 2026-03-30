import { assertEquals } from "jsr:@std/assert@1";
import {
  createOAuthStateRecord,
  createSignedOAuthStateCookie,
  readAndVerifyOAuthStateCookie,
  validateOAuthCallbackState,
} from "./oauth-state.ts";

Deno.test("validateOAuthCallbackState rejects mismatched callback state", async () => {
  const record = createOAuthStateRecord(
    "6d29e53f-780f-4f17-b5e6-f4d691a5b6fa",
    "session-binding-hash",
    1_700_000_000_000,
    600,
  );
  const secret = "unit-test-secret";
  const signedCookie = await createSignedOAuthStateCookie(record, secret);
  const cookieHeader = `hubspot_oauth_state=${signedCookie}`;
  const parsedRecord = await readAndVerifyOAuthStateCookie(
    cookieHeader,
    secret,
  );

  const result = validateOAuthCallbackState(
    "tampered-state",
    parsedRecord,
    1_700_000_100_000,
  );

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reasonCode, "state_mismatch");
  }
});
