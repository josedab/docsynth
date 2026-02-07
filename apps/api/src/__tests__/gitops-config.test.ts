import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  diffConfigs,
  generateScaffoldConfig,
  DEFAULT_CONFIG,
  type GitOpsConfig,
} from '../services/gitops-config.service.js';

describe('GitOps Configuration Service', () => {
  describe('validateConfig', () => {
    it('should validate a correct config', () => {
      const result = validateConfig(DEFAULT_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject null config', () => {
      const result = validateConfig(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('non-null object');
    });

    it('should reject invalid version', () => {
      const result = validateConfig({ version: '99' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unsupported config version');
    });

    it('should reject invalid coverage percent', () => {
      const result = validateConfig({
        version: '1',
        quality: { minCoveragePercent: 150 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('minCoveragePercent');
    });

    it('should reject invalid document types', () => {
      const result = validateConfig({
        version: '1',
        documents: [{ type: 'INVALID', path: 'foo.md' }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid document type');
    });

    it('should warn about scheduled triggers', () => {
      const result = validateConfig({
        version: '1',
        triggers: { schedule: '0 0 * * *' },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('experimental');
    });

    it('should validate valid document entries', () => {
      const result = validateConfig({
        version: '1',
        documents: [
          { type: 'README', path: 'README.md' },
          { type: 'API_REFERENCE', path: 'docs/api.md' },
          { type: 'ADR', path: 'docs/adr/' },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('diffConfigs', () => {
    it('should detect no changes for identical configs', () => {
      const diff = diffConfigs(DEFAULT_CONFIG, DEFAULT_CONFIG);
      expect(diff.changed).toBe(false);
      expect(diff.addedDocTypes).toHaveLength(0);
      expect(diff.removedDocTypes).toHaveLength(0);
    });

    it('should detect added document types', () => {
      const newConfig: GitOpsConfig = {
        ...DEFAULT_CONFIG,
        documents: [
          ...(DEFAULT_CONFIG.documents ?? []),
          { type: 'GUIDE', path: 'docs/guide.md', enabled: true, autoUpdate: true },
        ],
      };
      const diff = diffConfigs(DEFAULT_CONFIG, newConfig);
      expect(diff.changed).toBe(true);
      expect(diff.addedDocTypes).toContain('GUIDE');
    });

    it('should detect removed document types', () => {
      const newConfig: GitOpsConfig = {
        ...DEFAULT_CONFIG,
        documents: [{ type: 'README', path: 'README.md', enabled: true, autoUpdate: true }],
      };
      const diff = diffConfigs(DEFAULT_CONFIG, newConfig);
      expect(diff.changed).toBe(true);
      expect(diff.removedDocTypes.length).toBeGreaterThan(0);
    });

    it('should detect quality changes', () => {
      const newConfig: GitOpsConfig = {
        ...DEFAULT_CONFIG,
        quality: { ...DEFAULT_CONFIG.quality, minCoveragePercent: 90 },
      };
      const diff = diffConfigs(DEFAULT_CONFIG, newConfig);
      expect(diff.changed).toBe(true);
      expect(diff.qualityChanged).toBe(true);
    });

    it('should detect style changes', () => {
      const newConfig: GitOpsConfig = {
        ...DEFAULT_CONFIG,
        style: { tone: 'casual', includeExamples: false },
      };
      const diff = diffConfigs(DEFAULT_CONFIG, newConfig);
      expect(diff.changed).toBe(true);
      expect(diff.styleChanged).toBe(true);
    });
  });

  describe('generateScaffoldConfig', () => {
    it('should generate valid YAML scaffold', () => {
      const scaffold = generateScaffoldConfig();
      expect(scaffold).toContain("version: '1'");
      expect(scaffold).toContain('triggers:');
      expect(scaffold).toContain('documents:');
      expect(scaffold).toContain('quality:');
      expect(scaffold).toContain('style:');
      expect(scaffold).toContain('integrations:');
    });

    it('should include recommended defaults', () => {
      const scaffold = generateScaffoldConfig();
      expect(scaffold).toContain('minCoveragePercent: 70');
      expect(scaffold).toContain('onPRMerge: true');
      expect(scaffold).toContain('tone: technical');
    });
  });
});
