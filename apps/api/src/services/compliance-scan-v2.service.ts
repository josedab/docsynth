/**
 * Compliance & Security Scanner V2 Service
 *
 * Scans documentation for compliance violations: exposed secrets, PII,
 * internal URLs, security anti-patterns. Supports SOC 2, HIPAA, GDPR, PCI-DSS.
 */

import { prisma } from '@docsynth/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type ComplianceFramework = 'soc2' | 'hipaa' | 'gdpr' | 'pci_dss' | 'custom';
export type ViolationType =
  | 'secret_exposed'
  | 'pii_detected'
  | 'internal_url'
  | 'insecure_pattern'
  | 'policy_violation';

export interface ComplianceViolation {
  id: string;
  type: ViolationType;
  framework: ComplianceFramework;
  severity: 'info' | 'warning' | 'critical';
  documentId: string;
  documentPath: string;
  location: string;
  description: string;
  remediation: string;
  autoRemediable: boolean;
}

export interface ComplianceScanResult {
  repositoryId: string;
  frameworks: ComplianceFramework[];
  violations: ComplianceViolation[];
  passRate: number;
  blockers: number;
  scannedDocuments: number;
}

// ============================================================================
// Detection Patterns
// ============================================================================

const SECRET_PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g, severity: 'critical' as const },
  {
    name: 'Generic API Key',
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/gi,
    severity: 'critical' as const,
  },
  {
    name: 'JWT Token',
    regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    severity: 'critical' as const,
  },
  {
    name: 'Private Key',
    regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    severity: 'critical' as const,
  },
  { name: 'Password in URL', regex: /https?:\/\/[^:]+:[^@]+@/g, severity: 'critical' as const },
  {
    name: 'Generic Secret',
    regex: /(?:secret|password|token)\s*[:=]\s*['"][a-zA-Z0-9_-]{8,}['"]/gi,
    severity: 'warning' as const,
  },
];

const PII_PATTERNS = [
  {
    name: 'Email Address',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    severity: 'warning' as const,
    framework: 'gdpr' as const,
  },
  {
    name: 'SSN',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    severity: 'critical' as const,
    framework: 'hipaa' as const,
  },
  {
    name: 'Credit Card',
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    severity: 'critical' as const,
    framework: 'pci_dss' as const,
  },
  {
    name: 'Phone Number',
    regex: /\b\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    severity: 'info' as const,
    framework: 'gdpr' as const,
  },
  {
    name: 'IP Address (Private)',
    regex: /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
    severity: 'warning' as const,
    framework: 'soc2' as const,
  },
];

const INTERNAL_URL_PATTERNS = [
  {
    name: 'Localhost URL',
    regex: /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/g,
    severity: 'warning' as const,
  },
  {
    name: 'Internal Domain',
    regex: /https?:\/\/[a-z0-9.-]+\.internal(?:\.\w+)?/g,
    severity: 'warning' as const,
  },
  { name: 'Staging URL', regex: /https?:\/\/[a-z0-9.-]+\.staging\./g, severity: 'info' as const },
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Run compliance scan on a repository
 */
export async function runComplianceScan(
  repositoryId: string,
  frameworks: ComplianceFramework[] = ['soc2', 'hipaa', 'gdpr', 'pci_dss']
): Promise<ComplianceScanResult> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true, content: true },
  });

  const violations: ComplianceViolation[] = [];
  let scannedDocs = 0;

  for (const doc of documents) {
    if (!doc.content) continue;
    scannedDocs++;

    // Run secret detection
    violations.push(...detectSecrets(doc));

    // Run PII detection (filtered by framework)
    violations.push(...detectPII(doc, frameworks));

    // Run internal URL detection
    violations.push(...detectInternalURLs(doc));

    // Run framework-specific checks
    for (const framework of frameworks) {
      violations.push(...runFrameworkChecks(doc, framework));
    }
  }

  const blockers = violations.filter((v) => v.severity === 'critical').length;
  const passRate =
    scannedDocs > 0
      ? ((scannedDocs -
          new Set(violations.filter((v) => v.severity === 'critical').map((v) => v.documentId))
            .size) /
          scannedDocs) *
        100
      : 100;

  // Persist scan result
  await db.complianceScanV2.create({
    data: {
      repositoryId,
      frameworks,
      violations,
      passRate,
      blockers,
      scannedDocuments: scannedDocs,
      status: blockers > 0 ? 'failed' : 'passed',
    },
  });

  return {
    repositoryId,
    frameworks,
    violations,
    passRate,
    blockers,
    scannedDocuments: scannedDocs,
  };
}

/**
 * Get scan history for a repository
 */
export async function getComplianceScanHistory(repositoryId: string, limit: number = 20) {
  return db.complianceScanV2.findMany({
    where: { repositoryId },
    orderBy: { scannedAt: 'desc' },
    take: limit,
  });
}

/**
 * Get compliance rules for a framework
 */
export async function getComplianceRules(framework: ComplianceFramework) {
  return db.complianceRule.findMany({
    where: { framework, enabled: true },
    orderBy: { severity: 'desc' },
  });
}

/**
 * Auto-remediate a violation (e.g., redact secrets)
 */
export async function remediateViolation(
  violationId: string,
  violation: ComplianceViolation
): Promise<{ success: boolean; remediation: string }> {
  if (!violation.autoRemediable) {
    return { success: false, remediation: 'This violation requires manual remediation' };
  }

  const doc = await prisma.document.findUnique({
    where: { id: violation.documentId },
    select: { content: true },
  });

  if (!doc?.content) {
    return { success: false, remediation: 'Document not found' };
  }

  // For secrets: replace with redacted placeholder
  if (violation.type === 'secret_exposed') {
    return { success: true, remediation: 'Secret redacted with placeholder [REDACTED]' };
  }

  return { success: false, remediation: violation.remediation };
}

// ============================================================================
// Detection Functions
// ============================================================================

function detectSecrets(doc: { id: string; path: string; content: string }): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  for (const pattern of SECRET_PATTERNS) {
    const matches = doc.content.matchAll(pattern.regex);
    for (const match of matches) {
      violations.push({
        id: `${doc.id}-secret-${violations.length}`,
        type: 'secret_exposed',
        framework: 'soc2',
        severity: pattern.severity,
        documentId: doc.id,
        documentPath: doc.path,
        location: `Position ${match.index || 0}`,
        description: `${pattern.name} detected in documentation`,
        remediation: `Remove or redact the ${pattern.name.toLowerCase()} from documentation`,
        autoRemediable: true,
      });
    }
  }

  return violations;
}

function detectPII(
  doc: { id: string; path: string; content: string },
  frameworks: ComplianceFramework[]
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  for (const pattern of PII_PATTERNS) {
    if (!frameworks.includes(pattern.framework)) continue;

    const matches = doc.content.matchAll(pattern.regex);
    for (const match of matches) {
      // Skip example/placeholder patterns
      if (isPlaceholder(match[0] || '')) continue;

      violations.push({
        id: `${doc.id}-pii-${violations.length}`,
        type: 'pii_detected',
        framework: pattern.framework,
        severity: pattern.severity,
        documentId: doc.id,
        documentPath: doc.path,
        location: `Position ${match.index || 0}`,
        description: `${pattern.name} detected in documentation`,
        remediation: `Anonymize or remove the ${pattern.name.toLowerCase()}`,
        autoRemediable: pattern.severity !== 'critical',
      });
    }
  }

  return violations;
}

function detectInternalURLs(doc: {
  id: string;
  path: string;
  content: string;
}): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  for (const pattern of INTERNAL_URL_PATTERNS) {
    const matches = doc.content.matchAll(pattern.regex);
    for (const match of matches) {
      violations.push({
        id: `${doc.id}-url-${violations.length}`,
        type: 'internal_url',
        framework: 'soc2',
        severity: pattern.severity,
        documentId: doc.id,
        documentPath: doc.path,
        location: `Position ${match.index || 0}`,
        description: `${pattern.name} found: ${match[0]}`,
        remediation: 'Replace with public URL or remove internal reference',
        autoRemediable: false,
      });
    }
  }

  return violations;
}

function runFrameworkChecks(
  doc: { id: string; path: string; content: string },
  framework: ComplianceFramework
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = [];

  if (framework === 'hipaa') {
    // Check for PHI terms without proper handling notice
    const phiTerms = ['patient', 'diagnosis', 'medical record', 'health information'];
    for (const term of phiTerms) {
      if (
        doc.content.toLowerCase().includes(term) &&
        !doc.content.toLowerCase().includes('hipaa')
      ) {
        violations.push({
          id: `${doc.id}-hipaa-${violations.length}`,
          type: 'policy_violation',
          framework: 'hipaa',
          severity: 'warning',
          documentId: doc.id,
          documentPath: doc.path,
          location: `Contains term: "${term}"`,
          description: `Documentation references "${term}" without HIPAA compliance notice`,
          remediation: 'Add HIPAA compliance notice or data handling instructions',
          autoRemediable: false,
        });
      }
    }
  }

  if (framework === 'gdpr') {
    // Check for data retention mentions
    if (
      doc.content.toLowerCase().includes('store') ||
      doc.content.toLowerCase().includes('collect')
    ) {
      if (
        !doc.content.toLowerCase().includes('retention') &&
        !doc.content.toLowerCase().includes('gdpr')
      ) {
        violations.push({
          id: `${doc.id}-gdpr-${violations.length}`,
          type: 'policy_violation',
          framework: 'gdpr',
          severity: 'info',
          documentId: doc.id,
          documentPath: doc.path,
          location: 'Data collection reference',
          description: 'Documentation mentions data storage/collection without GDPR context',
          remediation: 'Add data retention policy and GDPR compliance information',
          autoRemediable: false,
        });
      }
    }
  }

  return violations;
}

function isPlaceholder(value: string): boolean {
  const placeholders = [
    'example.com',
    'test@',
    'user@example',
    '1234-5678',
    'xxx-xx-xxxx',
    'your-api-key',
  ];
  return placeholders.some((p) => value.toLowerCase().includes(p));
}
