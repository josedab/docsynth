import { describe, it, expect } from 'vitest';
import {
  getTierConfig,
  calculateBilling,
  validatePartnerApiKey,
  checkRateLimit,
  generateOnboardingChecklist,
  TIER_CONFIGS,
} from '../partner-management.js';
import type { PartnerConfig } from '../partner-management.js';
import {
  computeMetrics,
  aggregateUsage,
  estimateCost,
  detectAnomalies,
  detectErrorSurge,
} from '../usage-metering.js';
import type { ApiCallRecord } from '../usage-metering.js';
import {
  createBucket,
  refillBucket,
  consumeToken,
  createRateLimiter,
  formatRateLimitHeaders,
} from '../rate-limiter.js';
import type { RateLimiterConfig } from '../rate-limiter.js';

// ============================================================================
// Partner Management
// ============================================================================

describe('partner-management', () => {
  describe('getTierConfig', () => {
    it('should return starter tier config', () => {
      const config = getTierConfig('starter');
      expect(config.name).toBe('starter');
      expect(config.basePriceMonthly).toBe(29);
    });

    it('should return enterprise tier with all features', () => {
      const config = getTierConfig('enterprise');
      expect(config.features).toContain('sso');
      expect(config.features).toContain('audit-log');
      expect(config.monthlyApiCalls).toBe(1_000_000);
    });
  });

  describe('calculateBilling', () => {
    it('should return base price when under limits', () => {
      const result = calculateBilling('starter', {
        apiCalls: 5000,
        docsGenerated: 50,
        storageUsedGb: 2,
      });
      expect(result.totalCost).toBe(29);
      expect(result.overages.apiCalls).toBe(0);
    });

    it('should calculate overage costs', () => {
      const result = calculateBilling('starter', {
        apiCalls: 12_000,
        docsGenerated: 150,
        storageUsedGb: 8,
      });
      expect(result.overages.apiCalls).toBe(2_000);
      expect(result.overages.docs).toBe(50);
      expect(result.overages.storageGb).toBe(3);
      expect(result.apiCallsCost).toBe(2_000 * TIER_CONFIGS.starter.pricePerApiCall);
      expect(result.totalCost).toBeGreaterThan(29);
    });

    it('should handle zero usage', () => {
      const result = calculateBilling('growth', {
        apiCalls: 0,
        docsGenerated: 0,
        storageUsedGb: 0,
      });
      expect(result.totalCost).toBe(199);
    });
  });

  describe('validatePartnerApiKey', () => {
    const partners: PartnerConfig[] = [
      {
        id: 'p1',
        name: 'Acme',
        contactEmail: 'a@acme.com',
        tier: 'growth',
        apiKey: 'abcdefghijklmnop',
        rateLimit: { requestsPerMinute: 60, requestsPerHour: 1000 },
        featuresEnabled: ['markdown-gen'],
        createdAt: '2024-01-01',
        active: true,
      },
      {
        id: 'p2',
        name: 'Inactive',
        contactEmail: 'b@b.com',
        tier: 'starter',
        apiKey: 'qrstuvwxyz123456',
        rateLimit: { requestsPerMinute: 30, requestsPerHour: 500 },
        featuresEnabled: [],
        createdAt: '2024-01-01',
        active: false,
      },
    ];

    it('should validate a valid API key', () => {
      const result = validatePartnerApiKey('abcdefghijklmnop', partners);
      expect(result.valid).toBe(true);
      expect(result.partnerId).toBe('p1');
      expect(result.tier).toBe('growth');
    });

    it('should reject short keys', () => {
      const result = validatePartnerApiKey('short', partners);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid key format');
    });

    it('should reject inactive partners', () => {
      const result = validatePartnerApiKey('qrstuvwxyz123456', partners);
      expect(result.valid).toBe(false);
    });
  });

  describe('checkRateLimit', () => {
    const partner: PartnerConfig = {
      id: 'p1',
      name: 'T',
      contactEmail: '',
      tier: 'starter',
      apiKey: 'abcdefghijklmnop',
      rateLimit: { requestsPerMinute: 10, requestsPerHour: 100 },
      featuresEnabled: [],
      createdAt: '2024-01-01',
      active: true,
    };

    it('should allow when under limits', () => {
      expect(checkRateLimit(partner, 5, 50).allowed).toBe(true);
    });

    it('should deny when minute limit exceeded', () => {
      const result = checkRateLimit(partner, 10, 50);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(60);
    });

    it('should deny when hour limit exceeded', () => {
      const result = checkRateLimit(partner, 5, 100);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBe(3600);
    });
  });

  describe('generateOnboardingChecklist', () => {
    it('should have base steps for starter', () => {
      const steps = generateOnboardingChecklist('starter');
      expect(steps.length).toBe(4);
      expect(steps.every((s) => !s.completed)).toBe(true);
    });

    it('should add SSO and branding for enterprise', () => {
      const steps = generateOnboardingChecklist('enterprise');
      expect(steps.find((s) => s.id === 'sso')).toBeDefined();
      expect(steps.find((s) => s.id === 'branding')).toBeDefined();
      expect(steps.length).toBe(6);
    });
  });
});

// ============================================================================
// Usage Metering
// ============================================================================

describe('usage-metering', () => {
  const records: ApiCallRecord[] = [
    { apiKey: 'k1', endpoint: '/generate', timestamp: 1000, latencyMs: 50, statusCode: 200 },
    { apiKey: 'k1', endpoint: '/generate', timestamp: 2000, latencyMs: 120, statusCode: 200 },
    { apiKey: 'k1', endpoint: '/validate', timestamp: 3000, latencyMs: 200, statusCode: 500 },
    { apiKey: 'k1', endpoint: '/generate', timestamp: 4000, latencyMs: 80, statusCode: 200 },
    { apiKey: 'k2', endpoint: '/generate', timestamp: 5000, latencyMs: 60, statusCode: 200 },
  ];

  describe('computeMetrics', () => {
    it('should compute metrics for a key', () => {
      const m = computeMetrics(records, 'k1');
      expect(m.totalCalls).toBe(4);
      expect(m.errorCount).toBe(1);
      expect(m.errorRate).toBe(0.25);
      expect(m.avgLatencyMs).toBeCloseTo(112.5, 1);
    });

    it('should return zeroes for unknown key', () => {
      const m = computeMetrics(records, 'unknown');
      expect(m.totalCalls).toBe(0);
      expect(m.errorRate).toBe(0);
    });
  });

  describe('aggregateUsage', () => {
    it('should break down by endpoint', () => {
      const summary = aggregateUsage(records, 'k1', 'daily', '2024-01-01', '2024-01-02');
      expect(summary.endpointBreakdown).toHaveLength(2);
      const gen = summary.endpointBreakdown.find((e) => e.endpoint === '/generate');
      expect(gen!.calls).toBe(3);
    });
  });

  describe('estimateCost', () => {
    it('should calculate cost', () => {
      const cost = estimateCost(1000, 0.001, 'monthly', 'k1');
      expect(cost.estimatedCost).toBe(1);
    });
  });

  describe('detectAnomalies', () => {
    it('should detect spike', () => {
      const result = detectAnomalies(500, 100);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('spike');
    });

    it('should detect drop', () => {
      const result = detectAnomalies(10, 100);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('drop');
    });

    it('should not flag normal usage', () => {
      const result = detectAnomalies(120, 100);
      expect(result.detected).toBe(false);
    });

    it('should handle zero baseline', () => {
      const result = detectAnomalies(100, 0);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectErrorSurge', () => {
    it('should detect surge from zero baseline', () => {
      const result = detectErrorSurge(0.15, 0);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('error-surge');
    });
  });
});

// ============================================================================
// Rate Limiter
// ============================================================================

describe('rate-limiter', () => {
  const cfg: RateLimiterConfig = {
    maxTokens: 10,
    refillRate: 1,
    windowMs: 60_000,
    burstAllowance: 5,
  };

  describe('createBucket / consumeToken', () => {
    it('should create a bucket with max tokens', () => {
      const bucket = createBucket(cfg);
      expect(bucket.tokens).toBe(10);
      expect(bucket.burstMax).toBe(15);
    });

    it('should consume tokens', () => {
      const bucket = createBucket(cfg);
      const { bucket: updated, allowed } = consumeToken(bucket);
      expect(allowed).toBe(true);
      expect(updated.tokens).toBe(9);
    });

    it('should deny when no tokens remain', () => {
      let bucket = createBucket(cfg);
      bucket = { ...bucket, tokens: 0 };
      const { allowed } = consumeToken(bucket);
      expect(allowed).toBe(false);
    });
  });

  describe('refillBucket', () => {
    it('should refill tokens over time', () => {
      let bucket = createBucket(cfg);
      bucket = { ...bucket, tokens: 5, lastRefillTime: 1000 };
      const refilled = refillBucket(bucket, 4000); // 3 seconds elapsed
      expect(refilled.tokens).toBe(8); // 5 + 3*1
    });

    it('should cap at burstMax', () => {
      let bucket = createBucket(cfg);
      bucket = { ...bucket, tokens: 14, lastRefillTime: 1000 };
      const refilled = refillBucket(bucket, 5000); // 4 seconds
      expect(refilled.tokens).toBe(15); // capped at burstMax
    });
  });

  describe('createRateLimiter', () => {
    it('should allow requests within limit', () => {
      const limiter = createRateLimiter(cfg);
      const now = Date.now();
      const result = limiter.tryConsume('key1', 1, now);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });

    it('should deny when exhausted', () => {
      const smallCfg: RateLimiterConfig = {
        maxTokens: 2,
        refillRate: 0.1,
        windowMs: 60_000,
        burstAllowance: 0,
      };
      const limiter = createRateLimiter(smallCfg);
      const now = Date.now();
      limiter.tryConsume('key1', 1, now);
      limiter.tryConsume('key1', 1, now);
      const result = limiter.tryConsume('key1', 1, now);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should support per-key config', () => {
      const limiter = createRateLimiter(cfg);
      limiter.setKeyConfig('vip', {
        maxTokens: 100,
        refillRate: 10,
        windowMs: 60_000,
        burstAllowance: 50,
      });
      const now = Date.now();
      const result = limiter.getStatus('vip', now);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(100);
    });

    it('should reset a key', () => {
      const limiter = createRateLimiter(cfg);
      const now = Date.now();
      limiter.tryConsume('key1', 5, now);
      limiter.reset('key1');
      const result = limiter.getStatus('key1', now);
      expect(result.remaining).toBe(10);
    });
  });

  describe('formatRateLimitHeaders', () => {
    it('should format allowed response headers', () => {
      const headers = formatRateLimitHeaders({
        allowed: true,
        remaining: 9,
        limit: 10,
        resetAtMs: 1700000000000,
      });
      expect(headers['X-RateLimit-Limit']).toBe('10');
      expect(headers['X-RateLimit-Remaining']).toBe('9');
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('should include Retry-After when denied', () => {
      const headers = formatRateLimitHeaders({
        allowed: false,
        remaining: 0,
        limit: 10,
        resetAtMs: 1700000000000,
        retryAfterMs: 5000,
      });
      expect(headers['Retry-After']).toBe('5');
    });
  });
});
