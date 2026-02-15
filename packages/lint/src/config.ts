// ============================================================================
// Configuration Helpers
// ============================================================================

import type { LintConfig } from './linter.js';

/**
 * Default lint configuration with all rules enabled at 'warn' level.
 */
export const DEFAULT_CONFIG: LintConfig = {
  rules: {
    'missing-api-docs': 'warn',
    'stale-reference': 'warn',
    'broken-internal-link': 'warn',
    'missing-code-examples': 'warn',
    'outdated-version-reference': 'warn',
    'incomplete-parameter-docs': 'warn',
    'missing-return-type-docs': 'warn',
    'empty-section': 'warn',
  },
  includePaths: ['**/*.md', '**/*.mdx'],
  excludePaths: ['node_modules/**', 'dist/**'],
};

/**
 * Load a lint configuration, falling back to defaults.
 */
export function loadConfig(overrides?: Partial<LintConfig>): LintConfig {
  if (!overrides) return { ...DEFAULT_CONFIG };
  return mergeConfig(DEFAULT_CONFIG, overrides);
}

/**
 * Deep-merge two lint configurations.
 */
export function mergeConfig(base: LintConfig, override: Partial<LintConfig>): LintConfig {
  return {
    rules: { ...base.rules, ...override.rules },
    includePaths: override.includePaths ?? base.includePaths,
    excludePaths: override.excludePaths ?? base.excludePaths,
    customRules: [...(base.customRules ?? []), ...(override.customRules ?? [])],
  };
}
