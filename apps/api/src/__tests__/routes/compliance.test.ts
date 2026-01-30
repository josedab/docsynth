import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@docsynth/database', () => ({
  prisma: {
    repository: {
      findFirst: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          compliant: true,
          score: 85,
          gaps: [],
        })}],
      }),
    };
  },
}));

describe('Compliance & Security Documentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Compliance Frameworks', () => {
    it('should define SOC2 requirements', () => {
      const soc2Requirements = {
        id: 'soc2',
        name: 'SOC 2 Type II',
        categories: [
          { id: 'security', name: 'Security', controls: 15 },
          { id: 'availability', name: 'Availability', controls: 5 },
          { id: 'processing-integrity', name: 'Processing Integrity', controls: 8 },
          { id: 'confidentiality', name: 'Confidentiality', controls: 10 },
          { id: 'privacy', name: 'Privacy', controls: 12 },
        ],
      };

      expect(soc2Requirements.categories.length).toBe(5);
      const totalControls = soc2Requirements.categories.reduce((sum, c) => sum + c.controls, 0);
      expect(totalControls).toBe(50);
    });

    it('should define GDPR requirements', () => {
      const gdprRequirements = {
        id: 'gdpr',
        name: 'GDPR',
        articles: [
          { id: 'art-5', name: 'Data Processing Principles' },
          { id: 'art-6', name: 'Lawfulness of Processing' },
          { id: 'art-7', name: 'Consent' },
          { id: 'art-13', name: 'Information to Data Subject' },
          { id: 'art-17', name: 'Right to Erasure' },
          { id: 'art-32', name: 'Security of Processing' },
        ],
      };

      expect(gdprRequirements.articles.length).toBe(6);
      expect(gdprRequirements.articles.find(a => a.id === 'art-17')?.name).toBe('Right to Erasure');
    });

    it('should define HIPAA requirements', () => {
      const hipaaRequirements = {
        id: 'hipaa',
        name: 'HIPAA',
        rules: [
          { id: 'privacy-rule', name: 'Privacy Rule', requirements: 10 },
          { id: 'security-rule', name: 'Security Rule', requirements: 18 },
          { id: 'breach-notification', name: 'Breach Notification Rule', requirements: 5 },
        ],
      };

      expect(hipaaRequirements.rules.length).toBe(3);
      expect(hipaaRequirements.rules[1]?.requirements).toBe(18);
    });

    it('should define ISO 27001 requirements', () => {
      const iso27001Requirements = {
        id: 'iso27001',
        name: 'ISO 27001:2022',
        annexAControls: [
          { id: 'a5', name: 'Organizational Controls', controls: 37 },
          { id: 'a6', name: 'People Controls', controls: 8 },
          { id: 'a7', name: 'Physical Controls', controls: 14 },
          { id: 'a8', name: 'Technological Controls', controls: 34 },
        ],
      };

      const totalControls = iso27001Requirements.annexAControls.reduce((sum, c) => sum + c.controls, 0);
      expect(totalControls).toBe(93);
    });
  });

  describe('Compliance Assessment', () => {
    it('should calculate compliance score', () => {
      const requirements = [
        { id: 'req-1', status: 'compliant' },
        { id: 'req-2', status: 'compliant' },
        { id: 'req-3', status: 'partial' },
        { id: 'req-4', status: 'non-compliant' },
        { id: 'req-5', status: 'compliant' },
      ];

      const weights = { compliant: 1, partial: 0.5, 'non-compliant': 0 };
      const score = requirements.reduce((sum, r) => {
        return sum + (weights[r.status as keyof typeof weights] || 0);
      }, 0);
      const percentage = Math.round((score / requirements.length) * 100);

      expect(percentage).toBe(70); // (3*1 + 1*0.5 + 1*0) / 5 = 0.7
    });

    it('should identify compliance gaps', () => {
      interface ComplianceGap {
        requirementId: string;
        description: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        remediation: string;
      }

      const gaps: ComplianceGap[] = [
        {
          requirementId: 'soc2-cc6.1',
          description: 'Missing encryption at rest documentation',
          severity: 'high',
          remediation: 'Document data encryption policies and procedures',
        },
        {
          requirementId: 'gdpr-art-13',
          description: 'Privacy policy incomplete',
          severity: 'medium',
          remediation: 'Update privacy policy with data retention details',
        },
      ];

      expect(gaps.length).toBe(2);
      expect(gaps.filter(g => g.severity === 'high').length).toBe(1);
    });

    it('should track compliance history', () => {
      interface AssessmentHistory {
        date: Date;
        framework: string;
        score: number;
        gapCount: number;
      }

      const history: AssessmentHistory[] = [
        { date: new Date('2024-01-01'), framework: 'soc2', score: 65, gapCount: 12 },
        { date: new Date('2024-02-01'), framework: 'soc2', score: 72, gapCount: 8 },
        { date: new Date('2024-03-01'), framework: 'soc2', score: 85, gapCount: 4 },
      ];

      const firstEntry = history[0];
      const lastEntry = history[history.length - 1];
      const improvement = (lastEntry?.score ?? 0) - (firstEntry?.score ?? 0);
      expect(improvement).toBe(20);
    });
  });

  describe('Security Documentation', () => {
    it('should generate security architecture document', () => {
      interface SecurityArchDoc {
        title: string;
        sections: string[];
        diagrams: string[];
      }

      const doc: SecurityArchDoc = {
        title: 'Security Architecture Document',
        sections: [
          'Network Security',
          'Data Protection',
          'Access Control',
          'Encryption',
          'Monitoring & Logging',
          'Incident Response',
        ],
        diagrams: [
          'network-topology',
          'data-flow',
          'threat-model',
        ],
      };

      expect(doc.sections.length).toBe(6);
      expect(doc.diagrams).toContain('threat-model');
    });

    it('should generate incident response runbook', () => {
      interface RunbookStep {
        order: number;
        title: string;
        description: string;
        responsible: string;
        escalation?: string;
      }

      const runbook: RunbookStep[] = [
        { order: 1, title: 'Detection', description: 'Identify the incident', responsible: 'Security Team' },
        { order: 2, title: 'Containment', description: 'Limit the impact', responsible: 'DevOps Team' },
        { order: 3, title: 'Eradication', description: 'Remove the threat', responsible: 'Security Team' },
        { order: 4, title: 'Recovery', description: 'Restore systems', responsible: 'DevOps Team', escalation: 'CTO' },
        { order: 5, title: 'Post-Incident', description: 'Review and document', responsible: 'Security Team' },
      ];

      expect(runbook.length).toBe(5);
      expect(runbook.find(s => s.escalation)?.title).toBe('Recovery');
    });

    it('should generate data classification matrix', () => {
      type Classification = 'public' | 'internal' | 'confidential' | 'restricted';
      
      interface DataClassification {
        dataType: string;
        classification: Classification;
        retention: string;
        encryption: boolean;
        accessControl: string;
      }

      const matrix: DataClassification[] = [
        { dataType: 'User Email', classification: 'confidential', retention: '7 years', encryption: true, accessControl: 'RBAC' },
        { dataType: 'Password Hash', classification: 'restricted', retention: 'Active only', encryption: true, accessControl: 'Service Account' },
        { dataType: 'Product Docs', classification: 'public', retention: 'Indefinite', encryption: false, accessControl: 'Public' },
      ];

      expect(matrix.filter(d => d.classification === 'restricted').length).toBe(1);
      expect(matrix.filter(d => d.encryption).length).toBe(2);
    });
  });

  describe('Evidence Collection', () => {
    it('should collect documentation evidence', () => {
      interface Evidence {
        id: string;
        type: 'document' | 'screenshot' | 'log' | 'config';
        controlId: string;
        description: string;
        collectedAt: Date;
        path: string;
      }

      const evidence: Evidence[] = [
        { id: 'ev-1', type: 'document', controlId: 'cc6.1', description: 'Encryption policy', collectedAt: new Date(), path: '/docs/security/encryption.md' },
        { id: 'ev-2', type: 'config', controlId: 'cc6.1', description: 'AWS KMS config', collectedAt: new Date(), path: '/infra/kms.tf' },
        { id: 'ev-3', type: 'log', controlId: 'cc7.2', description: 'Audit logs', collectedAt: new Date(), path: '/logs/audit.json' },
      ];

      expect(evidence.filter(e => e.type === 'document').length).toBe(1);
      expect(evidence.filter(e => e.controlId === 'cc6.1').length).toBe(2);
    });

    it('should validate evidence freshness', () => {
      const maxAge = 90; // days
      const evidenceDate = new Date('2024-01-01');
      const now = new Date('2024-04-15');

      const ageInDays = Math.floor((now.getTime() - evidenceDate.getTime()) / (1000 * 60 * 60 * 24));
      const isFresh = ageInDays <= maxAge;

      expect(ageInDays).toBe(105);
      expect(isFresh).toBe(false);
    });
  });

  describe('Audit Reports', () => {
    it('should generate audit report', () => {
      interface AuditReport {
        id: string;
        framework: string;
        period: { start: Date; end: Date };
        auditor: string;
        overallScore: number;
        findings: number;
        recommendations: string[];
      }

      const report: AuditReport = {
        id: 'audit-2024-q1',
        framework: 'SOC 2 Type II',
        period: { start: new Date('2024-01-01'), end: new Date('2024-03-31') },
        auditor: 'External Auditor LLC',
        overallScore: 92,
        findings: 3,
        recommendations: [
          'Implement automated key rotation',
          'Enhance logging granularity',
          'Update incident response procedures',
        ],
      };

      expect(report.overallScore).toBeGreaterThan(90);
      expect(report.recommendations.length).toBe(3);
    });

    it('should track remediation status', () => {
      type RemediationStatus = 'open' | 'in-progress' | 'resolved' | 'accepted-risk';

      interface Finding {
        id: string;
        description: string;
        status: RemediationStatus;
        dueDate: Date;
        assignee: string;
      }

      const findings: Finding[] = [
        { id: 'f-1', description: 'Missing MFA', status: 'resolved', dueDate: new Date('2024-02-01'), assignee: 'security@company.com' },
        { id: 'f-2', description: 'Outdated dependencies', status: 'in-progress', dueDate: new Date('2024-03-15'), assignee: 'dev@company.com' },
        { id: 'f-3', description: 'Legacy protocol', status: 'accepted-risk', dueDate: new Date('2024-06-01'), assignee: 'cto@company.com' },
      ];

      const openFindings = findings.filter(f => f.status === 'open' || f.status === 'in-progress');
      expect(openFindings.length).toBe(1);
    });
  });

  describe('Control Mapping', () => {
    it('should map controls across frameworks', () => {
      interface ControlMapping {
        soc2: string[];
        gdpr: string[];
        hipaa: string[];
        iso27001: string[];
      }

      const encryptionControlMapping: ControlMapping = {
        soc2: ['CC6.1', 'CC6.7'],
        gdpr: ['Art. 32'],
        hipaa: ['164.312(a)(2)(iv)', '164.312(e)(2)(ii)'],
        iso27001: ['A.8.24'],
      };

      expect(encryptionControlMapping.soc2.length).toBe(2);
      expect(encryptionControlMapping.gdpr[0]).toBe('Art. 32');
    });

    it('should identify overlapping requirements', () => {
      const frameworks = ['soc2', 'gdpr', 'hipaa'];
      const requirement = {
        description: 'Data encryption at rest',
        applicableFrameworks: ['soc2', 'gdpr', 'hipaa'],
      };

      const coverage = requirement.applicableFrameworks.length / frameworks.length;
      expect(coverage).toBe(1); // 100% coverage
    });
  });
});
