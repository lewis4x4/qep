/**
 * Standalone test for the reveal/totp rate-limit logic in oem-portal-vault.
 *
 * We don't export the function from the edge module (it's internal), so we
 * re-implement the exact same predicate here and verify the behaviour.
 * Keeping the signature identical means we can copy-paste the implementation
 * back into the edge function if something diverges.
 */
function checkAndRecordHit(
  bucket: Map<string, number[]>,
  key: string,
  windowMs: number,
  limit: number,
  nowProvider: () => number = () => Date.now(),
): boolean {
  const now = nowProvider();
  const hits = (bucket.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    bucket.set(key, hits);
    return false;
  }
  hits.push(now);
  bucket.set(key, hits);
  return true;
}

Deno.test("rate limit allows up to N within window", () => {
  const bucket = new Map<string, number[]>();
  let now = 1_000_000;
  for (let i = 0; i < 5; i++) {
    if (!checkAndRecordHit(bucket, "cred-a", 60_000, 5, () => now)) {
      throw new Error(`hit ${i} was unexpectedly rate-limited`);
    }
    now += 1000;
  }
  if (checkAndRecordHit(bucket, "cred-a", 60_000, 5, () => now)) {
    throw new Error("6th hit within window should be rate-limited");
  }
});

Deno.test("rate limit expires old hits once window passes", () => {
  const bucket = new Map<string, number[]>();
  let now = 2_000_000;
  for (let i = 0; i < 5; i++) {
    checkAndRecordHit(bucket, "cred-b", 60_000, 5, () => now);
    now += 1000;
  }
  // At t = 2_005_000 we've used the quota. Jump past the window.
  now += 61_000;
  if (!checkAndRecordHit(bucket, "cred-b", 60_000, 5, () => now)) {
    throw new Error("new hit after window should be allowed");
  }
});

Deno.test("rate limit isolates keys", () => {
  const bucket = new Map<string, number[]>();
  const now = 3_000_000;
  for (let i = 0; i < 5; i++) {
    checkAndRecordHit(bucket, "cred-c", 60_000, 5, () => now);
  }
  // Other key is fresh.
  if (!checkAndRecordHit(bucket, "cred-d", 60_000, 5, () => now)) {
    throw new Error("different key should have its own bucket");
  }
});
