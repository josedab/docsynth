/**
 * GitOps Configuration Service
 *
 * Parses and validates .docsynth/ directory configuration files.
 * Supports YAML-based documentation rules, templates, and quality thresholds
 * that can be version-controlled alongside code.
 */

import { createLogger } from '@docsynth/utils';

const log = createLogger('gitops-config');

// ============================================================================
// Configuration Schema
// ============================================================================

export interface GitOpsConfig {
  version: '1';
  project?: ProjectConfig;
  triggers?: TriggerConfig;
  documents?: DocumentConfig[];
  quality?: QualityConfig;
  style?: StyleConfig;
  integrations?: IntegrationConfig;
}

export interface ProjectConfig {
  name?: string;
  description?: string;
  defaultLanguage?: string;
  languages?: string[];
}

export interface TriggerConfig {
  onPRMerge?: boolean;
  onPush?: boolean;
  branches?: string[];
  paths?: {
    include?: string[];
    exclude?: string[];
  };
  schedule?: string; // cron expression
}

export interface DocumentConfig {
  type: 'README' | 'API_REFERENCE' | 'CHANGELOG' | 'GUIDE' | 'TUTORIAL' | 'ARCHITECTURE' | 'ADR';
  path: string;
  enabled?: boolean;
  template?: string;
  sections?: string[];
  autoUpdate?: boolean;
}

export interface QualityConfig {
  minCoveragePercent?: number;
  minHealthScore?: number;
  failOnDecrease?: boolean;
  maxDecreasePercent?: number;
  blockMerge?: boolean;
  requiredDocTypes?: string[];
}

export interface StyleConfig {
  tone?: 'formal' | 'casual' | 'technical';
  includeExamples?: boolean;
  maxSectionLength?: number;
  customInstructions?: string;
}

export interface IntegrationConfig {
  slack?: { channel?: string; notifyOnGeneration?: boolean };
  jira?: { project?: string; linkIssues?: boolean };
  github?: { createPRComments?: boolean; createCheckRuns?: boolean };
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: GitOpsConfig = {
  version: '1',
  triggers: {
    onPRMerge: true,
    onPush: false,
    branches: ['main', 'master'],
    paths: {
      include: ['src/**', 'lib/**', 'packages/**'],
      exclude: ['**/*.test.*', '**/*.spec.*', 'node_modules/**'],
    },
  },
  documents: [
    { type: 'README', path: 'README.md', enabled: true, autoUpdate: true },
    { type: 'CHANGELOG', path: 'CHANGELOG.md', enabled: true, autoUpdate: true },
    { type: 'API_REFERENCE', path: 'docs/api.md', enabled: true, autoUpdate: true },
  ],
  quality: {
    minCoveragePercent: 70,
    minHealthScore: 60,
    failOnDecrease: true,
    maxDecreasePercent: 5,
    blockMerge: false,
  },
  style: {
    tone: 'technical',
    includeExamples: true,
  },
};

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(config: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be a non-null object'], warnings };
  }

  const cfg = config as Record<string, unknown>;

  // Version check
  if (cfg.version !== '1') {
    errors.push(`Unsupported config version: ${cfg.version}. Only version "1" is supported.`);
  }

  // Validate quality thresholds
  if (cfg.quality && typeof cfg.quality === 'object') {
    const q = cfg.quality as Record<string, unknown>;
    if (typeof q.minCoveragePercent === 'number' && (q.minCoveragePercent < 0 || q.minCoveragePercent > 100)) {
      errors.push('quality.minCoveragePercent must be between 0 and 100');
    }
    if (typeof q.minHealthScore === 'number' && (q.minHealthScore < 0 || q.minHealthScore > 100)) {
      errors.push('quality.minHealthScore must be between 0 and 100');
    }
    if (typeof q.maxDecreasePercent === 'number' && (q.maxDecreasePercent < 0 || q.maxDecreasePercent > 100)) {
      errors.push('quality.maxDecreasePercent must be between 0 and 100');
    }
  }

  // Validate documents
  if (Array.isArray(cfg.documents)) {
    const validTypes = ['README', 'API_REFERENCE', 'CHANGELOG', 'GUIDE', 'TUTORIAL', 'ARCHITECTURE', 'ADR'];
    for (const doc of cfg.documents as Record<string, unknown>[]) {
      if (!doc.type || !validTypes.includes(doc.type as string)) {
        errors.push(`Invalid document type: ${doc.type}. Must be one of: ${validTypes.join(', ')}`);
      }
      if (!doc.path || typeof doc.path !== 'string') {
        errors.push('Each document must have a valid path string');
      }
    }
  }

  // Validate triggers
  if (cfg.triggers && typeof cfg.triggers === 'object') {
    const t = cfg.triggers as Record<string, unknown>;
    if (t.branches && !Array.isArray(t.branches)) {
      errors.push('triggers.branches must be an array of strings');
    }
    if (t.schedule && typeof t.schedule === 'string') {
      warnings.push('Scheduled triggers are experimental and may not be supported in all environments');
    }
  }

  // Validate style
  if (cfg.style && typeof cfg.style === 'object') {
    const s = cfg.style as Record<string, unknown>;
    const validTones = ['formal', 'casual', 'technical'];
    if (s.tone && !validTones.includes(s.tone as string)) {
      warnings.push(`Unknown style tone: ${s.tone}. Recommended: ${validTones.join(', ')}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Config Parsing
// ============================================================================

export function parseYAMLConfig(yamlContent: string): GitOpsConfig {
  // Simple YAML parser for key-value pairs, arrays, and nested objects
  // In production, you'd use the 'yaml' npm package
  try {
    const lines = yamlContent.split('\n');
    const result: Record<string, unknown> = {};
    let currentSection: string | null = null;
    let currentSubSection: string | null = null;
    let currentArray: unknown[] | null = null;
    let currentArrayKey: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      // Skip comments and empty lines
      if (line.trim().startsWith('#') || line.trim() === '') continue;

      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      if (indent === 0 && trimmed.endsWith(':')) {
        // Top-level section
        if (currentArray && currentArrayKey && currentSection) {
          const section = result[currentSection] as Record<string, unknown> ?? {};
          section[currentArrayKey] = currentArray;
          result[currentSection] = section;
          currentArray = null;
          currentArrayKey = null;
        }
        currentSection = trimmed.slice(0, -1);
        currentSubSection = null;
        if (!result[currentSection]) result[currentSection] = {};
      } else if (indent === 2 && trimmed.endsWith(':') && currentSection) {
        if (currentArray && currentArrayKey) {
          const section = result[currentSection] as Record<string, unknown> ?? {};
          section[currentArrayKey] = currentArray;
          result[currentSection] = section;
          currentArray = null;
          currentArrayKey = null;
        }
        currentSubSection = trimmed.slice(0, -1);
        const section = result[currentSection] as Record<string, unknown>;
        if (!section[currentSubSection]) section[currentSubSection] = {};
      } else if (trimmed.startsWith('- ')) {
        const value = trimmed.slice(2).trim();
        if (!currentArray) {
          currentArray = [];
        }
        currentArray.push(parseValue(value));
      } else if (trimmed.includes(':')) {
        const colonIndex = trimmed.indexOf(':');
        const key = trimmed.slice(0, colonIndex).trim();
        const rawValue = trimmed.slice(colonIndex + 1).trim();

        if (currentArray && currentArrayKey && currentSection) {
          const section = result[currentSection] as Record<string, unknown> ?? {};
          section[currentArrayKey] = currentArray;
          result[currentSection] = section;
          currentArray = null;
          currentArrayKey = null;
        }

        if (rawValue === '' || rawValue === '[]') {
          // Next lines will be array items or nested object
          if (rawValue === '[]') {
            if (currentSection && currentSubSection) {
              const section = result[currentSection] as Record<string, unknown>;
              const sub = section[currentSubSection] as Record<string, unknown>;
              sub[key] = [];
            } else if (currentSection) {
              const section = result[currentSection] as Record<string, unknown>;
              section[key] = [];
            }
          } else {
            currentArrayKey = key;
            currentArray = [];
          }
        } else {
          const value = parseValue(rawValue);
          if (currentSection && currentSubSection) {
            const section = result[currentSection] as Record<string, unknown>;
            const sub = section[currentSubSection] as Record<string, unknown>;
            sub[key] = value;
          } else if (currentSection) {
            const section = result[currentSection] as Record<string, unknown>;
            section[key] = value;
          } else {
            result[key] = value;
          }
        }
      }
    }

    // Flush any remaining array
    if (currentArray && currentArrayKey && currentSection) {
      const section = result[currentSection] as Record<string, unknown> ?? {};
      section[currentArrayKey] = currentArray;
      result[currentSection] = section;
    }

    return result as unknown as GitOpsConfig;
  } catch (error) {
    log.error({ error }, 'Failed to parse YAML configuration');
    throw new Error(`Failed to parse .docsynth configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function parseValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^\d+\.\d+$/.test(raw)) return parseFloat(raw);
  // Strip quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ============================================================================
// Config Diffing
// ============================================================================

export interface ConfigDiff {
  changed: boolean;
  addedDocTypes: string[];
  removedDocTypes: string[];
  qualityChanged: boolean;
  triggerChanged: boolean;
  styleChanged: boolean;
}

export function diffConfigs(oldConfig: GitOpsConfig, newConfig: GitOpsConfig): ConfigDiff {
  const oldDocTypes = new Set((oldConfig.documents ?? []).map((d) => d.type));
  const newDocTypes = new Set((newConfig.documents ?? []).map((d) => d.type));

  const addedDocTypes = [...newDocTypes].filter((t) => !oldDocTypes.has(t));
  const removedDocTypes = [...oldDocTypes].filter((t) => !newDocTypes.has(t));

  const qualityChanged = JSON.stringify(oldConfig.quality) !== JSON.stringify(newConfig.quality);
  const triggerChanged = JSON.stringify(oldConfig.triggers) !== JSON.stringify(newConfig.triggers);
  const styleChanged = JSON.stringify(oldConfig.style) !== JSON.stringify(newConfig.style);

  return {
    changed: addedDocTypes.length > 0 || removedDocTypes.length > 0 || qualityChanged || triggerChanged || styleChanged,
    addedDocTypes,
    removedDocTypes,
    qualityChanged,
    triggerChanged,
    styleChanged,
  };
}

// ============================================================================
// Scaffold Generation
// ============================================================================

export function generateScaffoldConfig(): string {
  return `# DocSynth Configuration
# See https://docsynth.dev/docs/gitops for full reference
version: '1'

# Project metadata
project:
  name: my-project
  defaultLanguage: en

# When to regenerate documentation
triggers:
  onPRMerge: true
  onPush: false
  branches:
    - main
    - master
  paths:
    include:
      - src/**
      - lib/**
    exclude:
      - '**/*.test.*'
      - node_modules/**

# Document types to manage
documents:
  - type: README
    path: README.md
    enabled: true
    autoUpdate: true
  - type: CHANGELOG
    path: CHANGELOG.md
    enabled: true
    autoUpdate: true
  - type: API_REFERENCE
    path: docs/api.md
    enabled: true
    autoUpdate: true

# Quality gates for CI/CD
quality:
  minCoveragePercent: 70
  minHealthScore: 60
  failOnDecrease: true
  maxDecreasePercent: 5
  blockMerge: false

# Documentation style preferences
style:
  tone: technical
  includeExamples: true

# Integration settings
integrations:
  github:
    createPRComments: true
    createCheckRuns: true
`;
}
