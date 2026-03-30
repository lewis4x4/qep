interface Bucket {
  count: number;
  windowStart: number;
}

interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const BUCKETS = new Map<string, Bucket>();

function getOrCreateBucket(key: string, now: number): Bucket {
  const current = BUCKETS.get(key);
  if (!current) {
    const fresh = { count: 0, windowStart: now };
    BUCKETS.set(key, fresh);
    return fresh;
  }
  return current;
}

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs?: number;
}): RateLimitCheckResult {
  const now = Date.now();
  const windowMs = params.windowMs ?? 60_000;
  const bucket = getOrCreateBucket(params.key, now);

  if (now - bucket.windowStart >= windowMs) {
    bucket.windowStart = now;
    bucket.count = 0;
  }

  if (bucket.count >= params.limit) {
    const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
