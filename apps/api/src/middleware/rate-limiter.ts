import { Context, Next } from 'hono';
import { getRedisConnection } from '@docsynth/queue';
import { RateLimitError, createLogger } from '@docsynth/utils';

const log = createLogger('rate-limiter');

export interface RateLimitConfig {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Max requests per window
  keyPrefix?: string;      // Redis key prefix
  message?: string;        // Custom error message
  skipFailedRequests?: boolean; // Don't count failed requests
}

// Default configurations for different endpoint types
export const RATE_LIMIT_CONFIGS = {
  // AI-powered endpoints - more restrictive
  ai: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 10,       // 10 requests per minute
    keyPrefix: 'rl:ai',
    message: 'AI rate limit exceeded. Please wait before making more requests.',
  },
  
  // Translation - moderate
  translation: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 20,       // 20 translations per minute
    keyPrefix: 'rl:translation',
    message: 'Translation rate limit exceeded. Please wait before making more requests.',
  },
  
  // Chat - per session
  chat: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 15,       // 15 messages per minute
    keyPrefix: 'rl:chat',
    message: 'Chat rate limit exceeded. Please slow down.',
  },
  
  // Diagram generation - expensive
  diagram: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 5,        // 5 diagrams per minute
    keyPrefix: 'rl:diagram',
    message: 'Diagram generation rate limit exceeded. Please wait before generating more.',
  },
  
  // Knowledge graph - expensive
  knowledgeGraph: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 10,       // 10 requests per minute
    keyPrefix: 'rl:kg',
    message: 'Knowledge graph rate limit exceeded.',
  },

  // Default - for general API endpoints
  default: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 100,      // 100 requests per minute
    keyPrefix: 'rl:default',
    message: 'Rate limit exceeded.',
  },
} as const;

export type RateLimitType = keyof typeof RATE_LIMIT_CONFIGS;

interface RateLimitInfo {
  remaining: number;
  reset: number;
  total: number;
}

async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitInfo> {
  const redis = getRedisConnection();
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Use sorted set for sliding window
  const multi = redis.multi();
  
  // Remove expired entries
  multi.zremrangebyscore(key, 0, windowStart);
  
  // Count current entries
  multi.zcard(key);
  
  // Add current request
  multi.zadd(key, now, `${now}:${Math.random()}`);
  
  // Set expiry on the key
  multi.pexpire(key, config.windowMs);
  
  const results = await multi.exec();
  
  const currentCount = (results?.[1]?.[1] as number) || 0;
  const remaining = Math.max(0, config.maxRequests - currentCount - 1);
  const reset = Math.ceil((windowStart + config.windowMs) / 1000);

  return {
    remaining,
    reset,
    total: config.maxRequests,
  };
}

function getClientKey(c: Context, prefix: string): string {
  // Priority: userId > organizationId > IP
  const userId = c.get('userId') as string | undefined;
  const orgId = c.get('organizationId') as string | undefined;
  
  if (userId) {
    return `${prefix}:user:${userId}`;
  }
  
  if (orgId) {
    return `${prefix}:org:${orgId}`;
  }
  
  // Fallback to IP
  const forwarded = c.req.header('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 
    c.req.header('x-real-ip') || 
    'unknown';
  
  return `${prefix}:ip:${ip}`;
}

/**
 * Create a rate limiter middleware
 */
export function rateLimit(configOrType: RateLimitConfig | RateLimitType = 'default') {
  const config: RateLimitConfig = typeof configOrType === 'string'
    ? RATE_LIMIT_CONFIGS[configOrType]
    : { ...RATE_LIMIT_CONFIGS.default, ...configOrType };

  return async (c: Context, next: Next) => {
    const key = getClientKey(c, config.keyPrefix ?? 'rl');
    
    try {
      const info = await checkRateLimit(key, config);
      
      // Set rate limit headers
      c.header('X-RateLimit-Limit', config.maxRequests.toString());
      c.header('X-RateLimit-Remaining', info.remaining.toString());
      c.header('X-RateLimit-Reset', info.reset.toString());
      
      if (info.remaining < 0) {
        const retryAfter = Math.ceil((info.reset * 1000 - Date.now()) / 1000);
        c.header('Retry-After', retryAfter.toString());
        
        log.warn({ 
          key, 
          limit: config.maxRequests,
          retryAfter,
        }, 'Rate limit exceeded');
        
        throw new RateLimitError(retryAfter);
      }
      
      await next();
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw error;
      }
      
      // If Redis fails, log and allow the request (fail open)
      log.error({ error }, 'Rate limiter error - allowing request');
      await next();
    }
  };
}

/**
 * Create a rate limiter with custom per-resource key
 * Useful for rate limiting specific resources like sessions
 */
export function rateLimitByResource(
  resourceExtractor: (c: Context) => string,
  configOrType: RateLimitConfig | RateLimitType = 'default'
) {
  const config: RateLimitConfig = typeof configOrType === 'string'
    ? RATE_LIMIT_CONFIGS[configOrType]
    : { ...RATE_LIMIT_CONFIGS.default, ...configOrType };

  return async (c: Context, next: Next) => {
    const resource = resourceExtractor(c);
    const clientKey = getClientKey(c, config.keyPrefix ?? 'rl');
    const key = `${clientKey}:${resource}`;
    
    try {
      const info = await checkRateLimit(key, config);
      
      c.header('X-RateLimit-Limit', config.maxRequests.toString());
      c.header('X-RateLimit-Remaining', info.remaining.toString());
      c.header('X-RateLimit-Reset', info.reset.toString());
      
      if (info.remaining < 0) {
        const retryAfter = Math.ceil((info.reset * 1000 - Date.now()) / 1000);
        c.header('Retry-After', retryAfter.toString());
        
        throw new RateLimitError(retryAfter);
      }
      
      await next();
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw error;
      }
      
      log.error({ error }, 'Rate limiter error - allowing request');
      await next();
    }
  };
}

/**
 * Burst-tolerant rate limiter using token bucket algorithm
 */
export function tokenBucketRateLimit(options: {
  bucketSize: number;     // Max tokens (burst capacity)
  refillRate: number;     // Tokens per second
  keyPrefix?: string;
}) {
  const { bucketSize, refillRate, keyPrefix = 'rl:bucket' } = options;

  return async (c: Context, next: Next) => {
    const redis = getRedisConnection();
    const clientKey = getClientKey(c, keyPrefix);
    const now = Date.now();

    try {
      // Get current bucket state
      const [tokensStr, lastRefillStr] = await redis.hmget(clientKey, 'tokens', 'lastRefill');
      
      let tokens = tokensStr ? parseFloat(tokensStr) : bucketSize;
      const lastRefill = lastRefillStr ? parseInt(lastRefillStr, 10) : now;
      
      // Calculate tokens to add based on time elapsed
      const elapsed = (now - lastRefill) / 1000;
      tokens = Math.min(bucketSize, tokens + elapsed * refillRate);
      
      if (tokens < 1) {
        // Calculate when a token will be available
        const waitTime = Math.ceil((1 - tokens) / refillRate);
        c.header('Retry-After', waitTime.toString());
        
        throw new RateLimitError(waitTime);
      }
      
      // Consume a token
      tokens -= 1;
      
      // Update bucket state
      await redis.hset(clientKey, { tokens: tokens.toString(), lastRefill: now.toString() });
      await redis.pexpire(clientKey, Math.ceil(bucketSize / refillRate) * 1000);
      
      c.header('X-RateLimit-Remaining', Math.floor(tokens).toString());
      
      await next();
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw error;
      }
      
      log.error({ error }, 'Token bucket rate limiter error - allowing request');
      await next();
    }
  };
}
