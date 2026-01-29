/**
 * LLM Client Factory - Centralized LLM client management
 * Provides a unified interface for Anthropic and OpenAI clients
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { pino } from 'pino';

// Create a standalone logger to avoid circular import with index.ts
const log = pino({ name: 'llm-client', level: process.env.LOG_LEVEL ?? 'info' });

// ============================================================================
// Types
// ============================================================================

export interface LLMConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  defaultProvider?: 'anthropic' | 'openai';
}

export interface LLMGenerateOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface LLMGenerateResult {
  content: string;
  tokensUsed: number;
  model: string;
  provider: 'anthropic' | 'openai' | 'fallback';
}

export interface LLMClient {
  generate(prompt: string, options?: LLMGenerateOptions): Promise<LLMGenerateResult>;
  isAvailable(): boolean;
  getProvider(): 'anthropic' | 'openai' | 'none';
}

// ============================================================================
// Default Models
// ============================================================================

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_OPENAI_MODEL = 'gpt-4-turbo-preview';
const DEFAULT_MAX_TOKENS = 4096;

// ============================================================================
// Singleton Clients
// ============================================================================

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let initialized = false;
let defaultProvider: 'anthropic' | 'openai' | null = null;

/**
 * Initialize LLM clients with API keys
 * Should be called once at application startup
 */
export function initializeLLMClients(config?: LLMConfig): void {
  const anthropicKey = config?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  const openaiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    anthropicClient = new Anthropic({ apiKey: anthropicKey });
    log.info('Anthropic client initialized');
  }

  if (openaiKey) {
    openaiClient = new OpenAI({ apiKey: openaiKey });
    log.info('OpenAI client initialized');
  }

  // Set default provider
  if (config?.defaultProvider) {
    defaultProvider = config.defaultProvider;
  } else if (anthropicClient) {
    defaultProvider = 'anthropic';
  } else if (openaiClient) {
    defaultProvider = 'openai';
  }

  initialized = true;

  if (!anthropicClient && !openaiClient) {
    log.warn('No LLM clients initialized - API keys not provided');
  }
}

/**
 * Get the raw Anthropic client (for advanced usage)
 */
export function getAnthropicClient(): Anthropic | null {
  if (!initialized) {
    initializeLLMClients();
  }
  return anthropicClient;
}

/**
 * Get the raw OpenAI client (for advanced usage)
 */
export function getOpenAIClient(): OpenAI | null {
  if (!initialized) {
    initializeLLMClients();
  }
  return openaiClient;
}

/**
 * Check if any LLM client is available
 */
export function isLLMAvailable(): boolean {
  if (!initialized) {
    initializeLLMClients();
  }
  return anthropicClient !== null || openaiClient !== null;
}

/**
 * Get the current default provider
 */
export function getDefaultProvider(): 'anthropic' | 'openai' | 'none' {
  if (!initialized) {
    initializeLLMClients();
  }
  return defaultProvider ?? 'none';
}

// ============================================================================
// Unified LLM Client
// ============================================================================

class UnifiedLLMClient implements LLMClient {
  private preferredProvider: 'anthropic' | 'openai' | null;

  constructor(preferredProvider?: 'anthropic' | 'openai') {
    if (!initialized) {
      initializeLLMClients();
    }
    this.preferredProvider = preferredProvider ?? defaultProvider;
  }

  isAvailable(): boolean {
    return isLLMAvailable();
  }

  getProvider(): 'anthropic' | 'openai' | 'none' {
    if (this.preferredProvider === 'anthropic' && anthropicClient) return 'anthropic';
    if (this.preferredProvider === 'openai' && openaiClient) return 'openai';
    if (anthropicClient) return 'anthropic';
    if (openaiClient) return 'openai';
    return 'none';
  }

  async generate(prompt: string, options?: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    
    // Try preferred provider first
    if (this.preferredProvider === 'anthropic' && anthropicClient) {
      const result = await this.generateWithAnthropic(prompt, maxTokens, options?.model);
      if (result) return result;
    }

    if (this.preferredProvider === 'openai' && openaiClient) {
      const result = await this.generateWithOpenAI(prompt, maxTokens, options?.model);
      if (result) return result;
    }

    // Fallback to any available provider
    if (anthropicClient) {
      const result = await this.generateWithAnthropic(prompt, maxTokens, options?.model);
      if (result) return result;
    }

    if (openaiClient) {
      const result = await this.generateWithOpenAI(prompt, maxTokens, options?.model);
      if (result) return result;
    }

    // No LLM available - return fallback
    log.warn('No LLM available, returning empty result');
    return {
      content: '',
      tokensUsed: 0,
      model: 'none',
      provider: 'fallback',
    };
  }

  private async generateWithAnthropic(
    prompt: string,
    maxTokens: number,
    model?: string
  ): Promise<LLMGenerateResult | null> {
    if (!anthropicClient) return null;

    try {
      const response = await anthropicClient.messages.create({
        model: model ?? DEFAULT_ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

      return {
        content,
        tokensUsed,
        model: model ?? DEFAULT_ANTHROPIC_MODEL,
        provider: 'anthropic',
      };
    } catch (error) {
      log.warn({ error }, 'Anthropic generation failed');
      return null;
    }
  }

  private async generateWithOpenAI(
    prompt: string,
    maxTokens: number,
    model?: string
  ): Promise<LLMGenerateResult | null> {
    if (!openaiClient) return null;

    try {
      const response = await openaiClient.chat.completions.create({
        model: model ?? DEFAULT_OPENAI_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.choices[0]?.message?.content ?? '';
      const tokensUsed = response.usage?.total_tokens ?? 0;

      return {
        content,
        tokensUsed,
        model: model ?? DEFAULT_OPENAI_MODEL,
        provider: 'openai',
      };
    } catch (error) {
      log.warn({ error }, 'OpenAI generation failed');
      return null;
    }
  }
}

/**
 * Create a unified LLM client
 * @param preferredProvider - Optional preferred provider to use
 */
export function createLLMClient(preferredProvider?: 'anthropic' | 'openai'): LLMClient {
  return new UnifiedLLMClient(preferredProvider);
}

// ============================================================================
// JSON Response Parsing
// ============================================================================

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
export function parseLLMJsonResponse<T>(response: string): T | null {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }

    // Try to find raw JSON object
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }

    // Try parsing the entire response
    return JSON.parse(response) as T;
  } catch {
    log.warn('Failed to parse JSON from LLM response');
    return null;
  }
}

/**
 * Parse JSON with a fallback value
 */
export function parseLLMJsonResponseWithFallback<T>(response: string, fallback: T): T {
  const parsed = parseLLMJsonResponse<T>(response);
  return parsed ?? fallback;
}

// ============================================================================
// Type Guards for LLM Responses
// ============================================================================

/**
 * Check if a value is a non-null object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check if a value is a string
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Check if a value is a string array
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Type guard for inference result from LLM
 */
export interface InferenceResultShape {
  businessPurpose: string;
  technicalApproach: string;
  alternativesConsidered: string[];
  targetAudience: string;
  keyConcepts: string[];
}

export function isInferenceResult(value: unknown): value is InferenceResultShape {
  if (!isObject(value)) return false;
  
  return (
    isString(value.businessPurpose) &&
    isString(value.technicalApproach) &&
    isStringArray(value.alternativesConsidered) &&
    isString(value.targetAudience) &&
    isStringArray(value.keyConcepts)
  );
}

/**
 * Type guard for document generation result
 */
export interface DocumentGenerationShape {
  content: string;
  title?: string;
  summary?: string;
  sections?: Array<{ heading: string; content: string }>;
}

export function isDocumentGenerationResult(value: unknown): value is DocumentGenerationShape {
  if (!isObject(value)) return false;
  
  if (!isString(value.content)) return false;
  if (value.title !== undefined && !isString(value.title)) return false;
  if (value.summary !== undefined && !isString(value.summary)) return false;
  
  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections)) return false;
    for (const section of value.sections) {
      if (!isObject(section) || !isString(section.heading) || !isString(section.content)) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Type guard for code analysis result
 */
export interface CodeAnalysisShape {
  purpose: string;
  complexity: 'low' | 'medium' | 'high';
  dependencies: string[];
  exports: string[];
  suggestions?: string[];
}

export function isCodeAnalysisResult(value: unknown): value is CodeAnalysisShape {
  if (!isObject(value)) return false;
  
  return (
    isString(value.purpose) &&
    (value.complexity === 'low' || value.complexity === 'medium' || value.complexity === 'high') &&
    isStringArray(value.dependencies) &&
    isStringArray(value.exports) &&
    (value.suggestions === undefined || isStringArray(value.suggestions))
  );
}

/**
 * Safely parse and validate LLM JSON response with type guard
 */
export function safeParseLLMResponse<T>(
  response: string,
  typeGuard: (value: unknown) => value is T,
  fallback: T
): T {
  const parsed = parseLLMJsonResponse<unknown>(response);
  
  if (parsed !== null && typeGuard(parsed)) {
    return parsed;
  }
  
  log.warn('LLM response failed type guard validation');
  return fallback;
}
