import { readFileSync } from 'node:fs';

import {
  analyzeChanges,
  generateDocumentation,
  formatAsPRBody,
  formatAsJSON,
} from '@docsynth/core';

import { getPRDiff, postComment, createCommit } from './github.js';

// ============================================================================
// Input Helpers
// ============================================================================

function getInput(name: string, required = false): string {
  const envKey = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`;
  const value = process.env[envKey] ?? '';
  if (required && !value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
}

function getBooleanInput(name: string): boolean {
  return getInput(name).toLowerCase() === 'true';
}

function setOutput(name: string, value: string): void {
  console.log(`::set-output name=${name}::${value}`);
}

function startGroup(name: string): void {
  console.log(`::group::${name}`);
}

function endGroup(): void {
  console.log('::endgroup::');
}

function setFailed(message: string): void {
  console.log(`::error::${message}`);
  process.exitCode = 1;
}

// ============================================================================
// Context Helpers
// ============================================================================

interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  branch: string;
}

function getPRContext(): PRContext | null {
  const githubRepository = process.env.GITHUB_REPOSITORY ?? '';
  const [owner, repo] = githubRepository.split('/');
  if (!owner || !repo) return null;

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf-8')) as {
      pull_request?: { number: number; head?: { ref?: string } };
    };

    if (!event.pull_request?.number) return null;

    return {
      owner,
      repo,
      prNumber: event.pull_request.number,
      branch: event.pull_request.head?.ref ?? '',
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Main Action
// ============================================================================

async function run(): Promise<void> {
  try {
    const token = getInput('github-token', true);
    const docTypes = getInput('doc-types')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const outputMode = getInput('output-mode') || 'comment';
    const dryRun = getBooleanInput('dry-run');

    startGroup('🔍 Resolving PR context');
    const context = getPRContext();
    if (!context) {
      console.log('No PR context found — this action should run on pull_request events.');
      endGroup();
      return;
    }
    console.log(
      `PR #${context.prNumber} in ${context.owner}/${context.repo} (branch: ${context.branch})`
    );
    endGroup();

    // Fetch the PR diff
    startGroup('📥 Fetching PR diff');
    const diff = await getPRDiff(token, context.owner, context.repo, context.prNumber);
    console.log(`Fetched diff (${diff.length} bytes)`);
    endGroup();

    // Analyze changes
    startGroup('🔬 Analyzing changes');
    const analysis = analyzeChanges(diff);
    console.log(`Impact score: ${analysis.impactScore}/100`);
    console.log(`Changed files: ${analysis.changedFiles.length}`);
    console.log(`Suggested doc types: ${analysis.suggestedDocTypes.join(', ')}`);
    console.log(`Summary: ${analysis.summary}`);
    endGroup();

    // Set outputs
    setOutput('impact-score', String(analysis.impactScore));
    setOutput('changed-docs', String(analysis.suggestedDocTypes.length));

    if (dryRun) {
      console.log('🏃 Dry run mode — skipping generation');
      setOutput('generated-files', '');
      return;
    }

    // Generate documentation
    startGroup('📝 Generating documentation');
    const results = await generateDocumentation(analysis, {
      docTypes: docTypes.length > 0 ? docTypes : analysis.suggestedDocTypes,
    });
    console.log(`Generated ${results.length} document(s)`);
    endGroup();

    const generatedFiles = results.map((r) => r.path).join(',');
    setOutput('generated-files', generatedFiles);

    // Output based on mode
    startGroup(`📤 Output mode: ${outputMode}`);
    switch (outputMode) {
      case 'comment': {
        const body = formatAsPRBody(results);
        await postComment(token, context.owner, context.repo, context.prNumber, body);
        console.log('Posted PR comment');
        break;
      }
      case 'commit': {
        if (!context.branch) {
          setFailed('Cannot commit: no branch found in PR context');
          break;
        }
        const files = results.map((r) => ({ path: r.path, content: r.content }));
        await createCommit(token, context.owner, context.repo, context.branch, files);
        console.log(`Committed ${files.length} file(s) to ${context.branch}`);
        break;
      }
      case 'json': {
        const json = formatAsJSON(results);
        console.log(json);
        break;
      }
      default:
        console.log(`Unknown output mode: ${outputMode}`);
    }
    endGroup();

    console.log('✅ DocSynth action completed successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFailed(message);
  }
}

run();
