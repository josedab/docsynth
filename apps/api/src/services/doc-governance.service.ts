/**
 * Documentation Governance & Compliance Service
 *
 * Policy-as-code enforcement, CI gate blocking, and compliance reporting.
 * Policies defined in .docsynth.yml evaluated against repository state.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-governance-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface GovernancePolicy {
  id: string;
  repositoryId: string;
  rules: PolicyRule[];
  enforceMode: 'block' | 'warn' | 'off';
  createdAt: Date;
}

export interface PolicyRule {
  name: string;
  type:
    | 'require-docs'
    | 'max-staleness'
    | 'require-review'
    | 'require-changelog'
    | 'min-coverage'
    | 'require-examples';
  config: Record<string, unknown>;
  severity: 'error' | 'warning';
  enabled: boolean;
}

export interface PolicyEvaluationResult {
  repositoryId: string;
  prNumber?: number;
  passed: boolean;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  summary: string;
  evaluatedAt: Date;
}

export interface PolicyViolation {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  filePath?: string;
  suggestion?: string;
}

export interface ComplianceReport {
  organizationId: string;
  repositories: Array<{
    repositoryId: string;
    name: string;
    compliant: boolean;
    violations: number;
    lastEvaluated: Date;
  }>;
  overallCompliance: number;
  generatedAt: Date;
}

// ============================================================================
// Core Functions
// ============================================================================

export async function evaluatePolicies(
  repositoryId: string,
  prNumber?: number
): Promise<PolicyEvaluationResult> {
  const policy = await getPolicy(repositoryId);
  const violations: PolicyViolation[] = [];
  const warnings: PolicyViolation[] = [];

  for (const rule of policy.rules.filter((r) => r.enabled)) {
    const ruleViolations = await evaluateRule(repositoryId, rule);
    for (const v of ruleViolations) {
      if (v.severity === 'error') violations.push(v);
      else warnings.push(v);
    }
  }

  const passed = policy.enforceMode === 'off' || violations.length === 0;
  const summary = passed
    ? `All ${policy.rules.filter((r) => r.enabled).length} policies passed${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ''}`
    : `${violations.length} policy violation(s) found`;

  const result: PolicyEvaluationResult = {
    repositoryId,
    prNumber,
    passed,
    violations,
    warnings,
    summary,
    evaluatedAt: new Date(),
  };

  await db.governanceEvaluation.create({
    data: {
      repositoryId,
      prNumber,
      passed,
      violationCount: violations.length,
      warningCount: warnings.length,
      summary,
      evaluatedAt: new Date(),
    },
  });

  log.info(
    { repositoryId, passed, violations: violations.length, warnings: warnings.length },
    'Policies evaluated'
  );
  return result;
}

export async function getPolicy(repositoryId: string): Promise<GovernancePolicy> {
  const stored = await db.governancePolicy.findUnique({ where: { repositoryId } });
  if (stored)
    return {
      id: stored.id,
      repositoryId,
      rules: stored.rules as unknown as PolicyRule[],
      enforceMode: stored.enforceMode,
      createdAt: stored.createdAt,
    };

  return {
    id: `default-${repositoryId}`,
    repositoryId,
    rules: [
      {
        name: 'require-public-api-docs',
        type: 'require-docs',
        config: { scope: 'public-api' },
        severity: 'error',
        enabled: true,
      },
      {
        name: 'max-staleness-90-days',
        type: 'max-staleness',
        config: { maxDays: 90 },
        severity: 'warning',
        enabled: true,
      },
      {
        name: 'require-changelog-breaking',
        type: 'require-changelog',
        config: { forBreakingChanges: true },
        severity: 'error',
        enabled: false,
      },
      {
        name: 'min-coverage-60',
        type: 'min-coverage',
        config: { minPercentage: 60 },
        severity: 'warning',
        enabled: true,
      },
    ],
    enforceMode: 'warn',
    createdAt: new Date(),
  };
}

export async function updatePolicy(
  repositoryId: string,
  updates: { rules?: PolicyRule[]; enforceMode?: 'block' | 'warn' | 'off' }
): Promise<GovernancePolicy> {
  const existing = await getPolicy(repositoryId);
  const rules = updates.rules ?? existing.rules;
  const enforceMode = updates.enforceMode ?? existing.enforceMode;

  await db.governancePolicy.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      rules: JSON.parse(JSON.stringify(rules)),
      enforceMode,
      createdAt: new Date(),
    },
    update: { rules: JSON.parse(JSON.stringify(rules)), enforceMode, updatedAt: new Date() },
  });

  return getPolicy(repositoryId);
}

export async function generateComplianceReport(organizationId: string): Promise<ComplianceReport> {
  const repos = await prisma.repository.findMany({
    where: { organizationId },
    select: { id: true, name: true },
  });

  const repoResults = [];
  let compliantCount = 0;

  for (const repo of repos) {
    const result = await evaluatePolicies(repo.id);
    repoResults.push({
      repositoryId: repo.id,
      name: repo.name,
      compliant: result.passed,
      violations: result.violations.length,
      lastEvaluated: result.evaluatedAt,
    });
    if (result.passed) compliantCount++;
  }

  const overallCompliance =
    repos.length > 0 ? Math.round((compliantCount / repos.length) * 100) : 100;

  log.info(
    { organizationId, compliance: overallCompliance, repos: repos.length },
    'Compliance report generated'
  );
  return { organizationId, repositories: repoResults, overallCompliance, generatedAt: new Date() };
}

export function formatPolicyComment(result: PolicyEvaluationResult): string {
  const emoji = result.passed ? '✅' : '❌';
  let comment = `## ${emoji} DocSynth Governance Check\n\n${result.summary}\n\n`;

  if (result.violations.length > 0) {
    comment += `### ❌ Violations\n\n`;
    for (const v of result.violations) {
      comment += `- **${v.rule}**: ${v.message}${v.suggestion ? `\n  💡 ${v.suggestion}` : ''}\n`;
    }
    comment += '\n';
  }

  if (result.warnings.length > 0) {
    comment += `### ⚠️ Warnings\n\n`;
    for (const w of result.warnings) {
      comment += `- **${w.rule}**: ${w.message}\n`;
    }
  }

  comment += `\n---\n<sub>Generated by DocSynth Governance</sub>`;
  return comment;
}

async function evaluateRule(repositoryId: string, rule: PolicyRule): Promise<PolicyViolation[]> {
  const violations: PolicyViolation[] = [];

  switch (rule.type) {
    case 'require-docs': {
      const docs = await prisma.document.findMany({
        where: { repositoryId, path: { endsWith: '.ts' } },
        select: { path: true, content: true },
        take: 100,
      });
      let undocumented = 0;
      for (const doc of docs) {
        if (!doc.content) continue;
        const exports = (doc.content.match(/export\s+(async\s+)?function\s+\w+/g) ?? []).length;
        const jsdocs = (doc.content.match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
        if (exports > 0 && jsdocs === 0) undocumented++;
      }
      if (undocumented > 0)
        violations.push({
          rule: rule.name,
          severity: rule.severity,
          message: `${undocumented} file(s) with exported functions missing documentation`,
          suggestion: 'Add JSDoc comments to public functions',
        });
      break;
    }
    case 'max-staleness': {
      const maxDays = (rule.config as { maxDays: number }).maxDays ?? 90;
      const threshold = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000);
      const staleDocs = await prisma.document.count({
        where: { repositoryId, updatedAt: { lt: threshold }, path: { endsWith: '.md' } },
      });
      if (staleDocs > 0)
        violations.push({
          rule: rule.name,
          severity: rule.severity,
          message: `${staleDocs} document(s) not updated in ${maxDays}+ days`,
          suggestion: 'Run @docsynth update to refresh stale documents',
        });
      break;
    }
    case 'min-coverage': {
      const minPct = (rule.config as { minPercentage: number }).minPercentage ?? 60;
      const totalFiles = await prisma.document.count({
        where: { repositoryId, path: { endsWith: '.ts' } },
      });
      const docFiles = await prisma.document.count({
        where: { repositoryId, path: { endsWith: '.md' } },
      });
      const coverage = totalFiles > 0 ? Math.round((docFiles / totalFiles) * 100) : 100;
      if (coverage < minPct)
        violations.push({
          rule: rule.name,
          severity: rule.severity,
          message: `Documentation coverage ${coverage}% below minimum ${minPct}%`,
        });
      break;
    }
    default:
      break;
  }

  return violations;
}
