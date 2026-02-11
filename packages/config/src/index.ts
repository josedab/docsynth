import { z } from 'zod';

// Environment configuration schema
const envSchema = z
  .object({
    // Node environment
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Demo mode - skips GitHub App requirement, uses sample data
    DEMO_MODE: z
      .string()
      .transform((v) => v === 'true')
      .default('false'),

    // Server
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),

    // Database
    DATABASE_URL: z.string().url(),

    // Redis
    REDIS_URL: z.string().url(),

    // GitHub App (required unless DEMO_MODE=true)
    GITHUB_APP_ID: z.string().optional().default(''),
    GITHUB_APP_PRIVATE_KEY: z.string().optional().default(''),
    GITHUB_CLIENT_ID: z.string().optional().default(''),
    GITHUB_CLIENT_SECRET: z.string().optional().default(''),
    GITHUB_WEBHOOK_SECRET: z.string().optional().default(''),

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
  })
  .refine(
    (data) => {
      if (data.DEMO_MODE) return true;
      return (
        data.GITHUB_APP_ID &&
        data.GITHUB_APP_PRIVATE_KEY &&
        data.GITHUB_CLIENT_ID &&
        data.GITHUB_CLIENT_SECRET
      );
    },
    {
      message:
        'GitHub App credentials (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET) are required unless DEMO_MODE=true',
      path: ['GITHUB_APP_ID'],
    }
  );

export type EnvConfig = z.infer<typeof envSchema>;

interface ConfigHint {
  field: string;
  message: string;
  hint: string | null;
}

function diagnoseConfigErrors(issues: z.ZodIssue[]): ConfigHint[] {
  const envValues: Record<string, string | undefined> = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    DEMO_MODE: process.env.DEMO_MODE,
  };

  return issues.map((issue) => {
    const field = issue.path.join('.');
    const message = issue.message;

    // Detect placeholder values left from .env.example
    if (field === 'SESSION_SECRET' || field === 'JWT_SECRET') {
      if (envValues[field]?.includes('CHANGE_ME')) {
        return {
          field,
          message: 'Still has placeholder value from .env.example',
          hint: 'Generate with: openssl rand -hex 32',
        };
      }
      return {
        field,
        message,
        hint: 'Must be at least 32 chars. Generate with: openssl rand -hex 32',
      };
    }

    if (field === 'DATABASE_URL') {
      if (!envValues.DATABASE_URL) {
        return {
          field,
          message: 'Missing',
          hint: 'Add to .env: DATABASE_URL=postgresql://docsynth:docsynth_dev@localhost:5432/docsynth',
        };
      }
      return {
        field,
        message,
        hint: 'Ensure PostgreSQL is running: docker compose up -d postgres',
      };
    }

    if (field === 'REDIS_URL') {
      if (!envValues.REDIS_URL) {
        return { field, message: 'Missing', hint: 'Add to .env: REDIS_URL=redis://localhost:6379' };
      }
      return { field, message, hint: 'Ensure Redis is running: docker compose up -d redis' };
    }

    if (field === 'GITHUB_APP_ID') {
      const isPlaceholder = envValues.GITHUB_APP_ID === 'your_app_id' || !envValues.GITHUB_APP_ID;
      if (isPlaceholder && envValues.DEMO_MODE !== 'true') {
        return {
          field,
          message: 'GitHub App not configured and DEMO_MODE is not enabled',
          hint: 'Quick fix: Add DEMO_MODE=true to .env  (or configure GitHub App credentials)',
        };
      }
      return {
        field,
        message,
        hint: 'Set DEMO_MODE=true in .env or configure GitHub App credentials',
      };
    }

    return { field, message, hint: null };
  });
}

let cachedConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const hints = diagnoseConfigErrors(result.error.issues);
    console.error('\n❌ Configuration Error\n');

    for (const { field, message, hint } of hints) {
      console.error(`  ${field}: ${message}`);
      if (hint) {
        console.error(`    → ${hint}\n`);
      } else {
        console.error('');
      }
    }

    console.error('  Run "npm run doctor" to check your environment.');
    console.error('  Or run "./scripts/setup.sh" for guided setup.\n');
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

export function isDemoMode(): boolean {
  const config = getEnvConfigSafe();
  return config?.DEMO_MODE === true;
}

export { envSchema };
