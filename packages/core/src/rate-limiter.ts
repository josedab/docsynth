// ============================================================================
// Types
// ============================================================================

export interface RateLimiterConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  windowMs: number;
  burstAllowance: number; // extra tokens above maxTokens for bursts
}

export interface TokenBucket {
  tokens: number;
  lastRefillTime: number;
  maxTokens: number;
  burstMax: number;
  refillRate: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAtMs: number;
  retryAfterMs?: number;
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}

// ============================================================================
// Token Bucket
// ============================================================================

export function createBucket(config: RateLimiterConfig): TokenBucket {
  return {
    tokens: config.maxTokens,
    lastRefillTime: Date.now(),
    maxTokens: config.maxTokens,
    burstMax: config.maxTokens + config.burstAllowance,
    refillRate: config.refillRate,
  };
}

export function refillBucket(bucket: TokenBucket, nowMs: number = Date.now()): TokenBucket {
  const elapsed = (nowMs - bucket.lastRefillTime) / 1000;
  if (elapsed <= 0) return bucket;

  const newTokens = Math.min(bucket.burstMax, bucket.tokens + elapsed * bucket.refillRate);
  return { ...bucket, tokens: newTokens, lastRefillTime: nowMs };
}

export function consumeToken(
  bucket: TokenBucket,
  cost: number = 1
): { bucket: TokenBucket; allowed: boolean } {
  if (bucket.tokens >= cost) {
    return { bucket: { ...bucket, tokens: bucket.tokens - cost }, allowed: true };
  }
  return { bucket, allowed: false };
}

// ============================================================================
// Per-key rate limiter
// ============================================================================

export function createRateLimiter(defaultConfig: RateLimiterConfig) {
  const buckets = new Map<string, TokenBucket>();
  const configs = new Map<string, RateLimiterConfig>();

  function setKeyConfig(key: string, config: RateLimiterConfig): void {
    configs.set(key, config);
  }

  function getOrCreateBucket(key: string, nowMs: number): TokenBucket {
    let bucket = buckets.get(key);
    if (!bucket) {
      const cfg = configs.get(key) ?? defaultConfig;
      bucket = createBucket(cfg);
      bucket.lastRefillTime = nowMs;
      buckets.set(key, bucket);
    }
    return bucket;
  }

  function tryConsume(key: string, cost: number = 1, nowMs: number = Date.now()): RateLimitResult {
    let bucket = getOrCreateBucket(key, nowMs);
    bucket = refillBucket(bucket, nowMs);

    const { bucket: updated, allowed } = consumeToken(bucket, cost);
    buckets.set(key, updated);

    const cfg = configs.get(key) ?? defaultConfig;
    const resetMs = allowed
      ? nowMs + cfg.windowMs
      : nowMs + Math.ceil(((cost - updated.tokens) / updated.refillRate) * 1000);

    return {
      allowed,
      remaining: Math.max(0, Math.floor(updated.tokens)),
      limit: cfg.maxTokens,
      resetAtMs: resetMs,
      ...(allowed
        ? {}
        : { retryAfterMs: Math.ceil(((cost - updated.tokens) / updated.refillRate) * 1000) }),
    };
  }

  function getStatus(key: string, nowMs: number = Date.now()): RateLimitResult {
    let bucket = getOrCreateBucket(key, nowMs);
    bucket = refillBucket(bucket, nowMs);
    buckets.set(key, bucket);

    const cfg = configs.get(key) ?? defaultConfig;
    return {
      allowed: bucket.tokens >= 1,
      remaining: Math.max(0, Math.floor(bucket.tokens)),
      limit: cfg.maxTokens,
      resetAtMs: nowMs + cfg.windowMs,
    };
  }

  function reset(key: string): void {
    buckets.delete(key);
  }

  return { tryConsume, getStatus, setKeyConfig, reset };
}

// ============================================================================
// Header formatting
// ============================================================================

export function formatRateLimitHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAtMs / 1000)),
  };

  if (!result.allowed && result.retryAfterMs != null) {
    headers['Retry-After'] = String(Math.ceil(result.retryAfterMs / 1000));
  }

  return headers;
}
