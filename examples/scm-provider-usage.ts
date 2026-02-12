/**
 * SCM Provider Usage Examples
 *
 * This file demonstrates how to use the multi-SCM provider abstraction layer
 * to work with GitHub, GitLab, and Bitbucket repositories.
 */

import {
  createSCMProvider,
  detectProvider,
  parseRepoUrl,
} from '../apps/api/src/services/scm-provider-factory.js';

// ============================================================================
// Example 1: Detecting Provider from Repository URL
// ============================================================================

async function detectProviderExample() {
  const githubUrl = 'https://github.com/facebook/react';
  const gitlabUrl = 'git@gitlab.com:gitlab-org/gitlab.git';
  const bitbucketUrl = 'https://bitbucket.org/atlassian/python-bitbucket';

  console.log('GitHub:', detectProvider(githubUrl)); // => 'github'
  console.log('GitLab:', detectProvider(gitlabUrl)); // => 'gitlab'
  console.log('Bitbucket:', detectProvider(bitbucketUrl)); // => 'bitbucket'

  // Parse repository info
  const { owner, repo } = parseRepoUrl(githubUrl);
  console.log(`Owner: ${owner}, Repo: ${repo}`); // => Owner: facebook, Repo: react
}

// ============================================================================
// Example 2: Working with GitHub
// ============================================================================

async function githubExample() {
  // Create GitHub provider (uses existing GitHub App installation)
  const github = createSCMProvider('github', {
    installationId: 12345,
  });

  // Get repository information
  const repo = await github.getRepository('facebook', 'react');
  console.log(`Repository: ${repo.fullName}`);
  console.log(`Default Branch: ${repo.defaultBranch}`);
  console.log(`Private: ${repo.private}`);

  // Get a pull request
  const pr = await github.getPullRequest('facebook', 'react', 123);
  console.log(`PR #${pr.number}: ${pr.title}`);
  console.log(`State: ${pr.state}`);
  console.log(`Author: ${pr.author}`);

  // Get files changed in PR
  const files = await github.getPRFiles('facebook', 'react', 123);
  for (const file of files) {
    console.log(`${file.status}: ${file.filename} (+${file.additions}, -${file.deletions})`);
  }

  // Create a comment on the PR
  await github.createPRComment('facebook', 'react', 123, 'Great work! 🎉');

  // Create a check run
  const check = await github.createCheckRun('facebook', 'react', {
    name: 'DocSynth Coverage',
    headSha: 'abc123def456',
    status: 'completed',
    conclusion: 'success',
    title: 'Documentation Coverage: 95%',
    summary: 'All critical APIs are documented.',
  });
  console.log(`Check run created: ${check.id}`);
}

// ============================================================================
// Example 3: Working with GitLab
// ============================================================================

async function gitlabExample() {
  // Create GitLab provider with personal access token
  const gitlab = createSCMProvider('gitlab', {
    token: 'glpat-xxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://gitlab.com/api/v4', // Optional, defaults to gitlab.com
  });

  // Get repository information
  const repo = await gitlab.getRepository('gitlab-org', 'gitlab');
  console.log(`Repository: ${repo.fullName}`);

  // Get a merge request (GitLab's equivalent to PR)
  const mr = await gitlab.getPullRequest('gitlab-org', 'gitlab', 456);
  console.log(`MR !${mr.number}: ${mr.title}`);
  console.log(`Base: ${mr.baseBranch} ← Head: ${mr.headBranch}`);

  // List all open merge requests
  const openMRs = await gitlab.listPullRequests('gitlab-org', 'gitlab', 'opened');
  console.log(`Open MRs: ${openMRs.length}`);

  // Get file content
  const fileContent = await gitlab.getFileContent('gitlab-org', 'gitlab', 'README.md', 'main');
  console.log(`File: ${fileContent.path}`);
  console.log(`SHA: ${fileContent.sha}`);
  console.log(`Content length: ${fileContent.content.length} bytes`);

  // Create a commit status (GitLab's equivalent to check run)
  const status = await gitlab.createCheckRun('gitlab-org', 'gitlab', {
    name: 'DocSynth',
    headSha: 'xyz789abc123',
    status: 'completed',
    conclusion: 'success',
    summary: 'Documentation is up to date',
  });
  console.log(`Commit status created: ${status.id}`);
}

// ============================================================================
// Example 4: Working with Bitbucket
// ============================================================================

async function bitbucketExample() {
  // Create Bitbucket provider with app password
  const bitbucket = createSCMProvider('bitbucket', {
    username: 'myusername',
    appPassword: 'xxxxxxxxxxxxxx',
  });

  // Get repository information
  const repo = await bitbucket.getRepository('atlassian', 'python-bitbucket');
  console.log(`Repository: ${repo.fullName}`);

  // Get a pull request
  const pr = await bitbucket.getPullRequest('atlassian', 'python-bitbucket', 789);
  console.log(`PR #${pr.number}: ${pr.title}`);

  // List recent commits
  const commits = await bitbucket.listCommits('atlassian', 'python-bitbucket');
  for (const commit of commits.slice(0, 5)) {
    console.log(`${commit.sha.substring(0, 7)}: ${commit.message.split('\n')[0]}`);
  }

  // Compare two commits
  const comparison = await bitbucket.compareCommits(
    'atlassian',
    'python-bitbucket',
    'main',
    'develop'
  );
  console.log(`Commits ahead: ${comparison.ahead}`);
  console.log(`Files changed: ${comparison.files.length}`);

  // Create a build status (Bitbucket's equivalent to check run)
  const status = await bitbucket.createCheckRun('atlassian', 'python-bitbucket', {
    name: 'DocSynth',
    headSha: 'abc123',
    status: 'in_progress',
    title: 'Analyzing documentation...',
  });
  console.log(`Build status created: ${status.id}`);
}

// ============================================================================
// Example 5: Provider-Agnostic Code
// ============================================================================

async function providerAgnosticExample(providerType: 'github' | 'gitlab' | 'bitbucket') {
  // This function works with any provider!
  let provider;

  switch (providerType) {
    case 'github':
      provider = createSCMProvider('github', { installationId: 12345 });
      break;
    case 'gitlab':
      provider = createSCMProvider('gitlab', { token: 'glpat-xxx' });
      break;
    case 'bitbucket':
      provider = createSCMProvider('bitbucket', {
        username: 'user',
        appPassword: 'pass',
      });
      break;
  }

  // Same code works for all providers!
  const repo = await provider.getRepository('owner', 'repo');
  const prs = await provider.listPullRequests('owner', 'repo', 'open');
  const commits = await provider.listCommits('owner', 'repo');

  console.log(`Provider: ${provider.type}`);
  console.log(`Repository: ${repo.fullName}`);
  console.log(`Open PRs: ${prs.length}`);
  console.log(`Recent commits: ${commits.length}`);

  return { repo, prs, commits };
}

// ============================================================================
// Example 6: Webhook Handling
// ============================================================================

async function webhookExample() {
  const github = createSCMProvider('github', { installationId: 12345 });
  const gitlab = createSCMProvider('gitlab', { token: 'glpat-xxx' });
  createSCMProvider('bitbucket', {
    username: 'user',
    appPassword: 'pass',
  });

  // Parse webhook payloads
  const githubHeaders = { 'x-github-event': 'pull_request' };
  const githubPayload = {
    action: 'opened',
    repository: {
      /* ... */
    },
  };
  const githubEvent = github.parseWebhookPayload(githubHeaders, githubPayload);

  if (githubEvent) {
    console.log(`GitHub webhook: ${githubEvent.type}`);
    console.log(`Action: ${githubEvent.action}`);
    console.log(`Repository: ${githubEvent.repository.fullName}`);
  }

  // Verify webhook signatures
  const secret = 'my-webhook-secret';
  const body = JSON.stringify(githubPayload);

  const isValidGitHub = github.verifyWebhookSignature(
    { 'x-hub-signature-256': 'sha256=...' },
    body,
    secret
  );
  console.log(`GitHub signature valid: ${isValidGitHub}`);

  const isValidGitLab = gitlab.verifyWebhookSignature({ 'x-gitlab-token': secret }, body, secret);
  console.log(`GitLab signature valid: ${isValidGitLab}`);
}

// ============================================================================
// Example 7: Working with Self-Hosted GitLab
// ============================================================================

async function selfHostedGitLabExample() {
  // Connect to a self-hosted GitLab instance
  const gitlab = createSCMProvider('gitlab', {
    token: 'glpat-xxxxxxxxxxxxxxxxxxxx',
    baseUrl: 'https://gitlab.mycompany.com/api/v4',
  });

  const repo = await gitlab.getRepository('internal', 'proprietary-project');
  console.log(`Private repo: ${repo.fullName}`);
  console.log(`Private: ${repo.private}`);

  const mrs = await gitlab.listPullRequests('internal', 'proprietary-project');
  console.log(`Merge requests: ${mrs.length}`);
}

// ============================================================================
// Run Examples
// ============================================================================

async function main() {
  console.log('=== SCM Provider Examples ===\n');

  console.log('1. Detecting Providers:');
  await detectProviderExample();

  // The following examples require real SCM credentials. Uncomment to run.
  // console.log('\n2. GitHub Example:');
  // await githubExample();

  // console.log('\n3. GitLab Example:');
  // await gitlabExample();

  // console.log('\n4. Bitbucket Example:');
  // await bitbucketExample();

  // console.log('\n5. Provider-Agnostic Example:');
  // await providerAgnosticExample('github');

  // console.log('\n6. Webhook Example:');
  // await webhookExample();

  // console.log('\n7. Self-Hosted GitLab Example:');
  // await selfHostedGitLabExample();
}

main().catch(console.error);

export {
  detectProviderExample,
  githubExample,
  gitlabExample,
  bitbucketExample,
  providerAgnosticExample,
  webhookExample,
  selfHostedGitLabExample,
};
