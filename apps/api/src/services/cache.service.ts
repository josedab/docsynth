/**
 * Redis Cache Service
 *
 * Provides caching layer for frequently accessed data with TTL management.
 */

import { getRedisConnection } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';

const log = createLogger('cache-service');

// Cache key prefixes
export const CACHE_KEYS = {
  ANALYTICS_SUMMARY: 'cache:analytics:summary',
  ANALYTICS_VELOCITY: 'cache:analytics:velocity',
  ANALYTICS_GAPS: 'cache:analytics:gaps',
  HUB_NAVIGATION: 'cache:hub:navigation',
  HUB_REPOSITORIES: 'cache:hub:repositories',
  REPOSITORY_CONFIG: 'cache:repo:config',
  HEALTH_SCORE: 'cache:health:score',
  CONTRIBUTOR_PROFILE: 'cache:contributor:profile',
  BADGE_LIST: 'cache:badges:list',
  ONBOARDING_PATH: 'cache:onboarding:path',
  PLAYGROUND: 'cache:playground',
} as const;

// Default TTLs in seconds
export const CACHE_TTLS = {
  SHORT: 60,           // 1 minute
  MEDIUM: 300,         // 5 minutes
  LONG: 900,           // 15 minutes
  VERY_LONG: 3600,     // 1 hour
  DAILY: 86400,        // 24 hours
} as const;

interface CacheOptions {
  ttl?: number;        // TTL in seconds
  tags?: string[];     // Tags for cache invalidation
}

class CacheService {
  private getRedis() {
    return getRedisConnection();
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const redis = this.getRedis();
      const data = await redis.get(key);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as T;
    } catch (error) {
      log.error({ error, key }, 'Cache get error');
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    try {
      const redis = this.getRedis();
      const ttl = options.ttl ?? CACHE_TTLS.MEDIUM;
      const data = JSON.stringify(value);

      await redis.setex(key, ttl, data);

      // Store tags for cache invalidation
      if (options.tags && options.tags.length > 0) {
        const tagKey = `cache:tags:${key}`;
        await redis.sadd(tagKey, ...options.tags);
        await redis.expire(tagKey, ttl);

        // Add key to each tag's set
        for (const tag of options.tags) {
          await redis.sadd(`cache:tag:${tag}`, key);
        }
      }
    } catch (error) {
      log.error({ error, key }, 'Cache set error');
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      const redis = this.getRedis();
      await redis.del(key);
    } catch (error) {
      log.error({ error, key }, 'Cache delete error');
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const redis = this.getRedis();
      const keys = await redis.keys(pattern);

      if (keys.length > 0) {
        await redis.del(...keys);
      }

      return keys.length;
    } catch (error) {
      log.error({ error, pattern }, 'Cache delete pattern error');
      return 0;
    }
  }

  /**
   * Invalidate all cache entries with a specific tag
   */
  async invalidateByTag(tag: string): Promise<number> {
    try {
      const redis = this.getRedis();
      const keys = await redis.smembers(`cache:tag:${tag}`);

      if (keys.length > 0) {
        await redis.del(...keys);
        await redis.del(`cache:tag:${tag}`);
      }

      return keys.length;
    } catch (error) {
      log.error({ error, tag }, 'Cache invalidate by tag error');
      return 0;
    }
  }

  /**
   * Get or set a value (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const data = await fetcher();

    // Store in cache
    await this.set(key, data, options);

    return data;
  }

  /**
   * Increment a counter
   */
  async increment(key: string, amount: number = 1): Promise<number> {
    try {
      const redis = this.getRedis();
      return await redis.incrby(key, amount);
    } catch (error) {
      log.error({ error, key }, 'Cache increment error');
      return 0;
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const redis = this.getRedis();
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      log.error({ error, key }, 'Cache exists error');
      return false;
    }
  }

  /**
   * Get TTL for a key
   */
  async ttl(key: string): Promise<number> {
    try {
      const redis = this.getRedis();
      return await redis.ttl(key);
    } catch (error) {
      log.error({ error, key }, 'Cache TTL error');
      return -2;
    }
  }

  // ==========================================================================
  // Domain-specific cache helpers
  // ==========================================================================

  /**
   * Cache analytics summary for a repository
   */
  async cacheAnalyticsSummary(
    repositoryId: string,
    period: string,
    data: unknown
  ): Promise<void> {
    const key = `${CACHE_KEYS.ANALYTICS_SUMMARY}:${repositoryId}:${period}`;
    await this.set(key, data, {
      ttl: CACHE_TTLS.MEDIUM,
      tags: [`repo:${repositoryId}`, 'analytics'],
    });
  }

  /**
   * Get cached analytics summary
   */
  async getAnalyticsSummary<T>(repositoryId: string, period: string): Promise<T | null> {
    const key = `${CACHE_KEYS.ANALYTICS_SUMMARY}:${repositoryId}:${period}`;
    return this.get<T>(key);
  }

  /**
   * Cache hub navigation data
   */
  async cacheHubNavigation(hubId: string, data: unknown): Promise<void> {
    const key = `${CACHE_KEYS.HUB_NAVIGATION}:${hubId}`;
    await this.set(key, data, {
      ttl: CACHE_TTLS.LONG,
      tags: [`hub:${hubId}`, 'navigation'],
    });
  }

  /**
   * Get cached hub navigation
   */
  async getHubNavigation<T>(hubId: string): Promise<T | null> {
    const key = `${CACHE_KEYS.HUB_NAVIGATION}:${hubId}`;
    return this.get<T>(key);
  }

  /**
   * Cache health score for a repository
   */
  async cacheHealthScore(repositoryId: string, data: unknown): Promise<void> {
    const key = `${CACHE_KEYS.HEALTH_SCORE}:${repositoryId}`;
    await this.set(key, data, {
      ttl: CACHE_TTLS.MEDIUM,
      tags: [`repo:${repositoryId}`, 'health'],
    });
  }

  /**
   * Get cached health score
   */
  async getHealthScore<T>(repositoryId: string): Promise<T | null> {
    const key = `${CACHE_KEYS.HEALTH_SCORE}:${repositoryId}`;
    return this.get<T>(key);
  }

  /**
   * Cache contributor profile
   */
  async cacheContributorProfile(contributorId: string, data: unknown): Promise<void> {
    const key = `${CACHE_KEYS.CONTRIBUTOR_PROFILE}:${contributorId}`;
    await this.set(key, data, {
      ttl: CACHE_TTLS.MEDIUM,
      tags: [`contributor:${contributorId}`],
    });
  }

  /**
   * Get cached contributor profile
   */
  async getContributorProfile<T>(contributorId: string): Promise<T | null> {
    const key = `${CACHE_KEYS.CONTRIBUTOR_PROFILE}:${contributorId}`;
    return this.get<T>(key);
  }

  /**
   * Cache badge list
   */
  async cacheBadgeList(data: unknown): Promise<void> {
    const key = CACHE_KEYS.BADGE_LIST;
    await this.set(key, data, {
      ttl: CACHE_TTLS.VERY_LONG,
      tags: ['badges'],
    });
  }

  /**
   * Get cached badge list
   */
  async getBadgeList<T>(): Promise<T | null> {
    return this.get<T>(CACHE_KEYS.BADGE_LIST);
  }

  /**
   * Invalidate all caches for a repository
   */
  async invalidateRepositoryCache(repositoryId: string): Promise<void> {
    await this.invalidateByTag(`repo:${repositoryId}`);
  }

  /**
   * Invalidate all caches for a hub
   */
  async invalidateHubCache(hubId: string): Promise<void> {
    await this.invalidateByTag(`hub:${hubId}`);
  }
}

export const cacheService = new CacheService();
