import { pino } from 'pino';

// ============================================================================
// Logger
// ============================================================================

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        }
      : undefined,
});

export function createLogger(name: string) {
  return logger.child({ name });
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error class for application-specific errors.
 * Provides a consistent error format with code, status, and optional details.
 * 
 * @example
 * throw new AppError('Something went wrong', 'CUSTOM_ERROR', 500, { context: 'value' });
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Error for request validation failures (HTTP 400).
 * 
 * @example
 * throw new ValidationError('Invalid email format', { field: 'email' });
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Error for resource not found (HTTP 404).
 * 
 * @example
 * throw new NotFoundError('User', 'user-123');
 * // Message: "User with id 'user-123' not found"
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier ? `${resource} with id '${identifier}' not found` : `${resource} not found`,
      'NOT_FOUND',
      404
    );
    this.name = 'NotFoundError';
  }
}

/**
 * Error for authentication failures (HTTP 401).
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Error for authorization failures (HTTP 403).
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * Error for rate limit exceeded (HTTP 429).
 * 
 * @param retryAfter - Seconds to wait before retrying
 */
export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

/**
 * Error for external service failures (HTTP 502).
 * 
 * @param service - Name of the external service that failed
 * @param originalError - The underlying error from the service
 */
export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: Error) {
    super(`External service error: ${service}`, 'EXTERNAL_SERVICE_ERROR', 502, {
      service,
      originalError: originalError?.message,
    });
    this.name = 'ExternalServiceError';
  }
}

// ============================================================================
// Retry Utilities
// ============================================================================

/** Options for retry behavior */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Custom function to determine if retry should occur */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * Retry an async function with exponential backoff.
 * 
 * @example
 * const result = await withRetry(
 *   () => fetchData(),
 *   { maxAttempts: 5, baseDelayMs: 500 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = () => true,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Sleep for a specified duration.
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a timeout.
 * @throws AppError with code 'TIMEOUT' if operation exceeds timeout
 * 
 * @example
 * const result = await withTimeout(fetchData(), 5000, 'Fetch timed out');
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new AppError(errorMessage, 'TIMEOUT', 408));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Process items in batches with controlled concurrency.
 * 
 * @example
 * const results = await batchProcess(users, 10, async (batch) => {
 *   return Promise.all(batch.map(u => processUser(u)));
 * });
 */
export async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
  }

  return results;
}

// ============================================================================
// String Utilities
// ============================================================================

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - suffix.length) + suffix;
}

export function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char] ?? char);
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Match a filepath against a glob pattern.
 * Supports ** for matching across directories and * for single directory level.
 * 
 * @example
 * matchGlob('src/utils/index.ts', 'src/**\/*.ts') // true
 * matchGlob('src/index.ts', 'src/*.ts') // true
 * matchGlob('test/index.ts', 'src/*.ts') // false
 */
export function matchGlob(filepath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*');
  return new RegExp(`^${regex}$`).test(filepath);
}

// ============================================================================
// Object Utilities
// ============================================================================

/**
 * Pick specified keys from an object.
 * 
 * @example
 * const subset = pick(user, ['id', 'name']);
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit specified keys from an object.
 * 
 * @example
 * const withoutPassword = omit(user, ['password']);
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

/**
 * Type guard that narrows out null and undefined.
 */
export function isNonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

// ============================================================================
// Date Utilities
// ============================================================================

/**
 * Format a date in various formats.
 * 
 * @param date - Date to format
 * @param format - 'iso' (default), 'short', or 'relative'
 */
export function formatDate(date: Date, format: 'iso' | 'relative' | 'short' = 'iso'): string {
  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'short':
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    case 'relative':
      return formatRelativeTime(date);
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================================================
// Validation Helpers
// ============================================================================

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

export function ensure<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Value is null or undefined');
  }
  return value;
}

// ============================================================================
// ID Generation
// ============================================================================

export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  const id = `${timestamp}${randomPart}`;
  return prefix ? `${prefix}_${id}` : id;
}

// ============================================================================
// Rate Limiter
// ============================================================================

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();

    // Remove timestamps outside the window
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      // Calculate wait time until oldest request expires
      const oldestTimestamp = this.timestamps[0]!;
      const waitTime = this.windowMs - (now - oldestTimestamp);

      if (waitTime > 0) {
        await sleep(waitTime);
        return this.acquire(); // Retry after waiting
      }
    }

    this.timestamps.push(now);
  }

  canAcquire(): boolean {
    const now = Date.now();
    const validTimestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return validTimestamps.length < this.maxRequests;
  }

  reset(): void {
    this.timestamps = [];
  }
}

// ============================================================================
// Cache
// ============================================================================

export interface CacheOptions {
  ttlMs: number;
  maxSize?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttlMs: number;
  private maxSize: number;

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxSize = options.maxSize ?? 1000;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    // Clean expired entries and return count
    this.cleanup();
    return this.cache.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  // Get or compute value if not cached
  async getOrSet(key: string, compute: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }
}

// ============================================================================
// LLM Client (re-export)
// ============================================================================

export {
  initializeLLMClients,
  createLLMClient,
  getAnthropicClient,
  getOpenAIClient,
  isLLMAvailable,
  getDefaultProvider,
  parseLLMJsonResponse,
  parseLLMJsonResponseWithFallback,
  type LLMClient,
  type LLMConfig,
  type LLMGenerateOptions,
  type LLMGenerateResult,
} from './llm-client.js';
