/**
 * Compliance Assessment Service
 *
 * Analyzes codebase against compliance frameworks (SOC2, HIPAA, GDPR, etc.)
 * and auto-generates compliance documentation.
 */

import { prisma } from '@docsynth/database';
import { createLogger, getAnthropicClient } from '@docsynth/utils';
import { createInstallationOctokit } from '@docsynth/github';

const log = createLogger('compliance-assessment-service');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface ComplianceFramework {
  id: string;
  name: string;
  version: string;
  description: string;
  controls: ComplianceControlDef[];
}

export interface ComplianceControlDef {
  controlId: string;
  title: string;
  description: string;
  category: string;
  codePatterns: string[];
  docRequirements: string[];
  evidenceTypes: string[];
  priority: 'required' | 'recommended' | 'optional';
}

export interface ControlAssessmentResult {
  controlId: string;
  status: 'compliant' | 'partial' | 'non_compliant' | 'not_applicable';
  score: number;
  evidenceFound: Evidence[];
  gaps: string[];
  recommendations: string[];
  remediationSteps: string[];
}

export interface Evidence {
  type: 'code' | 'config' | 'documentation' | 'test';
  path: string;
  description: string;
  confidence: number;
  excerpt?: string;
}

// ============================================================================
// Framework Definitions
// ============================================================================

const COMPLIANCE_FRAMEWORKS: Record<string, ComplianceFramework> = {
  SOC2: {
    id: 'soc2',
    name: 'SOC 2 Type II',
    version: '2024',
    description: 'Service Organization Control 2 - Trust Services Criteria',
    controls: [
      {
        controlId: 'CC6.1',
        title: 'Logical and Physical Access Controls',
        description: 'The entity implements logical access security software, infrastructure, and architectures over protected information assets.',
        category: 'access_control',
        codePatterns: [
          'authentication',
          'authorization',
          'jwt',
          'oauth',
          'rbac',
          'access.*control',
          'permission',
          'role',
        ],
        docRequirements: [
          'Access control policy',
          'Authentication mechanism documentation',
          'Authorization model',
        ],
        evidenceTypes: ['auth_middleware', 'rbac_implementation', 'session_management'],
        priority: 'required',
      },
      {
        controlId: 'CC6.6',
        title: 'Encryption of Data',
        description: 'The entity implements controls to protect data during transmission and at rest.',
        category: 'encryption',
        codePatterns: [
          'encrypt',
          'crypto',
          'bcrypt',
          'argon2',
          'aes',
          'rsa',
          'ssl',
          'tls',
          'https',
        ],
        docRequirements: [
          'Encryption standards',
          'Key management procedures',
          'Data classification',
        ],
        evidenceTypes: ['encryption_implementation', 'key_management', 'secure_transport'],
        priority: 'required',
      },
      {
        controlId: 'CC7.2',
        title: 'System Monitoring',
        description: 'The entity monitors system components and the operation of those components for anomalies.',
        category: 'monitoring',
        codePatterns: [
          'log',
          'logger',
          'audit',
          'monitor',
          'alert',
          'metric',
          'trace',
          'observability',
        ],
        docRequirements: [
          'Logging policy',
          'Monitoring procedures',
          'Incident response plan',
        ],
        evidenceTypes: ['logging_implementation', 'monitoring_setup', 'alerting_config'],
        priority: 'required',
      },
      {
        controlId: 'CC8.1',
        title: 'Change Management',
        description: 'The entity authorizes, designs, develops or acquires, configures, documents, tests, approves, and implements changes.',
        category: 'change_management',
        codePatterns: [
          'ci/cd',
          'pipeline',
          'deploy',
          'release',
          'version',
          'migration',
          'changelog',
        ],
        docRequirements: [
          'Change management policy',
          'Release procedures',
          'Testing requirements',
        ],
        evidenceTypes: ['ci_cd_config', 'deployment_docs', 'version_control'],
        priority: 'required',
      },
    ],
  },
  HIPAA: {
    id: 'hipaa',
    name: 'HIPAA Security Rule',
    version: '2024',
    description: 'Health Insurance Portability and Accountability Act',
    controls: [
      {
        controlId: '164.312(a)(1)',
        title: 'Access Control',
        description: 'Implement technical policies and procedures for electronic information systems that maintain ePHI.',
        category: 'access_control',
        codePatterns: [
          'authentication',
          'authorization',
          'access.*control',
          'phi',
          'protected.*health',
          'patient.*data',
        ],
        docRequirements: [
          'Access control procedures',
          'User authentication policy',
          'Emergency access procedures',
        ],
        evidenceTypes: ['auth_implementation', 'access_logging', 'emergency_access'],
        priority: 'required',
      },
      {
        controlId: '164.312(c)(1)',
        title: 'Integrity Controls',
        description: 'Implement policies and procedures to protect ePHI from improper alteration or destruction.',
        category: 'data_integrity',
        codePatterns: [
          'integrity',
          'checksum',
          'hash',
          'validation',
          'audit.*trail',
          'immutable',
        ],
        docRequirements: [
          'Data integrity policy',
          'Validation procedures',
          'Audit trail requirements',
        ],
        evidenceTypes: ['data_validation', 'audit_logging', 'integrity_checks'],
        priority: 'required',
      },
      {
        controlId: '164.312(e)(1)',
        title: 'Transmission Security',
        description: 'Implement technical security measures to guard against unauthorized access to ePHI being transmitted.',
        category: 'encryption',
        codePatterns: [
          'encrypt',
          'tls',
          'ssl',
          'https',
          'secure.*transport',
          'end.*to.*end',
        ],
        docRequirements: [
          'Transmission security policy',
          'Encryption standards',
          'Network security procedures',
        ],
        evidenceTypes: ['transport_encryption', 'network_security', 'encryption_config'],
        priority: 'required',
      },
    ],
  },
  GDPR: {
    id: 'gdpr',
    name: 'GDPR',
    version: '2024',
    description: 'General Data Protection Regulation',
    controls: [
      {
        controlId: 'Art.5',
        title: 'Principles of Processing',
        description: 'Personal data shall be processed lawfully, fairly, and in a transparent manner.',
        category: 'data_processing',
        codePatterns: [
          'consent',
          'privacy',
          'personal.*data',
          'pii',
          'gdpr',
          'data.*subject',
        ],
        docRequirements: [
          'Privacy policy',
          'Data processing agreements',
          'Lawful basis documentation',
        ],
        evidenceTypes: ['consent_management', 'privacy_implementation', 'data_mapping'],
        priority: 'required',
      },
      {
        controlId: 'Art.17',
        title: 'Right to Erasure',
        description: 'The data subject has the right to obtain erasure of personal data.',
        category: 'data_subject_rights',
        codePatterns: [
          'delete.*user',
          'erase',
          'forget',
          'right.*to.*be.*forgotten',
          'data.*deletion',
        ],
        docRequirements: [
          'Data deletion procedures',
          'Right to erasure policy',
          'Retention schedules',
        ],
        evidenceTypes: ['deletion_implementation', 'retention_policy', 'erasure_procedures'],
        priority: 'required',
      },
      {
        controlId: 'Art.32',
        title: 'Security of Processing',
        description: 'Implement appropriate technical and organizational measures to ensure security.',
        category: 'security',
        codePatterns: [
          'encrypt',
          'pseudonym',
          'security',
          'protect',
          'confidential',
        ],
        docRequirements: [
          'Security measures documentation',
          'Risk assessment',
          'Security policies',
        ],
        evidenceTypes: ['security_implementation', 'risk_assessment', 'security_config'],
        priority: 'required',
      },
    ],
  },
};

// ============================================================================
// Compliance Assessment Service
// ============================================================================

export class ComplianceAssessmentService {
  /**
   * Get available compliance frameworks
   */
  getFrameworks(): ComplianceFramework[] {
    return Object.values(COMPLIANCE_FRAMEWORKS);
  }

  /**
   * Get a specific framework
   */
  getFramework(frameworkId: string): ComplianceFramework | null {
    return COMPLIANCE_FRAMEWORKS[frameworkId.toUpperCase()] || null;
  }

  /**
   * Assess repository against a compliance framework
   */
  async assessCompliance(
    repositoryId: string,
    reportId: string,
    installationId: number,
    owner: string,
    repo: string,
    framework: string,
    controlIds?: string[]
  ): Promise<{ assessmentsCreated: number; overallScore: number }> {
    log.info({ repositoryId, framework }, 'Starting compliance assessment');

    const frameworkDef = this.getFramework(framework);
    if (!frameworkDef) {
      throw new Error(`Unknown framework: ${framework}`);
    }

    const octokit = createInstallationOctokit(installationId);
    if (!octokit) {
      throw new Error('Failed to get GitHub client');
    }

    // Get controls to assess
    const controlsToAssess = controlIds
      ? frameworkDef.controls.filter((c) => controlIds.includes(c.controlId))
      : frameworkDef.controls;

    // Ensure controls exist in database
    for (const control of controlsToAssess) {
      await this.ensureControlExists(reportId, control);
    }

    // Get repository content for analysis
    const { data: repoTree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: 'HEAD',
      recursive: 'true',
    });

    // Get existing documents
    const documents = await prisma.document.findMany({
      where: { repositoryId },
      select: { path: true, content: true, type: true },
    });

    // Analyze each control
    let totalScore = 0;
    let assessmentsCreated = 0;

    for (const control of controlsToAssess) {
      const result = await this.assessControl(
        control,
        repoTree.tree,
        documents,
        octokit,
        owner,
        repo
      );

      // Store assessment
      const dbControl = await db.complianceControl.findFirst({
        where: { controlId: control.controlId },
        select: { id: true },
      });

      if (dbControl) {
        await db.complianceControlAssessment.upsert({
          where: {
            reportId_controlId: {
              reportId,
              controlId: dbControl.id,
            },
          },
          create: {
            reportId,
            controlId: dbControl.id,
            status: result.status,
            score: result.score,
            evidenceFound: result.evidenceFound,
            gaps: result.gaps,
            recommendations: result.recommendations,
            remediationSteps: result.remediationSteps,
          },
          update: {
            status: result.status,
            score: result.score,
            evidenceFound: result.evidenceFound,
            gaps: result.gaps,
            recommendations: result.recommendations,
            remediationSteps: result.remediationSteps,
          },
        });

        assessmentsCreated++;
        totalScore += result.score;
      }
    }

    const overallScore =
      controlsToAssess.length > 0 ? Math.round(totalScore / controlsToAssess.length) : 0;

    // Update report
    await db.complianceReport.update({
      where: { id: reportId },
      data: {
        status: 'completed',
        overallScore,
      },
    });

    log.info({ repositoryId, framework, overallScore, assessmentsCreated }, 'Assessment complete');
    return { assessmentsCreated, overallScore };
  }

  /**
   * Ensure control exists in database
   */
  private async ensureControlExists(
    reportId: string,
    control: ComplianceControlDef
  ): Promise<void> {
    // Get template ID from report
    const report = await db.complianceReport.findUnique({
      where: { id: reportId },
      select: { templateId: true },
    });

    if (!report) return;

    await db.complianceControl.upsert({
      where: {
        templateId_controlId: {
          templateId: report.templateId,
          controlId: control.controlId,
        },
      },
      create: {
        templateId: report.templateId,
        controlId: control.controlId,
        title: control.title,
        description: control.description,
        category: control.category,
        codePatterns: control.codePatterns,
        docRequirements: control.docRequirements,
        evidenceTypes: control.evidenceTypes,
        priority: control.priority,
      },
      update: {
        title: control.title,
        description: control.description,
      },
    });
  }

  /**
   * Assess a single control
   */
  private async assessControl(
    control: ComplianceControlDef,
    repoTree: Array<{ path?: string; sha?: string; type?: string }>,
    documents: Array<{ path: string; content: string; type: string }>,
    octokit: Awaited<ReturnType<typeof createInstallationOctokit>>,
    owner: string,
    repo: string
  ): Promise<ControlAssessmentResult> {
    const evidenceFound: Evidence[] = [];
    const gaps: string[] = [];
    const recommendations: string[] = [];
    const remediationSteps: string[] = [];

    if (!octokit) {
      return {
        controlId: control.controlId,
        status: 'non_compliant',
        score: 0,
        evidenceFound: [],
        gaps: ['Unable to analyze repository'],
        recommendations: [],
        remediationSteps: [],
      };
    }

    // Search for code patterns
    for (const pattern of control.codePatterns) {
      const matchingFiles = repoTree.filter(
        (f) =>
          f.type === 'blob' &&
          f.path &&
          (f.path.endsWith('.ts') ||
            f.path.endsWith('.js') ||
            f.path.endsWith('.py') ||
            f.path.endsWith('.go') ||
            f.path.endsWith('.java'))
      );

      for (const file of matchingFiles.slice(0, 50)) {
        if (!file.sha || !file.path) continue;

        try {
          const { data: blob } = await octokit.git.getBlob({
            owner,
            repo,
            file_sha: file.sha,
          });

          const content = Buffer.from(blob.content, 'base64').toString('utf-8');
          const regex = new RegExp(pattern, 'gi');
          const matches = content.match(regex);

          if (matches && matches.length > 0) {
            evidenceFound.push({
              type: 'code',
              path: file.path,
              description: `Found ${matches.length} occurrences of pattern "${pattern}"`,
              confidence: 0.7,
            });
            break; // Found evidence for this pattern
          }
        } catch {
          // Skip files we can't read
        }
      }
    }

    // Check documentation coverage
    for (const docReq of control.docRequirements) {
      const docFound = documents.some(
        (d) =>
          d.content.toLowerCase().includes(docReq.toLowerCase()) ||
          d.path.toLowerCase().includes(docReq.toLowerCase().replace(/\s+/g, '-'))
      );

      if (docFound) {
        evidenceFound.push({
          type: 'documentation',
          path: 'docs',
          description: `Documentation found for: ${docReq}`,
          confidence: 0.6,
        });
      } else {
        gaps.push(`Missing documentation: ${docReq}`);
        recommendations.push(`Create documentation for: ${docReq}`);
      }
    }

    // Calculate score
    const codeEvidence = evidenceFound.filter((e) => e.type === 'code').length;
    const docEvidence = evidenceFound.filter((e) => e.type === 'documentation').length;
    const totalPatterns = control.codePatterns.length;
    const totalDocs = control.docRequirements.length;

    const codeScore = totalPatterns > 0 ? (codeEvidence / totalPatterns) * 50 : 25;
    const docScore = totalDocs > 0 ? (docEvidence / totalDocs) * 50 : 25;
    const score = Math.round(codeScore + docScore);

    // Determine status
    let status: ControlAssessmentResult['status'];
    if (score >= 80) {
      status = 'compliant';
    } else if (score >= 50) {
      status = 'partial';
    } else if (evidenceFound.length === 0 && this.isNotApplicable(control)) {
      status = 'not_applicable';
    } else {
      status = 'non_compliant';
    }

    // Generate remediation steps
    if (status !== 'compliant' && status !== 'not_applicable') {
      remediationSteps.push(...(await this.generateRemediationSteps(control, gaps)));
    }

    return {
      controlId: control.controlId,
      status,
      score,
      evidenceFound,
      gaps,
      recommendations,
      remediationSteps,
    };
  }

  /**
   * Check if a control might not be applicable
   */
  private isNotApplicable(control: ComplianceControlDef): boolean {
    // Simple heuristic - could be enhanced
    return control.priority === 'optional';
  }

  /**
   * Generate remediation steps using AI
   */
  private async generateRemediationSteps(
    control: ComplianceControlDef,
    gaps: string[]
  ): Promise<string[]> {
    if (gaps.length === 0) {
      return [];
    }

    const anthropic = getAnthropicClient();
    if (!anthropic) {
      return gaps.map((g) => `Address: ${g}`);
    }

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: `Generate specific remediation steps for the following compliance control gaps.

Control: ${control.title} (${control.controlId})
Description: ${control.description}

Gaps identified:
${gaps.map((g) => `- ${g}`).join('\n')}

Provide 3-5 actionable remediation steps. Return as JSON array of strings:
["Step 1", "Step 2", ...]`,
          },
        ],
      });

      const content =
        response.content[0]?.type === 'text' ? response.content[0].text : null;

      if (content) {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as string[];
        }
      }
    } catch (error) {
      log.warn({ error }, 'Failed to generate remediation steps');
    }

    return gaps.map((g) => `Address: ${g}`);
  }

  /**
   * Generate compliance documentation
   */
  async generateComplianceDoc(
    reportId: string,
    framework: string
  ): Promise<string> {
    const report = await db.complianceReport.findUnique({
      where: { id: reportId },
      include: {
        controlAssessments: {
          include: {
            control: true,
          },
        },
      },
    });

    if (!report) {
      throw new Error('Report not found');
    }

    const frameworkDef = this.getFramework(framework);
    if (!frameworkDef) {
      throw new Error(`Unknown framework: ${framework}`);
    }

    // Build documentation
    let doc = `# ${frameworkDef.name} Compliance Report\n\n`;
    doc += `**Generated:** ${new Date().toISOString()}\n`;
    doc += `**Overall Score:** ${report.overallScore}%\n\n`;

    doc += `## Executive Summary\n\n`;
    const compliant = report.controlAssessments.filter(
      (a: { status: string }) => a.status === 'compliant'
    ).length;
    const partial = report.controlAssessments.filter(
      (a: { status: string }) => a.status === 'partial'
    ).length;
    const nonCompliant = report.controlAssessments.filter(
      (a: { status: string }) => a.status === 'non_compliant'
    ).length;

    doc += `| Status | Count |\n`;
    doc += `|--------|-------|\n`;
    doc += `| Compliant | ${compliant} |\n`;
    doc += `| Partial | ${partial} |\n`;
    doc += `| Non-Compliant | ${nonCompliant} |\n\n`;

    doc += `## Control Assessments\n\n`;

    // Group by category
    const byCategory = new Map<string, typeof report.controlAssessments>();
    for (const assessment of report.controlAssessments) {
      const category = assessment.control.category;
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category)!.push(assessment);
    }

    for (const [category, assessments] of byCategory) {
      doc += `### ${category.replace(/_/g, ' ').toUpperCase()}\n\n`;

      for (const assessment of assessments) {
        const statusIcon =
          assessment.status === 'compliant'
            ? '✅'
            : assessment.status === 'partial'
              ? '⚠️'
              : assessment.status === 'not_applicable'
                ? '➖'
                : '❌';

        doc += `#### ${statusIcon} ${assessment.control.controlId}: ${assessment.control.title}\n\n`;
        doc += `**Score:** ${assessment.score}%\n\n`;
        doc += `${assessment.control.description}\n\n`;

        if ((assessment.evidenceFound as Evidence[]).length > 0) {
          doc += `**Evidence Found:**\n`;
          for (const evidence of assessment.evidenceFound as Evidence[]) {
            doc += `- ${evidence.description} (${evidence.path})\n`;
          }
          doc += `\n`;
        }

        if ((assessment.gaps as string[]).length > 0) {
          doc += `**Gaps:**\n`;
          for (const gap of assessment.gaps as string[]) {
            doc += `- ${gap}\n`;
          }
          doc += `\n`;
        }

        if ((assessment.remediationSteps as string[]).length > 0) {
          doc += `**Remediation Steps:**\n`;
          for (const step of assessment.remediationSteps as string[]) {
            doc += `1. ${step}\n`;
          }
          doc += `\n`;
        }
      }
    }

    // Update report with generated doc
    await db.complianceReport.update({
      where: { id: reportId },
      data: { generatedDoc: doc },
    });

    return doc;
  }
}

export const complianceAssessmentService = new ComplianceAssessmentService();
