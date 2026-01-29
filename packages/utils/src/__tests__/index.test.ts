import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ExternalServiceError,
  withRetry,
  sleep,
  withTimeout,
  batchProcess,
  slugify,
  truncate,
  escapeHtml,
  pick,
  omit,
  isNonNullable,
  formatDate,
  ensure,
  generateId,
  RateLimiter,
  Cache,
} from '../index.js';

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create error with code and status', () => {
      const error = new AppError('Test error', 'TEST_CODE', 500);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('AppError');
    });

    it('should support details', () => {
      const error = new AppError('Test', 'CODE', 400, { field: 'test' });
      expect(error.details).toEqual({ field: 'test' });
    });
  });

  describe('ValidationError', () => {
    it('should have 400 status code', () => {
      const error = new ValidationError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('NotFoundError', () => {
    it('should format message with resource and id', () => {
      const error = new NotFoundError('User', '123');
      expect(error.message).toBe("User with id '123' not found");
      expect(error.statusCode).toBe(404);
    });

    it('should format message without id', () => {
      const error = new NotFoundError('User');
      expect(error.message).toBe('User not found');
    });
  });

  describe('UnauthorizedError', () => {
    it('should have 401 status code', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Unauthorized');
    });
  });

  describe('ForbiddenError', () => {
    it('should have 403 status code', () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
    });
  });

  describe('RateLimitError', () => {
    it('should have 429 status code and retry info', () => {
      const error = new RateLimitError(60);
      expect(error.statusCode).toBe(429);
      expect(error.details?.retryAfter).toBe(60);
    });
  });

  describe('ExternalServiceError', () => {
    it('should include service name', () => {
      const error = new ExternalServiceError('GitHub');
      expect(error.statusCode).toBe(502);
      expect(error.details?.service).toBe('GitHub');
    });
  });
});

describe('Retry Utilities', () => {
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = async () => 'success';
      const result = await withRetry(fn);
      expect(result).toBe('success');
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) throw new Error('Fail');
        return 'success';
      };
      const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max attempts', async () => {
      const fn = async () => {
        throw new Error('Always fails');
      };
      await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 10 })).rejects.toThrow(
        'Always fails'
      );
    });
  });

  describe('sleep', () => {
    it('should delay execution', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe('withTimeout', () => {
    it('should resolve if within timeout', async () => {
      const result = await withTimeout(Promise.resolve('done'), 1000);
      expect(result).toBe('done');
    });

    it('should reject if exceeds timeout', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 100));
      await expect(withTimeout(slowPromise, 10)).rejects.toThrow('Operation timed out');
    });
  });

  describe('batchProcess', () => {
    it('should process items in batches', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = async (batch: number[]) => batch.map((n) => n * 2);
      const result = await batchProcess(items, 2, processor);
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });
  });
});

describe('String Utilities', () => {
  describe('slugify', () => {
    it('should convert to lowercase slug', () => {
      expect(slugify('Hello World')).toBe('hello-world');
      expect(slugify('Test  Multiple   Spaces')).toBe('test-multiple-spaces');
      expect(slugify('Special@#$Characters!')).toBe('specialcharacters');
    });
  });

  describe('truncate', () => {
    it('should truncate long text', () => {
      expect(truncate('Hello World', 8)).toBe('Hello...');
      expect(truncate('Short', 10)).toBe('Short');
    });

    it('should use custom suffix', () => {
      expect(truncate('Hello World', 8, '…')).toBe('Hello W…');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
      expect(escapeHtml("It's a test & demo")).toBe('It&#39;s a test &amp; demo');
    });
  });
});

describe('Object Utilities', () => {
  describe('pick', () => {
    it('should pick specified keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });
  });

  describe('omit', () => {
    it('should omit specified keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
    });
  });

  describe('isNonNullable', () => {
    it('should return true for non-null values', () => {
      expect(isNonNullable('test')).toBe(true);
      expect(isNonNullable(0)).toBe(true);
      expect(isNonNullable(false)).toBe(true);
    });

    it('should return false for null/undefined', () => {
      expect(isNonNullable(null)).toBe(false);
      expect(isNonNullable(undefined)).toBe(false);
    });
  });
});

describe('Date Utilities', () => {
  describe('formatDate', () => {
    it('should format as ISO', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(formatDate(date, 'iso')).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should format as short', () => {
      const date = new Date('2024-01-15');
      const result = formatDate(date, 'short');
      expect(result).toMatch(/Jan 15, 2024/);
    });
  });
});

describe('Validation Helpers', () => {
  describe('ensure', () => {
    it('should return value if not null', () => {
      expect(ensure('test')).toBe('test');
      expect(ensure(0)).toBe(0);
    });

    it('should throw if null or undefined', () => {
      expect(() => ensure(null)).toThrow();
      expect(() => ensure(undefined)).toThrow();
      expect(() => ensure(null, 'Custom message')).toThrow('Custom message');
    });
  });
});

describe('ID Generation', () => {
  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('should support prefix', () => {
      const id = generateId('usr');
      expect(id.startsWith('usr_')).toBe(true);
    });
  });
});

describe('RateLimiter', () => {
  describe('acquire', () => {
    it('should allow requests within limit', async () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });

      // Should not block for first 3 requests
      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();

      expect(limiter.canAcquire()).toBe(false);
    });

    it('should reset after window expires', async () => {
      const limiter = new RateLimiter({ maxRequests: 2, windowMs: 100 });

      await limiter.acquire();
      await limiter.acquire();
      expect(limiter.canAcquire()).toBe(false);

      // Wait for window to expire
      await sleep(150);
      expect(limiter.canAcquire()).toBe(true);
    });

    it('should report canAcquire correctly', () => {
      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });

      expect(limiter.canAcquire()).toBe(true);
    });

    it('should reset properly', async () => {
      const limiter = new RateLimiter({ maxRequests: 1, windowMs: 10000 });

      await limiter.acquire();
      expect(limiter.canAcquire()).toBe(false);

      limiter.reset();
      expect(limiter.canAcquire()).toBe(true);
    });
  });
});

describe('Cache', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new Cache<string>({ ttlMs: 1000 });

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      const cache = new Cache<string>({ ttlMs: 1000 });
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check existence with has', () => {
      const cache = new Cache<string>({ ttlMs: 1000 });

      expect(cache.has('key1')).toBe(false);
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    it('should delete entries', () => {
      const cache = new Cache<string>({ ttlMs: 1000 });

      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      cache.delete('key1');
      expect(cache.has('key1')).toBe(false);
    });

    it('should clear all entries', () => {
      const cache = new Cache<string>({ ttlMs: 1000 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const cache = new Cache<string>({ ttlMs: 100 });

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      await sleep(150);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should support custom TTL per entry', async () => {
      const cache = new Cache<string>({ ttlMs: 1000 });

      cache.set('short', 'value', 50);
      cache.set('long', 'value', 500);

      await sleep(100);

      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('value');
    });
  });

  describe('max size', () => {
    it('should evict oldest when at capacity', () => {
      const cache = new Cache<string>({ ttlMs: 10000, maxSize: 2 });

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3'); // Should evict key1

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      const cache = new Cache<string>({ ttlMs: 1000 });
      cache.set('key1', 'cached');

      let computeCalled = false;
      const result = await cache.getOrSet('key1', async () => {
        computeCalled = true;
        return 'computed';
      });

      expect(result).toBe('cached');
      expect(computeCalled).toBe(false);
    });

    it('should compute and cache if not exists', async () => {
      const cache = new Cache<string>({ ttlMs: 1000 });

      const result = await cache.getOrSet('key1', async () => 'computed');

      expect(result).toBe('computed');
      expect(cache.get('key1')).toBe('computed');
    });
  });

  describe('size', () => {
    it('should return correct size', () => {
      const cache = new Cache<string>({ ttlMs: 1000 });

      expect(cache.size()).toBe(0);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.size()).toBe(2);
    });

    it('should not count expired entries', async () => {
      const cache = new Cache<string>({ ttlMs: 50 });

      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);

      await sleep(100);
      expect(cache.size()).toBe(0);
    });
  });
});
