import { z } from 'zod';

// Environment configuration schema
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // GitHub App
  GITHUB_APP_ID: z.string(),
  GITHUB_APP_PRIVATE_KEY: z.string(),
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  GITHUB_WEBHOOK_SECRET: z.string(),

  // Copilot SDK
  COPILOT_API_KEY: z.string().optional(),

  // Stripe (optional for development)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // MCP Servers (optional)
  JIRA_MCP_URL: z.string().url().optional(),
  SLACK_MCP_URL: z.string().url().optional(),
  CONFLUENCE_MCP_URL: z.string().url().optional(),

  // Session/Auth
  SESSION_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),

  // URLs
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:3001'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    console.error('❌ Invalid environment variables:', formatted);
    throw new Error('Invalid environment configuration');
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function getEnvConfigSafe(): EnvConfig | null {
  try {
    return getEnvConfig();
  } catch {
    return null;
  }
}

// Default repository configuration
export const DEFAULT_REPOSITORY_CONFIG = {
  triggers: {
    onPRMerge: true,
    onPush: false,
    branches: ['main', 'master'],
  },
  filters: {
    includePaths: ['src/**/*', 'lib/**/*'],
    excludePaths: ['**/*.test.*', '**/*.spec.*', '**/node_modules/**', '**/dist/**'],
    excludePatterns: ['generated', 'auto-generated', '.min.'],
  },
  docTypes: {
    readme: true,
    apiDocs: true,
    changelog: true,
    guides: false,
    diagrams: false,
  },
  style: {
    tone: 'technical' as const,
    includeExamples: true,
    includeApiReference: true,
    customInstructions: null,
  },
};

// Feature flags
export interface FeatureFlags {
  enableIntentInference: boolean;
  enableStyleLearning: boolean;
  enableDiagramGeneration: boolean;
  enableMultiLanguage: boolean;
  enableSlackIntegration: boolean;
  enableJiraIntegration: boolean;
  enableConfluenceOutput: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  enableIntentInference: true,
  enableStyleLearning: false,
  enableDiagramGeneration: false,
  enableMultiLanguage: false,
  enableSlackIntegration: false,
  enableJiraIntegration: false,
  enableConfluenceOutput: false,
};

// Rate limiting configuration
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  api: { windowMs: 60000, maxRequests: 100 },
  webhook: { windowMs: 60000, maxRequests: 500 },
  generation: { windowMs: 3600000, maxRequests: 50 },
  healthScan: { windowMs: 300000, maxRequests: 10 },
  knowledgeGraph: { windowMs: 300000, maxRequests: 5 },
  exampleExecution: { windowMs: 60000, maxRequests: 30 },
  exampleValidation: { windowMs: 300000, maxRequests: 20 },
  exampleExtraction: { windowMs: 300000, maxRequests: 10 },
};

// Tier limits
export interface TierLimits {
  maxRepositories: number;
  maxGenerationsPerMonth: number;
  maxTeamMembers: number;
  features: FeatureFlags;
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    maxRepositories: 3,
    maxGenerationsPerMonth: 50,
    maxTeamMembers: 1,
    features: {
      ...DEFAULT_FEATURE_FLAGS,
      enableIntentInference: false,
    },
  },
  pro: {
    maxRepositories: 20,
    maxGenerationsPerMonth: 500,
    maxTeamMembers: 5,
    features: {
      ...DEFAULT_FEATURE_FLAGS,
      enableStyleLearning: true,
    },
  },
  team: {
    maxRepositories: 100,
    maxGenerationsPerMonth: 2000,
    maxTeamMembers: 50,
    features: {
      ...DEFAULT_FEATURE_FLAGS,
      enableStyleLearning: true,
      enableDiagramGeneration: true,
      enableJiraIntegration: true,
      enableSlackIntegration: true,
    },
  },
  enterprise: {
    maxRepositories: -1,
    maxGenerationsPerMonth: -1,
    maxTeamMembers: -1,
    features: {
      enableIntentInference: true,
      enableStyleLearning: true,
      enableDiagramGeneration: true,
      enableMultiLanguage: true,
      enableSlackIntegration: true,
      enableJiraIntegration: true,
      enableConfluenceOutput: true,
    },
  },
};

export { envSchema };
