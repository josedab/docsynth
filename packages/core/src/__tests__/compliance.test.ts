import { describe, it, expect } from 'vitest';
import {
  getFramework,
  mapCodePatterns,
  generateChecklist,
  scoreCompliance,
} from '../compliance-templates.js';
import {
  collectEvidence,
  generateManifest,
  buildTimeline,
  exportPackage,
  formatAsCSV,
  formatAsPDFMetadata,
  type EvidenceItem,
} from '../evidence-export.js';
import {
  createIntegration,
  formatForProvider,
  generateWebhookPayload,
  buildSyncStatus,
  getProviderConfig,
  validateIntegration,
  type GRCComplianceItem,
} from '../grc-integration.js';

// ============================================================================
// compliance-templates
// ============================================================================

describe('compliance-templates', () => {
  describe('getFramework', () => {
    it('returns SOC2 framework', () => {
      const fw = getFramework('soc2');
      expect(fw.id).toBe('soc2');
      expect(fw.name).toBe('SOC 2 Type II');
      expect(fw.controls.length).toBeGreaterThan(0);
    });

    it('returns all five frameworks', () => {
      const ids = ['soc2', 'iso27001', 'hipaa', 'gdpr', 'pci-dss'] as const;
      for (const id of ids) {
        const fw = getFramework(id);
        expect(fw.id).toBe(id);
        expect(fw.controls.length).toBeGreaterThan(0);
      }
    });

    it('throws for unknown framework', () => {
      expect(() => getFramework('unknown' as any)).toThrow('Unknown framework');
    });
  });

  describe('mapCodePatterns', () => {
    it('maps auth code to SOC2 CC6.1', () => {
      const results = mapCodePatterns(['requireAuth middleware', 'session management'], 'soc2');
      const cc61 = results.find((r) => r.controlId === 'CC6.1');
      expect(cc61).toBeDefined();
      expect(cc61!.matchedPatterns).toContain('requireAuth');
    });

    it('returns empty when no patterns match', () => {
      const results = mapCodePatterns(['hello world'], 'soc2');
      expect(results).toHaveLength(0);
    });
  });

  describe('generateChecklist', () => {
    it('generates checklist with met items when all evidence is provided', () => {
      const checklist = generateChecklist('soc2', [
        'code-review',
        'test-result',
        'access-log',
        'deploy-log',
        'config-audit',
        'policy-doc',
      ]);
      expect(checklist.frameworkId).toBe('soc2');
      expect(checklist.items.length).toBeGreaterThan(0);
      expect(checklist.summary.met).toBeGreaterThan(0);
    });

    it('marks items as not-met when no evidence', () => {
      const checklist = generateChecklist('hipaa', []);
      expect(checklist.summary.notMet).toBe(checklist.items.length);
    });

    it('marks items as partial when some evidence provided', () => {
      const checklist = generateChecklist('soc2', ['code-review']);
      const partial = checklist.items.filter((i) => i.status === 'partial');
      expect(partial.length).toBeGreaterThan(0);
    });
  });

  describe('scoreCompliance', () => {
    it('scores higher with more evidence', () => {
      const low = scoreCompliance('soc2', []);
      const high = scoreCompliance('soc2', [
        'code-review',
        'test-result',
        'access-log',
        'deploy-log',
        'config-audit',
        'policy-doc',
      ]);
      expect(high.percentage).toBeGreaterThan(low.percentage);
    });

    it('includes code pattern matching in score', () => {
      const withoutCode = scoreCompliance('soc2', ['code-review']);
      const withCode = scoreCompliance(
        'soc2',
        ['code-review'],
        ['requireAuth', 'bcrypt', 'createLogger']
      );
      expect(withCode.percentage).toBeGreaterThanOrEqual(withoutCode.percentage);
    });

    it('returns percentage between 0 and 100', () => {
      const score = scoreCompliance('gdpr', ['policy-doc', 'config-audit']);
      expect(score.percentage).toBeGreaterThanOrEqual(0);
      expect(score.percentage).toBeLessThanOrEqual(100);
    });
  });
});

// ============================================================================
// evidence-export
// ============================================================================

describe('evidence-export', () => {
  const sampleItems: EvidenceItem[] = [
    {
      id: 'ev-1',
      type: 'code-change',
      title: 'Auth refactor',
      description: 'Refactored auth module',
      timestamp: '2024-01-15T10:00:00Z',
      actor: 'dev@example.com',
      metadata: {},
      hash: 'abc123',
    },
    {
      id: 'ev-2',
      type: 'review-approval',
      title: 'PR #42 approved',
      description: 'Approved by lead',
      timestamp: '2024-01-16T12:00:00Z',
      actor: 'lead@example.com',
      metadata: {},
      hash: 'def456',
    },
    {
      id: 'ev-3',
      type: 'test-result',
      title: 'CI passed',
      description: 'All tests green',
      timestamp: '2024-01-14T08:00:00Z',
      actor: 'ci-bot',
      metadata: {},
      hash: 'ghi789',
    },
  ];

  describe('collectEvidence', () => {
    it('returns all items when no since provided', () => {
      const result = collectEvidence(sampleItems);
      expect(result).toHaveLength(3);
    });

    it('filters items since a given date', () => {
      const result = collectEvidence(sampleItems, '2024-01-15T00:00:00Z');
      expect(result).toHaveLength(2);
    });
  });

  describe('generateManifest', () => {
    it('generates manifest with chain of custody', () => {
      const manifest = generateManifest(sampleItems, 'soc2', 'auditor@co.com', 'github');
      expect(manifest.frameworkId).toBe('soc2');
      expect(manifest.totalItems).toBe(3);
      expect(manifest.chainOfCustody.collectedBy).toBe('auditor@co.com');
      expect(manifest.chainOfCustody.previousManifestId).toBeNull();
      expect(manifest.itemIds).toHaveLength(3);
    });

    it('links to previous manifest for incremental', () => {
      const manifest = generateManifest(sampleItems, 'soc2', 'auditor', 'github', 'prev-123');
      expect(manifest.chainOfCustody.previousManifestId).toBe('prev-123');
    });
  });

  describe('buildTimeline', () => {
    it('sorts events chronologically', () => {
      const timeline = buildTimeline(sampleItems);
      expect(timeline).toHaveLength(3);
      expect(timeline[0]!.evidenceId).toBe('ev-3');
      expect(timeline[2]!.evidenceId).toBe('ev-2');
    });
  });

  describe('exportPackage', () => {
    it('creates a complete package', () => {
      const pkg = exportPackage(sampleItems, 'hipaa', 'auditor', 'github', 'json');
      expect(pkg.manifest.frameworkId).toBe('hipaa');
      expect(pkg.items).toHaveLength(3);
      expect(pkg.timeline).toHaveLength(3);
      expect(pkg.format).toBe('json');
    });
  });

  describe('formatAsCSV', () => {
    it('produces valid CSV with header row', () => {
      const csv = formatAsCSV(sampleItems);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('id,type,title,description,timestamp,actor,hash');
      expect(lines).toHaveLength(4);
    });
  });

  describe('formatAsPDFMetadata', () => {
    it('returns metadata object', () => {
      const pkg = exportPackage(sampleItems, 'gdpr', 'auditor', 'github');
      const meta = formatAsPDFMetadata(pkg);
      expect(meta.title).toContain('gdpr');
      expect(meta.totalItems).toBe(3);
    });
  });
});

// ============================================================================
// grc-integration
// ============================================================================

describe('grc-integration', () => {
  describe('createIntegration', () => {
    it('creates a valid integration', () => {
      const int = createIntegration('vanta', 'https://api.vanta.com', 'vault:vanta-key');
      expect(int.provider).toBe('vanta');
      expect(int.syncMode).toBe('push');
      expect(int.enabled).toBe(true);
      expect(int.lastSync).toBeNull();
    });

    it('supports pull sync mode', () => {
      const int = createIntegration('drata', 'https://api.drata.com', 'vault:drata-key', 'pull');
      expect(int.syncMode).toBe('pull');
    });
  });

  describe('formatForProvider', () => {
    const items: GRCComplianceItem[] = [
      {
        controlId: 'CC6.1',
        status: 'passing',
        evidence: ['ev-1'],
        lastChecked: '2024-01-15T10:00:00Z',
      },
      { controlId: 'CC7.1', status: 'failing', evidence: [], lastChecked: '2024-01-15T10:00:00Z' },
    ];

    it('formats items for Vanta', () => {
      const formatted = formatForProvider('vanta', items);
      expect(formatted).toHaveLength(2);
      expect(formatted[0]!['external_id']).toBe('CC6.1');
      expect(formatted[0]!['status']).toBe('PASS');
      expect(formatted[1]!['status']).toBe('FAIL');
    });

    it('formats items for Drata', () => {
      const formatted = formatForProvider('drata', items);
      expect(formatted[0]!['controlIdentifier']).toBe('CC6.1');
      expect(formatted[0]!['complianceStatus']).toBe('COMPLIANT');
    });

    it('formats items for SecureFrame', () => {
      const formatted = formatForProvider('secureframe', items);
      expect(formatted[0]!['control_ref']).toBe('CC6.1');
      expect(formatted[0]!['result']).toBe('pass');
    });
  });

  describe('generateWebhookPayload', () => {
    it('generates payload with signature', () => {
      const payload = generateWebhookPayload('compliance.updated', 'vanta', { score: 85 });
      expect(payload.event).toBe('compliance.updated');
      expect(payload.provider).toBe('vanta');
      expect(payload.signature).toMatch(/^sig-/);
      expect(payload.data.score).toBe(85);
    });
  });

  describe('buildSyncStatus', () => {
    it('builds status with no errors', () => {
      const status = buildSyncStatus(10, [], 250);
      expect(status.itemsSynced).toBe(10);
      expect(status.errors).toHaveLength(0);
      expect(status.durationMs).toBe(250);
    });

    it('includes errors', () => {
      const errors = [{ itemId: 'x', message: 'fail', code: 'ERR', retryable: true }];
      const status = buildSyncStatus(5, errors, 500);
      expect(status.errors).toHaveLength(1);
    });
  });

  describe('getProviderConfig', () => {
    it('returns config for each provider', () => {
      for (const p of ['vanta', 'drata', 'secureframe'] as const) {
        const config = getProviderConfig(p);
        expect(config.provider).toBe(p);
        expect(Object.keys(config.fieldMappings).length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateIntegration', () => {
    it('validates a correct integration', () => {
      const int = createIntegration('vanta', 'https://api.vanta.com', 'vault:key');
      const result = validateIntegration(int);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects invalid URL', () => {
      const int = createIntegration('vanta', 'not-a-url', 'vault:key');
      const result = validateIntegration(int);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects empty apiKeyRef', () => {
      const int = createIntegration('drata', 'https://api.drata.com', '');
      const result = validateIntegration(int);
      expect(result.valid).toBe(false);
    });
  });
});
