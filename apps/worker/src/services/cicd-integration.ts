/**
 * CI/CD Integration Service
 * 
 * Generates GitHub Actions workflows and integrates documentation testing
 * into continuous integration pipelines.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('cicd-integration');

export interface CICDConfig {
  provider: 'github' | 'gitlab' | 'jenkins';
  branch: string;
  trigger: 'push' | 'pull_request' | 'schedule' | 'manual';
  schedule?: string;
  failOnBrokenExamples: boolean;
  languages: string[];
  maxParallel?: number;
  timeout?: number;
}

export interface CICDReport {
  id: string;
  repositoryId: string;
  runId: string;
  branch: string;
  commit: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  totalExamples: number;
  passedExamples: number;
  failedExamples: number;
  skippedExamples: number;
  failureDetails: ExampleFailure[];
}

export interface ExampleFailure {
  exampleId: string;
  documentPath: string;
  language: string;
  lineStart: number;
  lineEnd: number;
  error: string;
  expectedOutput?: string;
  actualOutput?: string;
  suggestedFix?: string;
}

class CICDIntegrationService {
  /**
   * Generate a GitHub Actions workflow for documentation testing
   */
  generateGitHubWorkflow(
    repositoryName: string,
    config: CICDConfig
  ): string {
    const languages = config.languages.length > 0 ? config.languages : ['javascript', 'typescript', 'python'];

    const languageSetups = this.generateLanguageSetups(languages);
    const trigger = this.generateGitHubTrigger(config);
    const timeout = config.timeout || 30;
    const maxParallel = config.maxParallel || 4;

    const workflow = `# DocSynth Documentation Testing Workflow
# Automatically generated - validates all code examples in documentation

name: Documentation Tests

${trigger}

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  test-documentation:
    name: Test Documentation Examples
    runs-on: ubuntu-latest
    timeout-minutes: ${timeout}
    
    strategy:
      fail-fast: ${config.failOnBrokenExamples}
      max-parallel: ${maxParallel}
      matrix:
        include:
${languages.map(lang => `          - language: ${lang}`).join('\n')}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

${languageSetups}

      - name: Install DocSynth CLI
        run: npm install -g @docsynth/cli

      - name: Run documentation tests
        id: doctest
        env:
          DOCSYNTH_API_KEY: \${{ secrets.DOCSYNTH_API_KEY }}
          LANGUAGE: \${{ matrix.language }}
        run: |
          docsynth test-examples \\
            --language \${{ matrix.language }} \\
            --format json \\
            --output results-\${{ matrix.language }}.json \\
            ${config.failOnBrokenExamples ? '--fail-on-error' : '--no-fail-on-error'}

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: doctest-results-\${{ matrix.language }}
          path: results-\${{ matrix.language }}.json
          retention-days: 30

      - name: Report results to DocSynth
        if: always()
        env:
          DOCSYNTH_API_KEY: \${{ secrets.DOCSYNTH_API_KEY }}
        run: |
          docsynth report-ci-results \\
            --file results-\${{ matrix.language }}.json \\
            --run-id \${{ github.run_id }} \\
            --commit \${{ github.sha }} \\
            --branch \${{ github.ref_name }}

  summarize-results:
    name: Summarize Documentation Test Results
    runs-on: ubuntu-latest
    needs: test-documentation
    if: always()
    
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: doctest-results-*
          merge-multiple: true

      - name: Install DocSynth CLI
        run: npm install -g @docsynth/cli

      - name: Generate summary report
        env:
          DOCSYNTH_API_KEY: \${{ secrets.DOCSYNTH_API_KEY }}
        run: |
          docsynth summarize-ci \\
            --files "results-*.json" \\
            --output summary.md

      - name: Post summary to PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const summary = fs.readFileSync('summary.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: summary
            });

      - name: Write job summary
        run: cat summary.md >> \$GITHUB_STEP_SUMMARY
`;

    return workflow;
  }

  /**
   * Generate language setup steps for GitHub Actions
   */
  private generateLanguageSetups(languages: string[]): string {
    const setups: string[] = [];

    if (languages.includes('javascript') || languages.includes('typescript')) {
      setups.push(`      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Node dependencies
        run: npm ci || npm install`);
    }

    if (languages.includes('python')) {
      setups.push(`      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'

      - name: Install Python dependencies
        run: pip install -r requirements.txt || true`);
    }

    if (languages.includes('go')) {
      setups.push(`      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'
          cache: true`);
    }

    if (languages.includes('rust')) {
      setups.push(`      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable`);
    }

    if (languages.includes('java')) {
      setups.push(`      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '21'
          cache: 'maven'`);
    }

    return setups.join('\n\n');
  }

  /**
   * Generate GitHub Actions trigger configuration
   */
  private generateGitHubTrigger(config: CICDConfig): string {
    switch (config.trigger) {
      case 'push':
        return `on:
  push:
    branches:
      - ${config.branch}
    paths:
      - '**/*.md'
      - '**/*.mdx'
      - 'docs/**'`;

      case 'pull_request':
        return `on:
  pull_request:
    branches:
      - ${config.branch}
    paths:
      - '**/*.md'
      - '**/*.mdx'
      - 'docs/**'`;

      case 'schedule':
        return `on:
  schedule:
    - cron: '${config.schedule || '0 6 * * 1'}' # Weekly on Monday at 6 AM
  workflow_dispatch:`;

      case 'manual':
        return `on:
  workflow_dispatch:
    inputs:
      languages:
        description: 'Languages to test (comma-separated, or "all")'
        required: false
        default: 'all'`;

      default:
        return `on:
  push:
    branches:
      - ${config.branch}`;
    }
  }

  /**
   * Generate GitLab CI configuration
   */
  generateGitLabCI(repositoryName: string, config: CICDConfig): string {
    const languages = config.languages.length > 0 ? config.languages : ['javascript', 'typescript', 'python'];

    return `# DocSynth Documentation Testing
# Automatically generated - validates all code examples in documentation

stages:
  - test
  - report

variables:
  DOCSYNTH_API_KEY: \${DOCSYNTH_API_KEY}

.test-template:
  stage: test
  timeout: ${config.timeout || 30}m
  script:
    - npm install -g @docsynth/cli
    - docsynth test-examples --language $LANGUAGE --format json --output results-$LANGUAGE.json ${config.failOnBrokenExamples ? '--fail-on-error' : ''}
  artifacts:
    paths:
      - results-*.json
    expire_in: 30 days
    when: always

${languages.map(lang => `test:${lang}:
  extends: .test-template
  variables:
    LANGUAGE: ${lang}
  image: ${this.getLanguageImage(lang)}
`).join('\n')}

report:
  stage: report
  dependencies:
${languages.map(lang => `    - test:${lang}`).join('\n')}
  script:
    - npm install -g @docsynth/cli
    - docsynth summarize-ci --files "results-*.json" --output summary.md
    - cat summary.md
  artifacts:
    paths:
      - summary.md
    expire_in: 30 days
`;
  }

  /**
   * Get appropriate Docker image for a language
   */
  private getLanguageImage(language: string): string {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return 'node:20-alpine';
      case 'python':
        return 'python:3.12-alpine';
      case 'go':
        return 'golang:1.22-alpine';
      case 'rust':
        return 'rust:1.76-alpine';
      case 'java':
        return 'eclipse-temurin:21-alpine';
      default:
        return 'ubuntu:latest';
    }
  }

  /**
   * Store CI/CD workflow in database
   */
  async saveWorkflowConfig(
    repositoryId: string,
    provider: 'github' | 'gitlab' | 'jenkins',
    config: CICDConfig,
    workflowContent: string
  ): Promise<string> {
    const id = generateId();

    // Get organization ID for the repository
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { organizationId: true },
    });

    if (repository?.organizationId) {
      // Store as audit log entry (as a workaround for settings)
      await prisma.auditLog.create({
        data: {
          id,
          organizationId: repository.organizationId,
          action: 'cicd_config_saved',
          resourceType: 'repository',
          resourceId: repositoryId,
          details: JSON.parse(JSON.stringify({
            provider,
            config,
            workflowContent,
            updatedAt: new Date().toISOString(),
          })),
        },
      });
    }

    return id;
  }

  /**
   * Get CI/CD workflow configuration
   */
  async getWorkflowConfig(
    repositoryId: string,
    provider: 'github' | 'gitlab' | 'jenkins'
  ): Promise<{ config: CICDConfig; workflowContent: string } | null> {
    const log = await prisma.auditLog.findFirst({
      where: {
        resourceType: 'repository',
        resourceId: repositoryId,
        action: 'cicd_config_saved',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!log) {
      return null;
    }

    const details = log.details as unknown as { config: CICDConfig; workflowContent: string; provider: string };
    if (details.provider !== provider) {
      return null;
    }

    return {
      config: details.config,
      workflowContent: details.workflowContent,
    };
  }

  /**
   * Record CI/CD run results
   */
  async recordCIRun(report: Omit<CICDReport, 'id'>): Promise<string> {
    const id = generateId();

    // Get organization ID
    const repository = await prisma.repository.findUnique({
      where: { id: report.repositoryId },
      select: { organizationId: true },
    });

    if (repository?.organizationId) {
      // Store CI run in audit log
      await prisma.auditLog.create({
        data: {
          id,
          organizationId: repository.organizationId,
          action: 'ci_run',
          resourceType: 'repository',
          resourceId: report.repositoryId,
          details: JSON.parse(JSON.stringify(report)),
        },
      });

      // Update repository health if run failed
      if (report.status === 'failed' && report.failedExamples > 0) {
        // Create health alert for broken examples
        const alertId = generateId();
        await prisma.healthAlert.create({
          data: {
            id: alertId,
            organizationId: repository.organizationId,
            repositoryId: report.repositoryId,
            alertType: 'broken_example',
            severity: 'critical',
            title: 'CI/CD found broken code examples',
            message: `CI/CD run found ${report.failedExamples} broken code example(s)`,
            metadata: JSON.parse(JSON.stringify({
              runId: report.runId,
              commit: report.commit,
              branch: report.branch,
              failures: report.failureDetails,
            })),
          },
        });
      }
    }

    return id;
  }

  /**
   * Get CI/CD run history for a repository
   */
  async getCIRunHistory(
    repositoryId: string,
    limit: number = 20
  ): Promise<CICDReport[]> {
    const logs = await prisma.auditLog.findMany({
      where: {
        resourceType: 'repository',
        resourceId: repositoryId,
        action: 'ci_run',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map((log) => {
      const data = log.details as unknown as Omit<CICDReport, 'id'>;
      return {
        id: log.id,
        ...data,
      };
    });
  }

  /**
   * Generate suggested fix for a broken example using AI
   */
  async generateSuggestedFix(
    exampleId: string,
    error: string
  ): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = prisma as any;
    const example = await db.interactiveExample.findUnique({
      where: { id: exampleId },
    });

    if (!example) {
      return null;
    }

    // Get document path
    const document = await prisma.document.findUnique({
      where: { id: example.documentId },
      select: { path: true },
    });

    // For now, return a basic suggestion based on common errors
    // In production, this would use Claude to generate a real fix
    if (error.includes('SyntaxError')) {
      return `Check for syntax errors in the code example at ${document?.path}:${example.sourceLineStart}. Common issues include missing brackets, quotes, or semicolons.`;
    }

    if (error.includes('ModuleNotFoundError') || error.includes('Cannot find module')) {
      return `Missing import or dependency. Ensure all required modules are listed in the example's dependencies or installed in the test environment.`;
    }

    if (error.includes('TypeError')) {
      return `Type mismatch detected. Check that all variables and function parameters are being used correctly with their expected types.`;
    }

    if (error.includes('timed out')) {
      return `Example execution timed out. Consider simplifying the example or increasing the timeout limit. Avoid infinite loops or long-running operations in documentation examples.`;
    }

    return `Error in example: ${error.substring(0, 200)}. Review the code and ensure it matches the current API/library version.`;
  }

  /**
   * Detect languages used in a repository's documentation
   */
  async detectLanguages(repositoryId: string): Promise<string[]> {
    const examples = await prisma.interactiveExample.findMany({
      where: { repositoryId },
      select: { language: true },
    });

    const languages = new Set<string>();
    for (const example of examples) {
      languages.add(example.language);
    }

    if (languages.size === 0) {
      // Default to common languages
      return ['javascript', 'typescript'];
    }

    return Array.from(languages);
  }
}

export const cicdIntegrationService = new CICDIntegrationService();
