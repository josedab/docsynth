import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComplianceAssessmentService, type ComplianceFramework, type ComplianceControlDef } from '../services/compliance-assessment.js';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    document: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    complianceReport: {
      findUnique: vi.fn().mockResolvedValue({ templateId: 'template-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    complianceControl: {
      upsert: vi.fn().mockResolvedValue({ id: 'control-1' }),
      findFirst: vi.fn().mockResolvedValue({ id: 'control-1' }),
    },
    complianceControlAssessment: {
      upsert: vi.fn().mockResolvedValue({ id: 'assessment-1' }),
    },
  },
}));

vi.mock('@docsynth/utils', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getAnthropicClient: vi.fn().mockReturnValue(null),
}));

vi.mock('@docsynth/github', () => ({
  createInstallationOctokit: vi.fn().mockReturnValue(null),
}));

describe('ComplianceAssessmentService', () => {
  let service: ComplianceAssessmentService;

  beforeEach(() => {
    service = new ComplianceAssessmentService();
    vi.clearAllMocks();
  });

  describe('getFrameworks', () => {
    it('should return all available frameworks', () => {
      const frameworks = service.getFrameworks();

      expect(frameworks).toBeInstanceOf(Array);
      expect(frameworks.length).toBeGreaterThanOrEqual(3);

      const frameworkIds = frameworks.map((f) => f.id);
      expect(frameworkIds).toContain('soc2');
      expect(frameworkIds).toContain('hipaa');
      expect(frameworkIds).toContain('gdpr');
    });

    it('should include control definitions for each framework', () => {
      const frameworks = service.getFrameworks();

      for (const framework of frameworks) {
        expect(framework.controls).toBeInstanceOf(Array);
        expect(framework.controls.length).toBeGreaterThan(0);

        for (const control of framework.controls) {
          expect(control).toHaveProperty('controlId');
          expect(control).toHaveProperty('title');
          expect(control).toHaveProperty('description');
          expect(control).toHaveProperty('category');
          expect(control).toHaveProperty('codePatterns');
          expect(control).toHaveProperty('docRequirements');
          expect(control).toHaveProperty('evidenceTypes');
          expect(control).toHaveProperty('priority');
        }
      }
    });
  });

  describe('getFramework', () => {
    it('should return SOC2 framework', () => {
      const framework = service.getFramework('SOC2');

      expect(framework).not.toBeNull();
      expect(framework?.id).toBe('soc2');
      expect(framework?.name).toBe('SOC 2 Type II');
    });

    it('should return HIPAA framework', () => {
      const framework = service.getFramework('HIPAA');

      expect(framework).not.toBeNull();
      expect(framework?.id).toBe('hipaa');
      expect(framework?.name).toBe('HIPAA Security Rule');
    });

    it('should return GDPR framework', () => {
      const framework = service.getFramework('GDPR');

      expect(framework).not.toBeNull();
      expect(framework?.id).toBe('gdpr');
      expect(framework?.name).toBe('GDPR');
    });

    it('should be case insensitive', () => {
      expect(service.getFramework('soc2')).not.toBeNull();
      expect(service.getFramework('SOC2')).not.toBeNull();
      expect(service.getFramework('Soc2')).not.toBeNull();
    });

    it('should return null for unknown framework', () => {
      const framework = service.getFramework('UNKNOWN');
      expect(framework).toBeNull();
    });
  });

  describe('SOC2 Framework', () => {
    it('should have access control controls', () => {
      const framework = service.getFramework('SOC2');
      const accessControls = framework?.controls.filter((c) => c.category === 'access_control');

      expect(accessControls).toBeDefined();
      expect(accessControls!.length).toBeGreaterThan(0);

      const cc61 = accessControls!.find((c) => c.controlId === 'CC6.1');
      expect(cc61).toBeDefined();
      expect(cc61?.title).toBe('Logical and Physical Access Controls');
      expect(cc61?.codePatterns).toContain('authentication');
      expect(cc61?.codePatterns).toContain('authorization');
    });

    it('should have encryption controls', () => {
      const framework = service.getFramework('SOC2');
      const encryptionControls = framework?.controls.filter((c) => c.category === 'encryption');

      expect(encryptionControls).toBeDefined();
      expect(encryptionControls!.length).toBeGreaterThan(0);

      const cc66 = encryptionControls!.find((c) => c.controlId === 'CC6.6');
      expect(cc66).toBeDefined();
      expect(cc66?.codePatterns).toContain('encrypt');
      expect(cc66?.codePatterns).toContain('crypto');
    });

    it('should have monitoring controls', () => {
      const framework = service.getFramework('SOC2');
      const monitoringControls = framework?.controls.filter((c) => c.category === 'monitoring');

      expect(monitoringControls).toBeDefined();
      expect(monitoringControls!.length).toBeGreaterThan(0);

      const cc72 = monitoringControls!.find((c) => c.controlId === 'CC7.2');
      expect(cc72).toBeDefined();
      expect(cc72?.codePatterns).toContain('log');
      expect(cc72?.codePatterns).toContain('audit');
    });
  });

  describe('HIPAA Framework', () => {
    it('should have ePHI access controls', () => {
      const framework = service.getFramework('HIPAA');
      const accessControl = framework?.controls.find((c) => c.controlId === '164.312(a)(1)');

      expect(accessControl).toBeDefined();
      expect(accessControl?.title).toBe('Access Control');
      expect(accessControl?.codePatterns).toContain('phi');
      expect(accessControl?.codePatterns).toContain('patient.*data');
    });

    it('should have integrity controls', () => {
      const framework = service.getFramework('HIPAA');
      const integrityControl = framework?.controls.find((c) => c.controlId === '164.312(c)(1)');

      expect(integrityControl).toBeDefined();
      expect(integrityControl?.category).toBe('data_integrity');
      expect(integrityControl?.codePatterns).toContain('audit.*trail');
    });

    it('should have transmission security controls', () => {
      const framework = service.getFramework('HIPAA');
      const transmissionControl = framework?.controls.find((c) => c.controlId === '164.312(e)(1)');

      expect(transmissionControl).toBeDefined();
      expect(transmissionControl?.category).toBe('encryption');
      expect(transmissionControl?.codePatterns).toContain('tls');
      expect(transmissionControl?.codePatterns).toContain('https');
    });
  });

  describe('GDPR Framework', () => {
    it('should have data processing principles', () => {
      const framework = service.getFramework('GDPR');
      const art5 = framework?.controls.find((c) => c.controlId === 'Art.5');

      expect(art5).toBeDefined();
      expect(art5?.title).toBe('Principles of Processing');
      expect(art5?.codePatterns).toContain('consent');
      expect(art5?.codePatterns).toContain('personal.*data');
      expect(art5?.codePatterns).toContain('pii');
    });

    it('should have right to erasure controls', () => {
      const framework = service.getFramework('GDPR');
      const art17 = framework?.controls.find((c) => c.controlId === 'Art.17');

      expect(art17).toBeDefined();
      expect(art17?.title).toBe('Right to Erasure');
      expect(art17?.codePatterns).toContain('delete.*user');
      expect(art17?.codePatterns).toContain('forget');
    });

    it('should have security of processing controls', () => {
      const framework = service.getFramework('GDPR');
      const art32 = framework?.controls.find((c) => c.controlId === 'Art.32');

      expect(art32).toBeDefined();
      expect(art32?.title).toBe('Security of Processing');
      expect(art32?.codePatterns).toContain('encrypt');
      expect(art32?.codePatterns).toContain('pseudonym');
    });
  });

  describe('isNotApplicable', () => {
    const isNotApplicable = (control: ComplianceControlDef): boolean => {
      return (service as unknown as {
        isNotApplicable: (control: ComplianceControlDef) => boolean;
      }).isNotApplicable(control);
    };

    it('should return true for optional controls', () => {
      const control: ComplianceControlDef = {
        controlId: 'TEST-1',
        title: 'Optional Control',
        description: 'This is optional',
        category: 'test',
        codePatterns: [],
        docRequirements: [],
        evidenceTypes: [],
        priority: 'optional',
      };

      expect(isNotApplicable(control)).toBe(true);
    });

    it('should return false for required controls', () => {
      const control: ComplianceControlDef = {
        controlId: 'TEST-2',
        title: 'Required Control',
        description: 'This is required',
        category: 'test',
        codePatterns: [],
        docRequirements: [],
        evidenceTypes: [],
        priority: 'required',
      };

      expect(isNotApplicable(control)).toBe(false);
    });

    it('should return false for recommended controls', () => {
      const control: ComplianceControlDef = {
        controlId: 'TEST-3',
        title: 'Recommended Control',
        description: 'This is recommended',
        category: 'test',
        codePatterns: [],
        docRequirements: [],
        evidenceTypes: [],
        priority: 'recommended',
      };

      expect(isNotApplicable(control)).toBe(false);
    });
  });

  describe('assessCompliance', () => {
    it('should throw error for unknown framework', async () => {
      await expect(
        service.assessCompliance(
          'repo-1',
          'report-1',
          12345,
          'owner',
          'repo',
          'UNKNOWN_FRAMEWORK'
        )
      ).rejects.toThrow('Unknown framework: UNKNOWN_FRAMEWORK');
    });
  });

  describe('framework control validation', () => {
    it('should have valid regex patterns in all frameworks', () => {
      const frameworks = service.getFrameworks();

      for (const framework of frameworks) {
        for (const control of framework.controls) {
          for (const pattern of control.codePatterns) {
            // Should not throw when creating regex
            expect(() => new RegExp(pattern, 'gi')).not.toThrow();
          }
        }
      }
    });

    it('should have all required fields populated', () => {
      const frameworks = service.getFrameworks();

      for (const framework of frameworks) {
        expect(framework.id).toBeTruthy();
        expect(framework.name).toBeTruthy();
        expect(framework.version).toBeTruthy();
        expect(framework.description).toBeTruthy();

        for (const control of framework.controls) {
          expect(control.controlId).toBeTruthy();
          expect(control.title).toBeTruthy();
          expect(control.description).toBeTruthy();
          expect(control.category).toBeTruthy();
          expect(control.codePatterns.length).toBeGreaterThan(0);
          expect(control.docRequirements.length).toBeGreaterThan(0);
          expect(control.evidenceTypes.length).toBeGreaterThan(0);
          expect(['required', 'recommended', 'optional']).toContain(control.priority);
        }
      }
    });
  });
});
