// ============================================================================
// Types
// ============================================================================

export type GRCProvider = 'vanta' | 'drata' | 'secureframe';
export type SyncMode = 'push' | 'pull';
export type SyncItemStatus = 'synced' | 'pending' | 'error';

export interface GRCIntegration {
  id: string;
  provider: GRCProvider;
  apiEndpoint: string;
  apiKeyRef: string;
  syncMode: SyncMode;
  enabled: boolean;
  lastSync: SyncStatus | null;
  createdAt: string;
}

export interface SyncStatus {
  syncedAt: string;
  itemsSynced: number;
  errors: SyncError[];
  durationMs: number;
}

export interface SyncError {
  itemId: string;
  message: string;
  code: string;
  retryable: boolean;
}

export interface WebhookPayload {
  event: string;
  provider: GRCProvider;
  timestamp: string;
  data: Record<string, unknown>;
  signature: string;
}

export interface GRCComplianceItem {
  controlId: string;
  status: 'passing' | 'failing' | 'unknown';
  evidence: string[];
  lastChecked: string;
}

export interface ProviderMapping {
  provider: GRCProvider;
  fieldMappings: Record<string, string>;
  statusMap: Record<string, string>;
}

// ============================================================================
// Provider configurations
// ============================================================================

const PROVIDER_CONFIGS: Record<GRCProvider, ProviderMapping> = {
  vanta: {
    provider: 'vanta',
    fieldMappings: {
      controlId: 'external_id',
      status: 'status',
      evidence: 'evidence_urls',
      lastChecked: 'last_evaluated_at',
    },
    statusMap: { passing: 'PASS', failing: 'FAIL', unknown: 'UNKNOWN' },
  },
  drata: {
    provider: 'drata',
    fieldMappings: {
      controlId: 'controlIdentifier',
      status: 'complianceStatus',
      evidence: 'evidenceArtifacts',
      lastChecked: 'evaluatedAt',
    },
    statusMap: { passing: 'COMPLIANT', failing: 'NON_COMPLIANT', unknown: 'PENDING' },
  },
  secureframe: {
    provider: 'secureframe',
    fieldMappings: {
      controlId: 'control_ref',
      status: 'result',
      evidence: 'evidence_items',
      lastChecked: 'checked_at',
    },
    statusMap: { passing: 'pass', failing: 'fail', unknown: 'pending' },
  },
};

// ============================================================================
// Functions
// ============================================================================

export function createIntegration(
  provider: GRCProvider,
  apiEndpoint: string,
  apiKeyRef: string,
  syncMode: SyncMode = 'push'
): GRCIntegration {
  return {
    id: `grc-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    provider,
    apiEndpoint,
    apiKeyRef,
    syncMode,
    enabled: true,
    lastSync: null,
    createdAt: new Date().toISOString(),
  };
}

export function formatForProvider(
  provider: GRCProvider,
  items: GRCComplianceItem[]
): Record<string, unknown>[] {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`Unsupported provider: ${provider}`);

  return items.map((item) => {
    const mapped: Record<string, unknown> = {};
    mapped[config.fieldMappings.controlId!] = item.controlId;
    mapped[config.fieldMappings.status!] = config.statusMap[item.status] ?? item.status;
    mapped[config.fieldMappings.evidence!] = item.evidence;
    mapped[config.fieldMappings.lastChecked!] = item.lastChecked;
    return mapped;
  });
}

export function generateWebhookPayload(
  event: string,
  provider: GRCProvider,
  data: Record<string, unknown>
): WebhookPayload {
  const timestamp = new Date().toISOString();
  const signature = computeSignature(event, timestamp, data);

  return { event, provider, timestamp, data, signature };
}

export function buildSyncStatus(
  itemsSynced: number,
  errors: SyncError[],
  durationMs: number
): SyncStatus {
  return { syncedAt: new Date().toISOString(), itemsSynced, errors, durationMs };
}

export function getProviderConfig(provider: GRCProvider): ProviderMapping {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`Unsupported provider: ${provider}`);
  return config;
}

export function validateIntegration(integration: GRCIntegration): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!integration.apiEndpoint) errors.push('apiEndpoint is required');
  if (!integration.apiKeyRef) errors.push('apiKeyRef is required');
  if (!PROVIDER_CONFIGS[integration.provider])
    errors.push(`Unsupported provider: ${integration.provider}`);

  try {
    new URL(integration.apiEndpoint);
  } catch {
    errors.push('apiEndpoint must be a valid URL');
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Helpers
// ============================================================================

function computeSignature(event: string, timestamp: string, data: Record<string, unknown>): string {
  let hash = 0;
  const str = `${event}:${timestamp}:${JSON.stringify(data)}`;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `sig-${Math.abs(hash).toString(16).padStart(8, '0')}`;
}
