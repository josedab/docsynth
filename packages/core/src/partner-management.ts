// ============================================================================
// Types
// ============================================================================

export type PartnerTier = 'starter' | 'growth' | 'enterprise';

export interface TierConfig {
  name: PartnerTier;
  monthlyApiCalls: number;
  docsPerMonth: number;
  storageGb: number;
  pricePerApiCall: number;
  pricePerDoc: number;
  pricePerGbStorage: number;
  basePriceMonthly: number;
  burstMultiplier: number;
  features: string[];
}

export interface PartnerConfig {
  id: string;
  name: string;
  contactEmail: string;
  tier: PartnerTier;
  apiKey: string;
  rateLimit: { requestsPerMinute: number; requestsPerHour: number };
  featuresEnabled: string[];
  createdAt: string;
  active: boolean;
}

export interface UsageBillingInput {
  apiCalls: number;
  docsGenerated: number;
  storageUsedGb: number;
}

export interface BillingBreakdown {
  tier: PartnerTier;
  basePrice: number;
  apiCallsCost: number;
  docsGeneratedCost: number;
  storageCost: number;
  totalCost: number;
  overages: { apiCalls: number; docs: number; storageGb: number };
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

export interface ApiKeyValidation {
  valid: boolean;
  partnerId: string | null;
  tier: PartnerTier | null;
  reason?: string;
}

// ============================================================================
// Tier definitions
// ============================================================================

export const TIER_CONFIGS: Record<PartnerTier, TierConfig> = {
  starter: {
    name: 'starter',
    monthlyApiCalls: 10_000,
    docsPerMonth: 100,
    storageGb: 5,
    pricePerApiCall: 0.001,
    pricePerDoc: 0.1,
    pricePerGbStorage: 0.5,
    basePriceMonthly: 29,
    burstMultiplier: 1.2,
    features: ['markdown-gen', 'changelog-gen'],
  },
  growth: {
    name: 'growth',
    monthlyApiCalls: 100_000,
    docsPerMonth: 1_000,
    storageGb: 50,
    pricePerApiCall: 0.0008,
    pricePerDoc: 0.07,
    pricePerGbStorage: 0.35,
    basePriceMonthly: 199,
    burstMultiplier: 1.5,
    features: ['markdown-gen', 'changelog-gen', 'sdk-gen', 'webhooks'],
  },
  enterprise: {
    name: 'enterprise',
    monthlyApiCalls: 1_000_000,
    docsPerMonth: 10_000,
    storageGb: 500,
    pricePerApiCall: 0.0005,
    pricePerDoc: 0.04,
    pricePerGbStorage: 0.2,
    basePriceMonthly: 999,
    burstMultiplier: 2.0,
    features: [
      'markdown-gen',
      'changelog-gen',
      'sdk-gen',
      'webhooks',
      'sso',
      'audit-log',
      'custom-branding',
    ],
  },
};

// ============================================================================
// Functions
// ============================================================================

export function getTierConfig(tier: PartnerTier): TierConfig {
  return TIER_CONFIGS[tier];
}

export function calculateBilling(tier: PartnerTier, usage: UsageBillingInput): BillingBreakdown {
  const config = TIER_CONFIGS[tier];

  const apiOverage = Math.max(0, usage.apiCalls - config.monthlyApiCalls);
  const docsOverage = Math.max(0, usage.docsGenerated - config.docsPerMonth);
  const storageOverage = Math.max(0, usage.storageUsedGb - config.storageGb);

  const apiCallsCost = apiOverage * config.pricePerApiCall;
  const docsGeneratedCost = docsOverage * config.pricePerDoc;
  const storageCost = storageOverage * config.pricePerGbStorage;

  return {
    tier,
    basePrice: config.basePriceMonthly,
    apiCallsCost,
    docsGeneratedCost,
    storageCost,
    totalCost: config.basePriceMonthly + apiCallsCost + docsGeneratedCost + storageCost,
    overages: {
      apiCalls: apiOverage,
      docs: docsOverage,
      storageGb: storageOverage,
    },
  };
}

export function validatePartnerApiKey(apiKey: string, partners: PartnerConfig[]): ApiKeyValidation {
  if (!apiKey || apiKey.length < 16) {
    return { valid: false, partnerId: null, tier: null, reason: 'Invalid key format' };
  }
  const partner = partners.find((p) => p.apiKey === apiKey && p.active);
  if (!partner) {
    return { valid: false, partnerId: null, tier: null, reason: 'Key not found or inactive' };
  }
  return { valid: true, partnerId: partner.id, tier: partner.tier };
}

export function checkRateLimit(
  partner: PartnerConfig,
  currentMinuteRequests: number,
  currentHourRequests: number
): { allowed: boolean; retryAfterSeconds?: number } {
  if (currentMinuteRequests >= partner.rateLimit.requestsPerMinute) {
    return { allowed: false, retryAfterSeconds: 60 };
  }
  if (currentHourRequests >= partner.rateLimit.requestsPerHour) {
    return { allowed: false, retryAfterSeconds: 3600 };
  }
  return { allowed: true };
}

export function generateOnboardingChecklist(tier: PartnerTier): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    {
      id: 'register',
      title: 'Register Account',
      description: 'Create your partner account',
      completed: false,
    },
    {
      id: 'api-key',
      title: 'Generate API Key',
      description: 'Create your first API key',
      completed: false,
    },
    {
      id: 'first-call',
      title: 'Make First API Call',
      description: 'Test the docs generation endpoint',
      completed: false,
    },
    {
      id: 'webhook',
      title: 'Configure Webhooks',
      description: 'Set up event notifications',
      completed: false,
    },
  ];

  const config = TIER_CONFIGS[tier];
  if (config.features.includes('sso')) {
    steps.push({
      id: 'sso',
      title: 'Configure SSO',
      description: 'Set up single sign-on',
      completed: false,
    });
  }
  if (config.features.includes('custom-branding')) {
    steps.push({
      id: 'branding',
      title: 'Custom Branding',
      description: 'Upload logo and brand colors',
      completed: false,
    });
  }

  return steps;
}
