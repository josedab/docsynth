// ============================================================================
// Types
// ============================================================================

export type FrameworkId = 'soc2' | 'iso27001' | 'hipaa' | 'gdpr' | 'pci-dss';

export interface ComplianceControl {
  id: string;
  name: string;
  description: string;
  requirements: string[];
  evidenceTypes: EvidenceType[];
  codePatterns: string[];
  documentationTemplate: string;
}

export type EvidenceType =
  | 'code-review'
  | 'test-result'
  | 'access-log'
  | 'deploy-log'
  | 'config-audit'
  | 'policy-doc'
  | 'training-record';

export interface ComplianceFramework {
  id: FrameworkId;
  name: string;
  version: string;
  controls: ComplianceControl[];
}

export interface ChecklistItem {
  controlId: string;
  controlName: string;
  status: 'met' | 'partial' | 'not-met' | 'not-applicable';
  evidenceRequired: EvidenceType[];
  notes: string;
}

export interface ComplianceChecklist {
  frameworkId: FrameworkId;
  frameworkName: string;
  generatedAt: string;
  items: ChecklistItem[];
  summary: { met: number; partial: number; notMet: number; notApplicable: number };
}

export interface ComplianceScore {
  frameworkId: FrameworkId;
  score: number;
  maxScore: number;
  percentage: number;
  controlScores: { controlId: string; score: number; maxScore: number }[];
}

// ============================================================================
// Framework definitions
// ============================================================================

const SOC2_CONTROLS: ComplianceControl[] = [
  {
    id: 'CC6.1',
    name: 'Logical Access Security',
    description:
      'Logical access to systems is restricted through authentication and authorization.',
    requirements: ['Authentication mechanisms', 'Role-based access control', 'Session management'],
    evidenceTypes: ['code-review', 'access-log', 'config-audit'],
    codePatterns: ['requireAuth', 'authenticate', 'authorize', 'rbac', 'session'],
    documentationTemplate:
      '## Access Control\n\n### Authentication\n{auth_details}\n\n### Authorization\n{authz_details}',
  },
  {
    id: 'CC6.2',
    name: 'Credential Management',
    description: 'Credentials are managed securely throughout their lifecycle.',
    requirements: ['Password hashing', 'Key rotation', 'Secret storage'],
    evidenceTypes: ['code-review', 'config-audit', 'policy-doc'],
    codePatterns: ['bcrypt', 'hash', 'encrypt', 'vault', 'secret', 'credential'],
    documentationTemplate:
      '## Credential Management\n\n### Hashing\n{hash_details}\n\n### Storage\n{storage_details}',
  },
  {
    id: 'CC7.1',
    name: 'System Monitoring',
    description: 'Systems are monitored to detect anomalies and security events.',
    requirements: ['Logging infrastructure', 'Alerting', 'Anomaly detection'],
    evidenceTypes: ['access-log', 'deploy-log', 'config-audit'],
    codePatterns: ['logger', 'createLogger', 'monitor', 'alert', 'audit'],
    documentationTemplate:
      '## Monitoring\n\n### Logging\n{logging_details}\n\n### Alerts\n{alert_details}',
  },
  {
    id: 'CC8.1',
    name: 'Change Management',
    description: 'Changes to systems follow a controlled process.',
    requirements: ['Code review', 'Testing', 'Deployment approval'],
    evidenceTypes: ['code-review', 'test-result', 'deploy-log'],
    codePatterns: ['review', 'approve', 'deploy', 'ci', 'pipeline'],
    documentationTemplate:
      '## Change Management\n\n### Review Process\n{review_details}\n\n### Deployment\n{deploy_details}',
  },
];

const ISO27001_CONTROLS: ComplianceControl[] = [
  {
    id: 'A.9.1',
    name: 'Access Control Policy',
    description: 'Access control policy based on business and security requirements.',
    requirements: ['Access policy documentation', 'Access provisioning', 'Access review'],
    evidenceTypes: ['policy-doc', 'access-log', 'config-audit'],
    codePatterns: ['policy', 'access', 'permission', 'role'],
    documentationTemplate:
      '## Access Control Policy\n\n### Policy\n{policy_details}\n\n### Provisioning\n{provisioning_details}',
  },
  {
    id: 'A.12.4',
    name: 'Logging and Monitoring',
    description: 'Event logs recording user activities and security events.',
    requirements: ['Event logging', 'Log protection', 'Admin activity logging'],
    evidenceTypes: ['access-log', 'config-audit', 'deploy-log'],
    codePatterns: ['logger', 'audit', 'event', 'log'],
    documentationTemplate:
      '## Logging\n\n### Event Logs\n{log_details}\n\n### Protection\n{protection_details}',
  },
  {
    id: 'A.14.2',
    name: 'Secure Development',
    description: 'Security is integrated into the development lifecycle.',
    requirements: ['Secure coding standards', 'Security testing', 'Code review'],
    evidenceTypes: ['code-review', 'test-result', 'training-record'],
    codePatterns: ['test', 'lint', 'sanitize', 'validate', 'escape'],
    documentationTemplate:
      '## Secure Development\n\n### Standards\n{standards_details}\n\n### Testing\n{testing_details}',
  },
];

const HIPAA_CONTROLS: ComplianceControl[] = [
  {
    id: '164.312(a)',
    name: 'Access Control',
    description: 'Technical safeguards for access to electronic protected health information.',
    requirements: [
      'Unique user identification',
      'Emergency access',
      'Automatic logoff',
      'Encryption',
    ],
    evidenceTypes: ['code-review', 'access-log', 'config-audit'],
    codePatterns: ['authenticate', 'encrypt', 'phi', 'hipaa', 'session'],
    documentationTemplate:
      '## HIPAA Access Control\n\n### User ID\n{uid_details}\n\n### Encryption\n{enc_details}',
  },
  {
    id: '164.312(b)',
    name: 'Audit Controls',
    description: 'Mechanisms to record and examine access to ePHI.',
    requirements: ['Audit logging', 'Log review', 'Tamper protection'],
    evidenceTypes: ['access-log', 'config-audit', 'policy-doc'],
    codePatterns: ['audit', 'log', 'trail', 'record'],
    documentationTemplate:
      '## HIPAA Audit Controls\n\n### Logging\n{log_details}\n\n### Review\n{review_details}',
  },
];

const GDPR_CONTROLS: ComplianceControl[] = [
  {
    id: 'Art.25',
    name: 'Data Protection by Design',
    description: 'Data protection principles integrated into processing activities.',
    requirements: ['Data minimization', 'Purpose limitation', 'Privacy defaults'],
    evidenceTypes: ['code-review', 'policy-doc', 'config-audit'],
    codePatterns: ['privacy', 'consent', 'gdpr', 'personal', 'anonymize', 'pseudonymize'],
    documentationTemplate:
      '## Data Protection by Design\n\n### Minimization\n{min_details}\n\n### Defaults\n{default_details}',
  },
  {
    id: 'Art.30',
    name: 'Records of Processing',
    description: 'Maintain records of processing activities.',
    requirements: ['Processing inventory', 'Legal basis documentation', 'Retention schedules'],
    evidenceTypes: ['policy-doc', 'config-audit', 'access-log'],
    codePatterns: ['processing', 'retention', 'purpose', 'lawful'],
    documentationTemplate:
      '## Processing Records\n\n### Inventory\n{inv_details}\n\n### Retention\n{ret_details}',
  },
];

const PCI_DSS_CONTROLS: ComplianceControl[] = [
  {
    id: 'Req.3',
    name: 'Protect Stored Data',
    description: 'Protect stored cardholder data.',
    requirements: ['Encryption at rest', 'Key management', 'Data masking'],
    evidenceTypes: ['code-review', 'config-audit', 'policy-doc'],
    codePatterns: ['encrypt', 'mask', 'card', 'pan', 'token', 'pci'],
    documentationTemplate:
      '## Data Protection\n\n### Encryption\n{enc_details}\n\n### Masking\n{mask_details}',
  },
  {
    id: 'Req.6',
    name: 'Secure Systems',
    description: 'Develop and maintain secure systems and applications.',
    requirements: ['Vulnerability management', 'Secure coding', 'Patch management'],
    evidenceTypes: ['code-review', 'test-result', 'deploy-log'],
    codePatterns: ['vulnerability', 'patch', 'security', 'cve', 'scan'],
    documentationTemplate:
      '## Secure Systems\n\n### Vulnerability Mgmt\n{vuln_details}\n\n### Patching\n{patch_details}',
  },
];

const FRAMEWORKS: Record<FrameworkId, ComplianceFramework> = {
  soc2: { id: 'soc2', name: 'SOC 2 Type II', version: '2017', controls: SOC2_CONTROLS },
  iso27001: {
    id: 'iso27001',
    name: 'ISO 27001:2022',
    version: '2022',
    controls: ISO27001_CONTROLS,
  },
  hipaa: { id: 'hipaa', name: 'HIPAA Security Rule', version: '2013', controls: HIPAA_CONTROLS },
  gdpr: { id: 'gdpr', name: 'GDPR', version: '2018', controls: GDPR_CONTROLS },
  'pci-dss': { id: 'pci-dss', name: 'PCI DSS v4.0', version: '4.0', controls: PCI_DSS_CONTROLS },
};

// ============================================================================
// Functions
// ============================================================================

export function getFramework(id: FrameworkId): ComplianceFramework {
  const fw = FRAMEWORKS[id];
  if (!fw) throw new Error(`Unknown framework: ${id}`);
  return fw;
}

export function mapCodePatterns(
  codeSnippets: string[],
  frameworkId: FrameworkId
): { controlId: string; matchedPatterns: string[] }[] {
  const fw = getFramework(frameworkId);
  const results: { controlId: string; matchedPatterns: string[] }[] = [];
  const combined = codeSnippets.join('\n').toLowerCase();

  for (const control of fw.controls) {
    const matched = control.codePatterns.filter((p) => combined.includes(p.toLowerCase()));
    if (matched.length > 0) {
      results.push({ controlId: control.id, matchedPatterns: matched });
    }
  }
  return results;
}

export function generateChecklist(
  frameworkId: FrameworkId,
  evidenceAvailable: EvidenceType[]
): ComplianceChecklist {
  const fw = getFramework(frameworkId);
  const items: ChecklistItem[] = fw.controls.map((control) => {
    const covered = control.evidenceTypes.filter((e) => evidenceAvailable.includes(e));
    const ratio =
      control.evidenceTypes.length > 0 ? covered.length / control.evidenceTypes.length : 0;

    let status: ChecklistItem['status'];
    if (ratio >= 1) status = 'met';
    else if (ratio > 0) status = 'partial';
    else status = 'not-met';

    return {
      controlId: control.id,
      controlName: control.name,
      status,
      evidenceRequired: control.evidenceTypes.filter((e) => !evidenceAvailable.includes(e)),
      notes:
        ratio >= 1
          ? 'All evidence available'
          : `Missing ${control.evidenceTypes.length - covered.length} evidence type(s)`,
    };
  });

  const summary = {
    met: items.filter((i) => i.status === 'met').length,
    partial: items.filter((i) => i.status === 'partial').length,
    notMet: items.filter((i) => i.status === 'not-met').length,
    notApplicable: items.filter((i) => i.status === 'not-applicable').length,
  };

  return {
    frameworkId,
    frameworkName: fw.name,
    generatedAt: new Date().toISOString(),
    items,
    summary,
  };
}

export function scoreCompliance(
  frameworkId: FrameworkId,
  evidenceAvailable: EvidenceType[],
  codeSnippets: string[] = []
): ComplianceScore {
  const fw = getFramework(frameworkId);
  const patternMatches = mapCodePatterns(codeSnippets, frameworkId);
  const patternMap = new Map(patternMatches.map((m) => [m.controlId, m.matchedPatterns.length]));

  const controlScores = fw.controls.map((control) => {
    const evidenceCovered = control.evidenceTypes.filter((e) =>
      evidenceAvailable.includes(e)
    ).length;
    const evidenceMax = control.evidenceTypes.length;
    const evidenceScore = evidenceMax > 0 ? (evidenceCovered / evidenceMax) * 60 : 60;

    const patternCount = patternMap.get(control.id) ?? 0;
    const patternMax = control.codePatterns.length;
    const patternScore =
      patternMax > 0 ? (Math.min(patternCount, patternMax) / patternMax) * 40 : 0;

    const raw = Math.round(evidenceScore + patternScore);
    return { controlId: control.id, score: raw, maxScore: 100 };
  });

  const total = controlScores.reduce((s, c) => s + c.score, 0);
  const max = controlScores.reduce((s, c) => s + c.maxScore, 0);

  return {
    frameworkId,
    score: total,
    maxScore: max,
    percentage: max > 0 ? Math.round((total / max) * 100) : 0,
    controlScores,
  };
}
