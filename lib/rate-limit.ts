type RateLimitInput = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

function pruneBuckets(now: number) {
  for (const [bucketKey, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(bucketKey);
    }
  }

  if (buckets.size <= MAX_BUCKETS) return;

  const ordered = [...buckets.entries()].sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt);
  const removeCount = buckets.size - MAX_BUCKETS;
  for (let index = 0; index < removeCount; index += 1) {
    buckets.delete(ordered[index][0]);
  }
}

export function getRequestIdentifier(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
}

export function checkRateLimit({
  scope,
  key,
  limit,
  windowMs
}: RateLimitInput): RateLimitResult {
  const now = Date.now();
  pruneBuckets(now);

  const bucketKey = `${scope}:${key}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, {
      count: 1,
      resetAt: now + windowMs,
      lastSeenAt: now
    });
    return {
      limited: false,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000)
    };
  }

  current.lastSeenAt = now;
  if (current.count >= limit) {
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  current.count += 1;
  return {
    limited: false,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}
