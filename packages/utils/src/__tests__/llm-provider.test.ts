import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider, VLLMProvider, estimateCost, detectAvailableProviders, createLLMProvider } from '../llm-provider.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LLM Provider Abstraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('estimateCost', () => {
    it('should calculate cost for Claude Sonnet', () => {
      const cost = estimateCost('claude-sonnet-4-5-20250929', 1000, 500);
      // 1000 * 3.0/1M + 500 * 15.0/1M = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 4);
    });

    it('should return zero for self-hosted models', () => {
      expect(estimateCost('ollama', 10000, 5000)).toBe(0);
      expect(estimateCost('vllm', 10000, 5000)).toBe(0);
    });

    it('should fallback to gpt-4o-mini costs for unknown models', () => {
      const cost = estimateCost('unknown-model', 1000000, 1000000);
      // 1M * 0.15/1M + 1M * 0.6/1M = 0.15 + 0.6 = 0.75
      expect(cost).toBeCloseTo(0.75, 2);
    });
  });

  describe('OllamaProvider', () => {
    it('should generate text via Ollama API', async () => {
      const provider = new OllamaProvider('http://localhost:11434', 'llama3.1');

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          response: 'Generated text here.',
          eval_count: 50,
          prompt_eval_count: 30,
        }),
      });

      const result = await provider.generateText({
        userPrompt: 'Hello world',
        systemPrompt: 'You are helpful.',
      });

      expect(result.content).toBe('Generated text here.');
      expect(result.provider).toBe('ollama');
      expect(result.estimatedCost).toBe(0);
      expect(result.inputTokens).toBe(30);
      expect(result.outputTokens).toBe(50);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should generate embeddings', async () => {
      const provider = new OllamaProvider('http://localhost:11434');

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
      });

      const embedding = await provider.generateEmbedding('test text');
      expect(embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it('should check availability', async () => {
      const provider = new OllamaProvider('http://localhost:11434');

      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await provider.isAvailable()).toBe(true);

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      expect(await provider.isAvailable()).toBe(false);
    });

    it('should strip trailing slash from base URL', async () => {
      const provider = new OllamaProvider('http://localhost:11434/');
      mockFetch.mockResolvedValueOnce({ ok: true });
      await provider.isAvailable();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
    });
  });

  describe('VLLMProvider', () => {
    it('should generate text via OpenAI-compatible API', async () => {
      const provider = new VLLMProvider('http://localhost:8000', 'meta-llama/Llama-3.1-70B');

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          choices: [{ message: { content: 'vLLM response' } }],
          usage: { prompt_tokens: 20, completion_tokens: 40 },
        }),
      });

      const result = await provider.generateText({
        userPrompt: 'Test prompt',
        systemPrompt: 'System message',
      });

      expect(result.content).toBe('vLLM response');
      expect(result.provider).toBe('vllm');
      expect(result.estimatedCost).toBe(0);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(callBody.messages).toHaveLength(2);
      expect(callBody.messages[0].role).toBe('system');
    });

    it('should check availability', async () => {
      const provider = new VLLMProvider('http://localhost:8000', 'model');

      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('createLLMProvider', () => {
    it('should create Ollama provider', () => {
      const provider = createLLMProvider({ type: 'ollama', baseUrl: 'http://localhost:11434' });
      expect(provider.name).toBe('ollama');
    });

    it('should create vLLM provider', () => {
      const provider = createLLMProvider({ type: 'vllm', baseUrl: 'http://localhost:8000', model: 'test' });
      expect(provider.name).toBe('vllm');
    });

    it('should throw for cloud providers', () => {
      expect(() => createLLMProvider({ type: 'anthropic' })).toThrow('Cloud provider');
      expect(() => createLLMProvider({ type: 'openai' })).toThrow('Cloud provider');
    });
  });

  describe('detectAvailableProviders', () => {
    it('should detect providers from environment', async () => {
      const originalEnv = { ...process.env };
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = '';
      delete process.env.OLLAMA_BASE_URL;

      const result = await detectAvailableProviders();

      expect(result.providers.find((p) => p.name === 'anthropic')?.available).toBe(true);
      expect(result.providers.find((p) => p.name === 'openai')?.available).toBe(false);

      process.env = originalEnv;
    });
  });
});
