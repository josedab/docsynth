import Redis from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { createLogger } from '@docsynth/utils';

const log = createLogger('redis');

// ============================================================================
// Redis Connection
// ============================================================================

let redisConnection: Redis | null = null;

export function initializeRedis(url: string): Redis {
  if (redisConnection) {
    return redisConnection;
  }

  redisConnection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redisConnection.on('error', (error) => {
    log.error({ error }, 'Redis connection error');
  });

  redisConnection.on('connect', () => {
    log.info('Redis connected');
  });

  return redisConnection;
}

export function getRedisConnection(): Redis {
  if (!redisConnection) {
    throw new Error('Redis not initialized. Call initializeRedis first.');
  }
  return redisConnection;
}

export function getConnectionOptions(): ConnectionOptions {
  return getRedisConnection() as ConnectionOptions;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}

// ============================================================================
// Redis Session Store
// ============================================================================

export interface SessionStoreOptions {
  prefix?: string;
  defaultTtlSeconds?: number;
}

export class RedisSessionStore<T> {
  private prefix: string;
  private defaultTtlSeconds: number;

  constructor(options: SessionStoreOptions = {}) {
    this.prefix = options.prefix ?? 'session';
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 3600; // 1 hour default
  }

  private getKey(sessionId: string): string {
    return `${this.prefix}:${sessionId}`;
  }

  async get(sessionId: string): Promise<T | null> {
    const redis = getRedisConnection();
    const data = await redis.get(this.getKey(sessionId));
    
    if (!data) {
      return null;
    }
    
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async set(sessionId: string, data: T, ttlSeconds?: number): Promise<void> {
    const redis = getRedisConnection();
    const key = this.getKey(sessionId);
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    
    await redis.set(key, JSON.stringify(data), 'EX', ttl);
  }

  async delete(sessionId: string): Promise<boolean> {
    const redis = getRedisConnection();
    const result = await redis.del(this.getKey(sessionId));
    return result > 0;
  }

  async exists(sessionId: string): Promise<boolean> {
    const redis = getRedisConnection();
    const result = await redis.exists(this.getKey(sessionId));
    return result > 0;
  }

  async extend(sessionId: string, ttlSeconds?: number): Promise<boolean> {
    const redis = getRedisConnection();
    const key = this.getKey(sessionId);
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    
    const result = await redis.expire(key, ttl);
    return result === 1;
  }

  async getTtl(sessionId: string): Promise<number> {
    const redis = getRedisConnection();
    return await redis.ttl(this.getKey(sessionId));
  }

  async update(sessionId: string, updater: (data: T) => T, ttlSeconds?: number): Promise<T | null> {
    const current = await this.get(sessionId);
    if (!current) {
      return null;
    }
    
    const updated = updater(current);
    await this.set(sessionId, updated, ttlSeconds);
    return updated;
  }

  async listSessions(pattern?: string): Promise<string[]> {
    const redis = getRedisConnection();
    const searchPattern = pattern 
      ? `${this.prefix}:${pattern}` 
      : `${this.prefix}:*`;
    
    const keys = await redis.keys(searchPattern);
    return keys.map(key => key.replace(`${this.prefix}:`, ''));
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const redis = getRedisConnection();
    const searchPattern = `${this.prefix}:${pattern}`;
    const keys = await redis.keys(searchPattern);
    
    if (keys.length === 0) {
      return 0;
    }
    
    return await redis.del(...keys);
  }
}
