import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError, createLogger, generateId, getAnthropicClient } from '@docsynth/utils';

const app = new Hono();
const log = createLogger('compliance-routes');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Compliance Framework Definitions
// ============================================================================

interface ComplianceFramework {
  id: string;
  name: string;
  version: string;
  description: string;
  controls: ComplianceControl[];
}

interface ComplianceControl {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  documentTypes: string[];
  requiredEvidence: string[];
}

const COMPLIANCE_FRAMEWORKS: Record<string, ComplianceFramework> = {
  'soc2-type2': {
    id: 'soc2-type2',
    name: 'SOC 2 Type II',
    version: '2017',
    description: 'Service Organization Control 2 Type II',
    controls: [
      {
        id: 'cc1.1',
        code: 'CC1.1',
        title: 'COSO Principle 1',
        description: 'The entity demonstrates a commitment to integrity and ethical values',
        category: 'Control Environment',
        documentTypes: ['code-of-conduct', 'security-policy'],
        requiredEvidence: ['code-of-conduct.md', 'ethics-policy.md'],
      },
      {
        id: 'cc6.1',
        code: 'CC6.1',
        title: 'Logical and Physical Access Controls',
        description: 'The entity implements logical access security software',
        category: 'Logical and Physical Access',
        documentTypes: ['access-control', 'authentication'],
        requiredEvidence: ['access-control-policy.md', 'mfa-guide.md'],
      },
      {
        id: 'cc7.1',
        code: 'CC7.1',
        title: 'System Operations',
        description: 'Detection and monitoring of security events',
        category: 'System Operations',
        documentTypes: ['monitoring', 'incident-response'],
        requiredEvidence: ['monitoring-guide.md', 'incident-response-plan.md'],
      },
      {
        id: 'cc8.1',
        code: 'CC8.1',
        title: 'Change Management',
        description: 'Changes to infrastructure and software are authorized',
        category: 'Change Management',
        documentTypes: ['change-management', 'deployment'],
        requiredEvidence: ['change-management-policy.md', 'deployment-guide.md'],
      },
    ],
  },
  'gdpr': {
    id: 'gdpr',
    name: 'GDPR',
    version: '2018',
    description: 'General Data Protection Regulation',
    controls: [
      {
        id: 'gdpr-5',
        code: 'Article 5',
        title: 'Principles of Processing',
        description: 'Lawfulness, fairness, transparency, purpose limitation, data minimization',
        category: 'Data Principles',
        documentTypes: ['privacy-policy', 'data-processing'],
        requiredEvidence: ['privacy-policy.md', 'data-processing-agreement.md'],
      },
      {
        id: 'gdpr-13',
        code: 'Article 13',
        title: 'Information to be Provided',
        description: 'Information about data collection and processing',
        category: 'Transparency',
        documentTypes: ['privacy-notice', 'consent-management'],
        requiredEvidence: ['privacy-notice.md', 'cookie-policy.md'],
      },
      {
        id: 'gdpr-32',
        code: 'Article 32',
        title: 'Security of Processing',
        description: 'Appropriate technical and organizational measures',
        category: 'Security',
        documentTypes: ['security-measures', 'encryption'],
        requiredEvidence: ['security-architecture.md', 'encryption-policy.md'],
      },
      {
        id: 'gdpr-33',
        code: 'Article 33',
        title: 'Breach Notification',
        description: 'Notification of personal data breaches',
        category: 'Incident Response',
        documentTypes: ['breach-notification', 'incident-response'],
        requiredEvidence: ['breach-notification-procedure.md'],
      },
    ],
  },
  'hipaa': {
    id: 'hipaa',
    name: 'HIPAA',
    version: '2013',
    description: 'Health Insurance Portability and Accountability Act',
    controls: [
      {
        id: 'hipaa-164.308',
        code: '164.308',
        title: 'Administrative Safeguards',
        description: 'Security management process, workforce security, access management',
        category: 'Administrative',
        documentTypes: ['security-management', 'workforce-training'],
        requiredEvidence: ['security-management-plan.md', 'training-guide.md'],
      },
      {
        id: 'hipaa-164.310',
        code: '164.310',
        title: 'Physical Safeguards',
        description: 'Facility access controls, workstation security',
        category: 'Physical',
        documentTypes: ['physical-security', 'workstation-policy'],
        requiredEvidence: ['physical-security-policy.md'],
      },
      {
        id: 'hipaa-164.312',
        code: '164.312',
        title: 'Technical Safeguards',
        description: 'Access controls, audit controls, integrity, transmission security',
        category: 'Technical',
        documentTypes: ['access-control', 'audit-logging', 'encryption'],
        requiredEvidence: ['technical-safeguards.md', 'audit-logging-guide.md'],
      },
    ],
  },
  'iso27001': {
    id: 'iso27001',
    name: 'ISO 27001',
    version: '2022',
    description: 'Information Security Management System',
    controls: [
      {
        id: 'iso-a5',
        code: 'A.5',
        title: 'Organizational Controls',
        description: 'Policies and organization of information security',
        category: 'Organizational',
        documentTypes: ['security-policy', 'roles-responsibilities'],
        requiredEvidence: ['isms-policy.md', 'security-roles.md'],
      },
      {
        id: 'iso-a8',
        code: 'A.8',
        title: 'Asset Management',
        description: 'Inventory and acceptable use of assets',
        category: 'Asset Management',
        documentTypes: ['asset-inventory', 'acceptable-use'],
        requiredEvidence: ['asset-management-policy.md'],
      },
    ],
  },
};

// ============================================================================
// Framework and Control Routes
// ============================================================================

// List available compliance frameworks
app.get('/frameworks', requireAuth, async (c) => {
  const frameworks = Object.values(COMPLIANCE_FRAMEWORKS).map(f => ({
    id: f.id,
    name: f.name,
    version: f.version,
    description: f.description,
    controlCount: f.controls.length,
  }));

  return c.json({
    success: true,
    data: frameworks,
  });
});

// Get framework details with controls
app.get('/frameworks/:frameworkId', requireAuth, async (c) => {
  const frameworkId = c.req.param('frameworkId');
  const framework = COMPLIANCE_FRAMEWORKS[frameworkId];

  if (!framework) {
    throw new NotFoundError('Framework', frameworkId);
  }

  return c.json({
    success: true,
    data: framework,
  });
});

// ============================================================================
// Compliance Assessment
// ============================================================================

// Run compliance assessment for a repository
app.post('/assess', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    frameworkId: string;
  }>();

  if (!body.repositoryId || !body.frameworkId) {
    throw new ValidationError('repositoryId and frameworkId are required');
  }

  const framework = COMPLIANCE_FRAMEWORKS[body.frameworkId];
  if (!framework) {
    throw new NotFoundError('Framework', body.frameworkId);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Get all documents for the repository
  const documents = await prisma.document.findMany({
    where: { repositoryId: body.repositoryId },
    select: { id: true, path: true, title: true, type: true, content: true },
  });

  // Assess each control
  const assessments: Array<{
    controlId: string;
    controlCode: string;
    status: 'compliant' | 'partial' | 'non-compliant' | 'not-assessed';
    score: number;
    evidenceFound: string[];
    gaps: string[];
    recommendations: string[];
  }> = [];

  for (const control of framework.controls) {
    // Find relevant documents
    const relevantDocs = documents.filter(doc => 
      control.documentTypes.some(type => 
        doc.path.toLowerCase().includes(type) ||
        doc.title.toLowerCase().includes(type) ||
        (doc.type as string).toLowerCase().includes(type)
      )
    );

    if (relevantDocs.length === 0) {
      assessments.push({
        controlId: control.id,
        controlCode: control.code,
        status: 'non-compliant',
        score: 0,
        evidenceFound: [],
        gaps: [`No documentation found for ${control.title}`],
        recommendations: [`Create documentation covering: ${control.description}`],
      });
      continue;
    }

    // Use AI to assess compliance
    const docContents = relevantDocs
      .map(d => `## ${d.title}\n${d.content.slice(0, 1000)}`)
      .join('\n\n');

    const anthropic = getAnthropicClient();
    if (!anthropic) {
      throw new Error('Anthropic client not available');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Assess compliance for this control:

Control: ${control.code} - ${control.title}
Description: ${control.description}
Required Evidence: ${control.requiredEvidence.join(', ')}

Documentation found:
${docContents}

Return JSON:
{
  "status": "compliant|partial|non-compliant",
  "score": 0-100,
  "evidenceFound": ["list of evidence items found"],
  "gaps": ["list of gaps or missing items"],
  "recommendations": ["list of specific recommendations"]
}

Return ONLY JSON.`,
        },
      ],
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    
    try {
      const assessment = JSON.parse(content);
      assessments.push({
        controlId: control.id,
        controlCode: control.code,
        status: assessment.status || 'not-assessed',
        score: assessment.score || 0,
        evidenceFound: assessment.evidenceFound || [],
        gaps: assessment.gaps || [],
        recommendations: assessment.recommendations || [],
      });
    } catch {
      assessments.push({
        controlId: control.id,
        controlCode: control.code,
        status: 'partial',
        score: 50,
        evidenceFound: relevantDocs.map(d => d.path),
        gaps: ['Unable to fully assess - manual review recommended'],
        recommendations: [],
      });
    }
  }

  // Calculate overall score
  const overallScore = Math.round(
    assessments.reduce((acc, a) => acc + a.score, 0) / assessments.length
  );

  const compliantCount = assessments.filter(a => a.status === 'compliant').length;
  const partialCount = assessments.filter(a => a.status === 'partial').length;
  const nonCompliantCount = assessments.filter(a => a.status === 'non-compliant').length;

  // Store assessment
  const assessmentRecord = await db.complianceAssessment.create({
    data: {
      id: generateId('assess'),
      repositoryId: body.repositoryId,
      organizationId: orgId,
      frameworkId: body.frameworkId,
      frameworkName: framework.name,
      overallScore,
      compliantCount,
      partialCount,
      nonCompliantCount,
      controlAssessments: assessments,
      status: 'completed',
    },
  });

  log.info({
    assessmentId: assessmentRecord.id,
    framework: framework.name,
    overallScore,
  }, 'Compliance assessment completed');

  return c.json({
    success: true,
    data: {
      id: assessmentRecord.id,
      repositoryId: body.repositoryId,
      framework: {
        id: framework.id,
        name: framework.name,
      },
      overallScore,
      summary: {
        compliant: compliantCount,
        partial: partialCount,
        nonCompliant: nonCompliantCount,
        total: assessments.length,
      },
      assessments,
    },
  }, 201);
});

// Get assessment history
app.get('/assessments', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const repositoryId = c.req.query('repositoryId');
  const frameworkId = c.req.query('frameworkId');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const whereClause: Record<string, unknown> = { organizationId: orgId };
  if (repositoryId) whereClause.repositoryId = repositoryId;
  if (frameworkId) whereClause.frameworkId = frameworkId;

  const assessments = await db.complianceAssessment.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      repositoryId: true,
      frameworkId: true,
      frameworkName: true,
      overallScore: true,
      compliantCount: true,
      partialCount: true,
      nonCompliantCount: true,
      status: true,
      createdAt: true,
    },
  });

  return c.json({
    success: true,
    data: assessments,
  });
});

// Get specific assessment
app.get('/assessments/:assessmentId', requireAuth, requireOrgAccess, async (c) => {
  const assessmentId = c.req.param('assessmentId');
  const orgId = c.get('organizationId');

  const assessment = await db.complianceAssessment.findFirst({
    where: { id: assessmentId, organizationId: orgId },
  });

  if (!assessment) {
    throw new NotFoundError('Assessment', assessmentId);
  }

  return c.json({
    success: true,
    data: assessment,
  });
});

// ============================================================================
// Compliance Document Generation
// ============================================================================

// Generate compliance document
app.post('/generate-document', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    documentType: string;
    frameworkId: string;
    controlId?: string;
    context?: string;
  }>();

  if (!body.repositoryId || !body.documentType || !body.frameworkId) {
    throw new ValidationError('repositoryId, documentType, and frameworkId are required');
  }

  const framework = COMPLIANCE_FRAMEWORKS[body.frameworkId];
  if (!framework) {
    throw new NotFoundError('Framework', body.frameworkId);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    include: { organization: true },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Find relevant control if specified
  const control = body.controlId 
    ? framework.controls.find(c => c.id === body.controlId)
    : framework.controls.find(c => c.documentTypes.includes(body.documentType));

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `Generate a ${body.documentType} document for ${framework.name} compliance.

Organization: ${repository.organization.name}
Repository: ${repository.name}
Framework: ${framework.name}
${control ? `Control: ${control.code} - ${control.title}\nDescription: ${control.description}` : ''}
${body.context ? `Additional Context: ${body.context}` : ''}

Generate a comprehensive compliance document in markdown format that:
1. Addresses the specific ${framework.name} requirements
2. Is professional and audit-ready
3. Includes specific policies, procedures, and responsibilities
4. Has clear version control metadata
5. Includes a document approval section

The document should be complete and ready for review.`,
      },
    ],
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '';

  // Create document
  const document = await prisma.document.create({
    data: {
      repositoryId: body.repositoryId,
      path: `compliance/${body.frameworkId}/${body.documentType.replace(/\s+/g, '-').toLowerCase()}.md`,
      type: 'GUIDE',
      title: `${body.documentType} - ${framework.name}`,
      content,
    },
  });

  log.info({
    documentId: document.id,
    documentType: body.documentType,
    framework: framework.name,
  }, 'Compliance document generated');

  return c.json({
    success: true,
    data: {
      documentId: document.id,
      path: document.path,
      title: document.title,
      framework: framework.name,
      control: control?.code,
    },
  }, 201);
});

// ============================================================================
// Security Documentation
// ============================================================================

// Generate security architecture document
app.post('/security/architecture', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    includeDataFlow?: boolean;
    includeThreatModel?: boolean;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Get existing documents for context
  const existingDocs = await prisma.document.findMany({
    where: { repositoryId: body.repositoryId },
    select: { title: true, type: true, content: true },
    take: 5,
  });

  const docContext = existingDocs
    .map(d => `${d.title}: ${d.content.slice(0, 500)}...`)
    .join('\n\n');

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `Generate a comprehensive security architecture document for this project.

Project: ${repository.name}

Existing Documentation Context:
${docContext || 'No existing documentation found'}

Generate a security architecture document that includes:
1. Security Overview
2. Architecture Components
3. Authentication & Authorization
4. Data Security (encryption, storage, transmission)
5. Network Security
6. Logging & Monitoring
7. ${body.includeDataFlow ? 'Data Flow Diagrams (in mermaid format)' : ''}
8. ${body.includeThreatModel ? 'Threat Model (STRIDE analysis)' : ''}
9. Security Controls Matrix
10. Incident Response Summary

Format in markdown with appropriate sections and diagrams.`,
      },
    ],
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '';

  const document = await prisma.document.create({
    data: {
      repositoryId: body.repositoryId,
      path: 'security/security-architecture.md',
      type: 'ARCHITECTURE',
      title: 'Security Architecture',
      content,
    },
  });

  return c.json({
    success: true,
    data: {
      documentId: document.id,
      path: document.path,
      title: document.title,
    },
  }, 201);
});

// Generate runbook for security incident
app.post('/security/runbook', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    incidentType: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }>();

  if (!body.repositoryId || !body.incidentType) {
    throw new ValidationError('repositoryId and incidentType are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Generate a security incident runbook for: ${body.incidentType}

Severity Level: ${body.severity || 'medium'}
Project: ${repository.name}

Create a detailed runbook that includes:
1. Incident Overview & Indicators
2. Initial Response Steps (first 15 minutes)
3. Investigation Procedures
4. Containment Actions
5. Eradication Steps
6. Recovery Procedures
7. Post-Incident Activities
8. Communication Templates
9. Escalation Contacts (placeholder)
10. Related Documentation Links

Format in markdown with clear step-by-step instructions and checkboxes.`,
      },
    ],
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '';

  const document = await prisma.document.create({
    data: {
      repositoryId: body.repositoryId,
      path: `security/runbooks/${body.incidentType.toLowerCase().replace(/\s+/g, '-')}.md`,
      type: 'GUIDE',
      title: `Runbook: ${body.incidentType}`,
      content,
    },
  });

  return c.json({
    success: true,
    data: {
      documentId: document.id,
      path: document.path,
      title: document.title,
      incidentType: body.incidentType,
      severity: body.severity || 'medium',
    },
  }, 201);
});

export { app as complianceRoutes };
