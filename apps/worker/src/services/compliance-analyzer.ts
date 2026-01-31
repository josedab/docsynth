import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '@docsynth/utils';

const log = createLogger('compliance-analyzer');

type ComplianceFramework = 'SOC2' | 'HIPAA' | 'GDPR' | 'PCI-DSS' | 'ISO27001';

interface ComplianceRequirement {
  id: string;
  framework: ComplianceFramework;
  category: string;
  requirement: string;
  description: string;
  documentationNeeded: string[];
  codePatterns?: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface ComplianceFinding {
  requirementId: string;
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-applicable';
  evidence: string[];
  gaps: string[];
  recommendations: string[];
  documentationSuggestion?: string;
}

interface ComplianceReport {
  framework: ComplianceFramework;
  repositoryId: string;
  scanDate: string;
  overallScore: number;
  findings: ComplianceFinding[];
  summary: {
    compliant: number;
    partial: number;
    nonCompliant: number;
    notApplicable: number;
  };
  generatedDocumentation: Array<{
    requirementId: string;
    title: string;
    content: string;
  }>;
}

const COMPLIANCE_REQUIREMENTS: Record<ComplianceFramework, ComplianceRequirement[]> = {
  SOC2: [
    {
      id: 'SOC2-CC6.1',
      framework: 'SOC2',
      category: 'Logical and Physical Access Controls',
      requirement: 'Access to sensitive data is restricted',
      description: 'The entity implements logical and physical access controls to protect against unauthorized access',
      documentationNeeded: ['Access control policy', 'Authentication mechanisms', 'Authorization matrix'],
      codePatterns: ['requireAuth', 'checkPermission', 'authorize', 'authenticated', 'accessControl'],
      severity: 'critical',
    },
    {
      id: 'SOC2-CC6.2',
      framework: 'SOC2',
      category: 'Logical and Physical Access Controls',
      requirement: 'User access is reviewed and managed',
      description: 'Prior to granting access, the entity verifies the identity of individuals',
      documentationNeeded: ['User provisioning process', 'Access review procedures'],
      codePatterns: ['createUser', 'grantAccess', 'revokeAccess', 'userRole'],
      severity: 'high',
    },
    {
      id: 'SOC2-CC7.1',
      framework: 'SOC2',
      category: 'System Operations',
      requirement: 'Vulnerabilities are detected and addressed',
      description: 'The entity monitors system components for security vulnerabilities',
      documentationNeeded: ['Vulnerability management policy', 'Patching procedures', 'Security scanning'],
      codePatterns: ['dependency', 'audit', 'scan', 'vulnerability'],
      severity: 'high',
    },
    {
      id: 'SOC2-CC8.1',
      framework: 'SOC2',
      category: 'Change Management',
      requirement: 'Changes are authorized and tested',
      description: 'The entity authorizes, designs, develops, and tests system changes',
      documentationNeeded: ['Change management policy', 'Testing procedures', 'Approval workflows'],
      codePatterns: ['review', 'approve', 'test', 'staging', 'deploy'],
      severity: 'high',
    },
    {
      id: 'SOC2-A1.2',
      framework: 'SOC2',
      category: 'Availability',
      requirement: 'System availability is monitored',
      description: 'The entity monitors system components for anomalies and failures',
      documentationNeeded: ['Monitoring procedures', 'Incident response plan', 'SLAs'],
      codePatterns: ['monitor', 'alert', 'health', 'metrics', 'logging'],
      severity: 'medium',
    },
  ],
  HIPAA: [
    {
      id: 'HIPAA-164.312.a.1',
      framework: 'HIPAA',
      category: 'Access Control',
      requirement: 'Unique user identification',
      description: 'Assign a unique name/number for identifying and tracking user identity',
      documentationNeeded: ['User identification policy', 'Authentication procedures'],
      codePatterns: ['userId', 'userIdentifier', 'uniqueId', 'authentication'],
      severity: 'critical',
    },
    {
      id: 'HIPAA-164.312.a.2.i',
      framework: 'HIPAA',
      category: 'Access Control',
      requirement: 'Automatic logoff',
      description: 'Implement procedures for terminating sessions after inactivity',
      documentationNeeded: ['Session management policy', 'Timeout configurations'],
      codePatterns: ['sessionTimeout', 'autoLogoff', 'inactivity', 'expire'],
      severity: 'high',
    },
    {
      id: 'HIPAA-164.312.b',
      framework: 'HIPAA',
      category: 'Audit Controls',
      requirement: 'Audit logging',
      description: 'Implement mechanisms to record and examine activity in systems containing ePHI',
      documentationNeeded: ['Audit logging policy', 'Log retention procedures', 'Access logs'],
      codePatterns: ['auditLog', 'audit', 'logAccess', 'trackActivity'],
      severity: 'critical',
    },
    {
      id: 'HIPAA-164.312.c.1',
      framework: 'HIPAA',
      category: 'Integrity',
      requirement: 'Data integrity controls',
      description: 'Implement mechanisms to ensure ePHI is not improperly altered or destroyed',
      documentationNeeded: ['Data integrity policy', 'Validation procedures', 'Checksums'],
      codePatterns: ['checksum', 'hash', 'validate', 'integrity', 'verify'],
      severity: 'high',
    },
    {
      id: 'HIPAA-164.312.e.1',
      framework: 'HIPAA',
      category: 'Transmission Security',
      requirement: 'Encryption in transit',
      description: 'Implement technical security measures to guard against unauthorized access during transmission',
      documentationNeeded: ['Encryption policy', 'TLS configuration', 'Certificate management'],
      codePatterns: ['https', 'tls', 'ssl', 'encrypt', 'secure'],
      severity: 'critical',
    },
  ],
  GDPR: [
    {
      id: 'GDPR-Art5.1.f',
      framework: 'GDPR',
      category: 'Data Security',
      requirement: 'Integrity and confidentiality',
      description: 'Personal data shall be processed in a manner that ensures appropriate security',
      documentationNeeded: ['Security policy', 'Encryption documentation', 'Access controls'],
      codePatterns: ['encrypt', 'secure', 'protect', 'confidential'],
      severity: 'critical',
    },
    {
      id: 'GDPR-Art17',
      framework: 'GDPR',
      category: 'Data Subject Rights',
      requirement: 'Right to erasure (right to be forgotten)',
      description: 'The data subject has the right to obtain erasure of personal data',
      documentationNeeded: ['Data deletion procedures', 'Retention policy', 'Erasure request handling'],
      codePatterns: ['delete', 'erase', 'remove', 'purge', 'forget'],
      severity: 'high',
    },
    {
      id: 'GDPR-Art20',
      framework: 'GDPR',
      category: 'Data Subject Rights',
      requirement: 'Right to data portability',
      description: 'The data subject has the right to receive their personal data in a structured format',
      documentationNeeded: ['Data export procedures', 'Data formats documentation'],
      codePatterns: ['export', 'download', 'portable', 'json', 'csv'],
      severity: 'medium',
    },
    {
      id: 'GDPR-Art25',
      framework: 'GDPR',
      category: 'Data Protection by Design',
      requirement: 'Privacy by design and by default',
      description: 'Implement appropriate technical measures to implement data protection principles',
      documentationNeeded: ['Privacy impact assessment', 'Data minimization policy', 'Default privacy settings'],
      codePatterns: ['privacy', 'consent', 'optIn', 'minimal', 'default'],
      severity: 'high',
    },
    {
      id: 'GDPR-Art33',
      framework: 'GDPR',
      category: 'Breach Notification',
      requirement: 'Notification of personal data breach',
      description: 'Notify supervisory authority within 72 hours of becoming aware of a breach',
      documentationNeeded: ['Incident response plan', 'Breach notification procedures', 'Contact lists'],
      codePatterns: ['breach', 'incident', 'notify', 'alert', 'response'],
      severity: 'critical',
    },
  ],
  'PCI-DSS': [
    {
      id: 'PCI-1.1',
      framework: 'PCI-DSS',
      category: 'Build and Maintain Secure Network',
      requirement: 'Install and maintain a firewall',
      description: 'Install and maintain a firewall configuration to protect cardholder data',
      documentationNeeded: ['Firewall rules documentation', 'Network diagrams', 'Configuration standards'],
      codePatterns: ['firewall', 'network', 'port', 'allow', 'deny'],
      severity: 'critical',
    },
    {
      id: 'PCI-3.4',
      framework: 'PCI-DSS',
      category: 'Protect Stored Cardholder Data',
      requirement: 'Render PAN unreadable',
      description: 'Render PAN unreadable anywhere it is stored using cryptographic methods',
      documentationNeeded: ['Encryption policy', 'Key management procedures', 'Tokenization documentation'],
      codePatterns: ['encrypt', 'token', 'mask', 'hash', 'pan'],
      severity: 'critical',
    },
    {
      id: 'PCI-6.5',
      framework: 'PCI-DSS',
      category: 'Maintain Vulnerability Management',
      requirement: 'Develop secure applications',
      description: 'Develop applications based on secure coding guidelines',
      documentationNeeded: ['Secure coding guidelines', 'Code review procedures', 'OWASP coverage'],
      codePatterns: ['sanitize', 'validate', 'escape', 'parameterized', 'prepared'],
      severity: 'high',
    },
    {
      id: 'PCI-8.2',
      framework: 'PCI-DSS',
      category: 'Access Control',
      requirement: 'Proper user authentication management',
      description: 'Employ at least one authentication method for all users',
      documentationNeeded: ['Authentication policy', 'Password policy', 'MFA documentation'],
      codePatterns: ['authenticate', 'password', 'mfa', 'twoFactor', '2fa'],
      severity: 'critical',
    },
    {
      id: 'PCI-10.1',
      framework: 'PCI-DSS',
      category: 'Track and Monitor Access',
      requirement: 'Implement audit trails',
      description: 'Implement audit trails to link all access to system components to individual users',
      documentationNeeded: ['Logging policy', 'Audit trail configuration', 'Log retention'],
      codePatterns: ['log', 'audit', 'track', 'trace', 'record'],
      severity: 'high',
    },
  ],
  ISO27001: [
    {
      id: 'ISO-A.9.2.1',
      framework: 'ISO27001',
      category: 'Access Control',
      requirement: 'User registration and de-registration',
      description: 'A formal user registration and de-registration process shall be implemented',
      documentationNeeded: ['User management procedures', 'Onboarding/offboarding documentation'],
      codePatterns: ['register', 'createUser', 'deleteUser', 'deactivate'],
      severity: 'high',
    },
    {
      id: 'ISO-A.10.1.1',
      framework: 'ISO27001',
      category: 'Cryptography',
      requirement: 'Policy on use of cryptographic controls',
      description: 'A policy on the use of cryptographic controls shall be developed',
      documentationNeeded: ['Cryptography policy', 'Key management procedures', 'Algorithm standards'],
      codePatterns: ['encrypt', 'decrypt', 'key', 'crypto', 'cipher'],
      severity: 'high',
    },
    {
      id: 'ISO-A.12.4.1',
      framework: 'ISO27001',
      category: 'Operations Security',
      requirement: 'Event logging',
      description: 'Event logs recording user activities and security events shall be produced',
      documentationNeeded: ['Logging policy', 'Event types documented', 'Log protection'],
      codePatterns: ['log', 'event', 'audit', 'record', 'track'],
      severity: 'medium',
    },
    {
      id: 'ISO-A.14.2.2',
      framework: 'ISO27001',
      category: 'System Development',
      requirement: 'System change control procedures',
      description: 'Changes to systems shall be controlled using formal change control procedures',
      documentationNeeded: ['Change management policy', 'Version control procedures', 'Review process'],
      codePatterns: ['version', 'commit', 'review', 'approve', 'release'],
      severity: 'medium',
    },
    {
      id: 'ISO-A.16.1.1',
      framework: 'ISO27001',
      category: 'Incident Management',
      requirement: 'Responsibilities and procedures',
      description: 'Management responsibilities and procedures shall be established for incident response',
      documentationNeeded: ['Incident response plan', 'Escalation procedures', 'Contact information'],
      codePatterns: ['incident', 'alert', 'escalate', 'respond', 'notify'],
      severity: 'high',
    },
  ],
};

export class ComplianceAnalyzerService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  getRequirements(framework: ComplianceFramework): ComplianceRequirement[] {
    return COMPLIANCE_REQUIREMENTS[framework] ?? [];
  }

  getAllFrameworks(): ComplianceFramework[] {
    return Object.keys(COMPLIANCE_REQUIREMENTS) as ComplianceFramework[];
  }

  async analyzeRepository(params: {
    repositoryId: string;
    framework: ComplianceFramework;
    codebaseSnapshot: string;
    existingDocumentation: string[];
  }): Promise<ComplianceReport> {
    log.info({ repositoryId: params.repositoryId, framework: params.framework }, 'Starting compliance analysis');

    const requirements = this.getRequirements(params.framework);
    const findings: ComplianceFinding[] = [];
    const generatedDocs: ComplianceReport['generatedDocumentation'] = [];

    for (const requirement of requirements) {
      const finding = await this.analyzeRequirement(requirement, params.codebaseSnapshot, params.existingDocumentation);
      findings.push(finding);

      // Generate documentation for gaps
      if (finding.status === 'non-compliant' || finding.status === 'partial') {
        const doc = await this.generateComplianceDocumentation(requirement, finding);
        if (doc) {
          generatedDocs.push(doc);
        }
      }
    }

    const summary = {
      compliant: findings.filter((f) => f.status === 'compliant').length,
      partial: findings.filter((f) => f.status === 'partial').length,
      nonCompliant: findings.filter((f) => f.status === 'non-compliant').length,
      notApplicable: findings.filter((f) => f.status === 'not-applicable').length,
    };

    const overallScore = Math.round(
      ((summary.compliant * 100 + summary.partial * 50 + summary.notApplicable * 100) /
        (findings.length * 100)) *
        100
    );

    const report: ComplianceReport = {
      framework: params.framework,
      repositoryId: params.repositoryId,
      scanDate: new Date().toISOString(),
      overallScore,
      findings,
      summary,
      generatedDocumentation: generatedDocs,
    };

    log.info(
      { repositoryId: params.repositoryId, framework: params.framework, score: overallScore },
      'Compliance analysis complete'
    );

    return report;
  }

  private async analyzeRequirement(
    requirement: ComplianceRequirement,
    codebaseSnapshot: string,
    existingDocs: string[]
  ): Promise<ComplianceFinding> {
    const docsContext = existingDocs.slice(0, 5).join('\n---\n');

    const prompt = `Analyze this codebase for compliance with the following requirement.

Requirement ID: ${requirement.id}
Framework: ${requirement.framework}
Category: ${requirement.category}
Requirement: ${requirement.requirement}
Description: ${requirement.description}
Documentation Needed: ${requirement.documentationNeeded.join(', ')}
Code Patterns to Look For: ${requirement.codePatterns?.join(', ') ?? 'N/A'}

Codebase Snapshot:
${codebaseSnapshot.slice(0, 8000)}

Existing Documentation:
${docsContext.slice(0, 4000)}

Analyze the codebase and documentation to determine compliance status.

Return a JSON object:
{
  "status": "compliant|partial|non-compliant|not-applicable",
  "evidence": ["List of specific evidence found that supports compliance"],
  "gaps": ["List of specific gaps or missing items"],
  "recommendations": ["Actionable recommendations to achieve/improve compliance"]
}

Guidelines:
- "compliant": All requirements are met with clear evidence
- "partial": Some requirements met but gaps exist
- "non-compliant": Requirements not met or no evidence found
- "not-applicable": Requirement doesn't apply to this codebase (e.g., no cardholder data for PCI)

Return ONLY valid JSON.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : content);

      return {
        requirementId: requirement.id,
        status: result.status ?? 'non-compliant',
        evidence: result.evidence ?? [],
        gaps: result.gaps ?? [],
        recommendations: result.recommendations ?? [],
      };
    } catch (error) {
      log.warn({ error, requirementId: requirement.id }, 'Failed to analyze requirement');
      return {
        requirementId: requirement.id,
        status: 'non-compliant',
        evidence: [],
        gaps: ['Unable to analyze due to processing error'],
        recommendations: ['Manual review recommended'],
      };
    }
  }

  private async generateComplianceDocumentation(
    requirement: ComplianceRequirement,
    finding: ComplianceFinding
  ): Promise<ComplianceReport['generatedDocumentation'][0] | null> {
    const prompt = `Generate compliance documentation to address the following gaps.

Requirement ID: ${requirement.id}
Framework: ${requirement.framework}
Requirement: ${requirement.requirement}
Description: ${requirement.description}
Documentation Needed: ${requirement.documentationNeeded.join(', ')}

Current Gaps:
${finding.gaps.join('\n')}

Recommendations:
${finding.recommendations.join('\n')}

Generate a documentation template that addresses these gaps. The document should:
1. Be professional and compliance-ready
2. Include placeholders [PLACEHOLDER] for organization-specific information
3. Follow best practices for ${requirement.framework} compliance
4. Be actionable and specific

Return ONLY the documentation content in markdown format.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';

      if (content.length < 100) {
        return null;
      }

      return {
        requirementId: requirement.id,
        title: `${requirement.framework} - ${requirement.category}: ${requirement.requirement}`,
        content,
      };
    } catch (error) {
      log.warn({ error, requirementId: requirement.id }, 'Failed to generate compliance documentation');
      return null;
    }
  }

  async generateFrameworkOverview(framework: ComplianceFramework): Promise<string> {
    const requirements = this.getRequirements(framework);

    let overview = `# ${framework} Compliance Requirements\n\n`;
    overview += `This document outlines the key ${framework} requirements relevant to software development.\n\n`;

    const categories = [...new Set(requirements.map((r) => r.category))];

    for (const category of categories) {
      overview += `## ${category}\n\n`;
      const categoryReqs = requirements.filter((r) => r.category === category);

      for (const req of categoryReqs) {
        overview += `### ${req.id}: ${req.requirement}\n\n`;
        overview += `**Description:** ${req.description}\n\n`;
        overview += `**Severity:** ${req.severity}\n\n`;
        overview += `**Documentation Needed:**\n`;
        for (const doc of req.documentationNeeded) {
          overview += `- ${doc}\n`;
        }
        overview += '\n';
      }
    }

    return overview;
  }

  scanCodeForPII(codeContent: string): Array<{ pattern: string; matches: string[]; line: number }> {
    const piiPatterns = [
      { name: 'Email', regex: /['"]?email['"]?\s*[:=]/gi },
      { name: 'Phone', regex: /['"]?(phone|mobile|tel)['"]?\s*[:=]/gi },
      { name: 'SSN', regex: /['"]?(ssn|social.?security)['"]?\s*[:=]/gi },
      { name: 'Credit Card', regex: /['"]?(card.?number|credit.?card|pan)['"]?\s*[:=]/gi },
      { name: 'Date of Birth', regex: /['"]?(dob|date.?of.?birth|birthday)['"]?\s*[:=]/gi },
      { name: 'Address', regex: /['"]?(address|street|city|zip.?code|postal)['"]?\s*[:=]/gi },
      { name: 'Name', regex: /['"]?(first.?name|last.?name|full.?name)['"]?\s*[:=]/gi },
      { name: 'Password', regex: /['"]?password['"]?\s*[:=]/gi },
      { name: 'API Key', regex: /['"]?(api.?key|secret.?key|auth.?token)['"]?\s*[:=]/gi },
    ];

    const findings: Array<{ pattern: string; matches: string[]; line: number }> = [];
    const lines = codeContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of piiPatterns) {
        const matches = line.match(pattern.regex);
        if (matches) {
          findings.push({
            pattern: pattern.name,
            matches,
            line: i + 1,
          });
        }
      }
    }

    return findings;
  }
}

export const complianceAnalyzer = new ComplianceAnalyzerService();
