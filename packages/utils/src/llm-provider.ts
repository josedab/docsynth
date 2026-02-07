/**
 * LLM Provider Abstraction Layer
 *
 * Supports multiple LLM backends for self-hosted and air-gapped deployments:
 * - Anthropic Claude (cloud)
 * - OpenAI GPT (cloud)
 * - Ollama (self-hosted, air-gapped)
 * - Azure OpenAI (enterprise cloud)
 * - AWS Bedrock (enterprise cloud)
 * - vLLM (self-hosted, air-gapped)
 */

// ============================================================================
// Provider Interface
// ============================================================================

export interface LLMProvider {
  name: string;
  generateText(params: LLMGenerateParams): Promise<LLMGenerateResult>;
  generateEmbedding?(text: string): Promise<number[]>;
  isAvailable(): Promise<boolean>;
}

export interface LLMGenerateParams {
  model?: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
}

export interface LLMGenerateResult {
  content: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCost: number;
}

// ============================================================================
// Provider Configurations
// ============================================================================

export interface ProviderConfig {
  type: 'anthropic' | 'openai' | 'ollama' | 'azure-openai' | 'aws-bedrock' | 'vllm';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  endpoint?: string;
  region?: string;
  deploymentName?: string;
}

// ============================================================================
// Cost Models (per 1M tokens)
// ============================================================================

const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Self-hosted models have zero API cost (infrastructure cost is separate)
  'ollama': { input: 0, output: 0 },
  'vllm': { input: 0, output: 0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = COST_PER_MILLION[model] ?? COST_PER_MILLION['gpt-4o-mini']!;
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

// ============================================================================
// Ollama Provider (Self-Hosted)
// ============================================================================

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model = 'llama3.1:70b') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const startTime = Date.now();
    const model = params.model ?? this.model;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: params.userPrompt,
        system: params.systemPrompt,
        stream: false,
        options: {
          temperature: params.temperature ?? 0.7,
          num_predict: params.maxTokens ?? 4096,
        },
        ...(params.responseFormat === 'json' ? { format: 'json' } : {}),
      }),
    });

    const data = (await response.json()) as {
      response: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };
    const latencyMs = Date.now() - startTime;

    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;

    return {
      content: data.response,
      model,
      provider: 'ollama',
      inputTokens,
      outputTokens,
      latencyMs,
      estimatedCost: 0, // Self-hosted = no API cost
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// vLLM Provider (Self-Hosted, OpenAI-compatible)
// ============================================================================

export class VLLMProvider implements LLMProvider {
  name = 'vllm';
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  async generateText(params: LLMGenerateParams): Promise<LLMGenerateResult> {
    const startTime = Date.now();
    const model = params.model ?? this.model;

    const messages: { role: string; content: string }[] = [];
    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }
    messages.push({ role: 'user', content: params.userPrompt });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature ?? 0.7,
        ...(params.responseFormat === 'json'
          ? { response_format: { type: 'json_object' } }
          : {}),
      }),
    });

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    const latencyMs = Date.now() - startTime;

    return {
      content: data.choices[0]?.message.content ?? '',
      model,
      provider: 'vllm',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs,
      estimatedCost: 0,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Provider Factory
// ============================================================================

export function createLLMProvider(config?: ProviderConfig): LLMProvider {
  const providerType = config?.type ?? (process.env.LLM_PROVIDER as ProviderConfig['type']) ?? 'anthropic';

  switch (providerType) {
    case 'ollama':
      return new OllamaProvider(
        config?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        config?.model ?? process.env.OLLAMA_MODEL ?? 'llama3.1:70b'
      );

    case 'vllm':
      return new VLLMProvider(
        config?.baseUrl ?? process.env.VLLM_BASE_URL ?? 'http://localhost:8000',
        config?.model ?? process.env.VLLM_MODEL ?? 'meta-llama/Llama-3.1-70B-Instruct'
      );

    case 'anthropic':
    case 'openai':
    case 'azure-openai':
    case 'aws-bedrock':
      // These providers use the existing SDK-based clients in the codebase.
      // This factory returns self-hosted providers; cloud providers use
      // getAnthropicClient() / getOpenAIClient() from @docsynth/utils.
      throw new Error(
        `Cloud provider "${providerType}" should use the existing SDK clients. ` +
        'Use createLLMProvider() only for self-hosted providers (ollama, vllm).'
      );

    default:
      throw new Error(`Unknown LLM provider: ${providerType}`);
  }
}

/**
 * Check which LLM providers are available in the current deployment.
 */
export async function detectAvailableProviders(): Promise<{
  providers: Array<{ name: string; available: boolean; selfHosted: boolean }>;
}> {
  const providers: Array<{ name: string; available: boolean; selfHosted: boolean }> = [];

  // Check Anthropic
  providers.push({
    name: 'anthropic',
    available: !!process.env.ANTHROPIC_API_KEY,
    selfHosted: false,
  });

  // Check OpenAI
  providers.push({
    name: 'openai',
    available: !!process.env.OPENAI_API_KEY,
    selfHosted: false,
  });

  // Check Azure OpenAI
  providers.push({
    name: 'azure-openai',
    available: !!process.env.AZURE_OPENAI_ENDPOINT && !!process.env.AZURE_OPENAI_API_KEY,
    selfHosted: false,
  });

  // Check Ollama
  if (process.env.OLLAMA_BASE_URL) {
    const ollama = new OllamaProvider(process.env.OLLAMA_BASE_URL);
    const available = await ollama.isAvailable();
    providers.push({ name: 'ollama', available, selfHosted: true });
  }

  // Check vLLM
  if (process.env.VLLM_BASE_URL) {
    const vllm = new VLLMProvider(process.env.VLLM_BASE_URL, '');
    const available = await vllm.isAvailable();
    providers.push({ name: 'vllm', available, selfHosted: true });
  }

  return { providers };
}
