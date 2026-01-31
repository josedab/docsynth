import { createLogger, createLLMClient, parseLLMJsonResponse, type LLMClient } from '@docsynth/utils';
import type { ContextSource, FileChange } from '@docsynth/types';
import { GitHubClient } from '@docsynth/github';
import { JiraMCPClient, type JiraConfig } from './jira-mcp.js';
import { SlackMCPClient, type SlackConfig } from './slack-mcp.js';
import { LinearMCPClient, type LinearConfig } from './linear-mcp.js';

const log = createLogger('intent-inference-service');

export interface InferenceResult {
  businessPurpose: string;
  technicalApproach: string;
  alternativesConsidered: string[];
  targetAudience: string;
  keyConcepts: string[];
  sources: ContextSource[];
}

export interface MCPClientsConfig {
  jira?: JiraConfig;
  slack?: SlackConfig;
  linear?: LinearConfig;
}

export interface IntentInferenceServiceConfig {
  llmClient?: LLMClient;
  mcpConfig?: MCPClientsConfig;
}

export class IntentInferenceService {
  private llmClient: LLMClient;
  private jiraClient: JiraMCPClient | null = null;
  private slackClient: SlackMCPClient | null = null;
  private linearClient: LinearMCPClient | null = null;

  constructor(config?: IntentInferenceServiceConfig) {
    this.llmClient = config?.llmClient ?? createLLMClient();

    // Initialize MCP clients from config or environment
    this.initializeMCPClients(config?.mcpConfig);
  }

  private initializeMCPClients(config?: MCPClientsConfig): void {
    // Jira client
    if (config?.jira) {
      this.jiraClient = new JiraMCPClient(config.jira);
    } else if (process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
      this.jiraClient = new JiraMCPClient({
        baseUrl: process.env.JIRA_BASE_URL,
        email: process.env.JIRA_EMAIL,
        apiToken: process.env.JIRA_API_TOKEN,
        projectKey: process.env.JIRA_PROJECT_KEY,
      });
    }

    // Slack client
    if (config?.slack) {
      this.slackClient = new SlackMCPClient(config.slack);
    } else if (process.env.SLACK_BOT_TOKEN) {
      this.slackClient = new SlackMCPClient({
        botToken: process.env.SLACK_BOT_TOKEN,
        defaultChannel: process.env.SLACK_DEFAULT_CHANNEL,
      });
    }

    // Linear client
    if (config?.linear) {
      this.linearClient = new LinearMCPClient(config.linear);
    } else if (process.env.LINEAR_API_KEY) {
      this.linearClient = new LinearMCPClient({
        apiKey: process.env.LINEAR_API_KEY,
        teamId: process.env.LINEAR_TEAM_ID,
      });
    }
  }

  async inferIntent(
    client: GitHubClient,
    owner: string,
    repo: string,
    prNumber: number,
    changes: FileChange[],
    prTitle: string,
    prBody: string | null
  ): Promise<InferenceResult> {
    log.info({ owner, repo, prNumber }, 'Inferring intent from PR context');

    // Gather context from multiple sources
    const sources: ContextSource[] = [];

    // 1. PR description as primary source
    if (prBody) {
      sources.push({
        type: 'pr',
        identifier: `${owner}/${repo}#${prNumber}`,
        title: prTitle,
        content: prBody,
        url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        relevanceScore: 1.0,
      });
    }

    // 2. Extract linked issues from PR body
    const linkedIssues = this.extractLinkedIssues(prBody ?? '');
    for (const issueNum of linkedIssues) {
      try {
        // Note: In a full implementation, we'd fetch issue details
        sources.push({
          type: 'pr',
          identifier: `${owner}/${repo}#${issueNum}`,
          title: `Linked Issue #${issueNum}`,
          content: `Referenced issue in PR description`,
          url: `https://github.com/${owner}/${repo}/issues/${issueNum}`,
          relevanceScore: 0.8,
        });
      } catch (error) {
        log.warn({ issueNum, error }, 'Failed to fetch linked issue');
      }
    }

    // 3. Gather context from Jira if configured
    if (this.jiraClient) {
      try {
        const jiraContext = await this.jiraClient.getContextForPR(prTitle, prBody);
        for (const issue of jiraContext.issues) {
          sources.push({
            type: 'jira',
            identifier: issue.key,
            title: issue.summary,
            content: `${issue.description ?? ''}\n\nComments:\n${issue.comments.map((c) => c.body).join('\n')}`,
            url: issue.url,
            relevanceScore: 0.9,
          });
        }
        log.info({ jiraIssues: jiraContext.issues.length }, 'Fetched Jira context');
      } catch (error) {
        log.warn({ error }, 'Failed to fetch Jira context');
      }
    }

    // 4. Gather context from Linear if configured
    if (this.linearClient) {
      try {
        const linearContext = await this.linearClient.getContextForPR(prTitle, prBody);
        for (const issue of linearContext.issues) {
          sources.push({
            type: 'linear',
            identifier: issue.identifier,
            title: issue.title,
            content: `${issue.description ?? ''}\n\nComments:\n${issue.comments.map((c) => c.body).join('\n')}`,
            url: issue.url,
            relevanceScore: 0.9,
          });
        }
        log.info({ linearIssues: linearContext.issues.length }, 'Fetched Linear context');
      } catch (error) {
        log.warn({ error }, 'Failed to fetch Linear context');
      }
    }

    // 5. Gather context from Slack if configured
    if (this.slackClient) {
      try {
        const slackContext = await this.slackClient.getContextForPR(prTitle, prBody, repo);
        for (const msg of slackContext.messages.slice(0, 5)) {
          sources.push({
            type: 'slack',
            identifier: msg.ts,
            title: `#${msg.channelName} discussion`,
            content: msg.text + (msg.replies ? `\n\nReplies:\n${msg.replies.map((r) => r.text).join('\n')}` : ''),
            url: msg.permalink ?? '',
            relevanceScore: 0.7,
          });
        }
        log.info({ slackMessages: slackContext.messages.length }, 'Fetched Slack context');
      } catch (error) {
        log.warn({ error }, 'Failed to fetch Slack context');
      }
    }

    // 6. Summarize changes for context
    const changesSummary = this.summarizeChanges(changes);

    // Build the inference prompt
    const prompt = this.buildInferencePrompt(prTitle, prBody, changesSummary, sources);

    // Use LLM to infer intent
    const inference = await this.runInference(prompt);

    return {
      ...inference,
      sources,
    };
  }

  private extractLinkedIssues(text: string): number[] {
    const issues: number[] = [];

    // Match common patterns: #123, fixes #123, closes #123, etc.
    const patterns = [
      /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*#(\d+)/gi,
      /(?:^|\s)#(\d+)(?:\s|$)/gm,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const num = parseInt(match[1] ?? '0', 10);
        if (num > 0 && !issues.includes(num)) {
          issues.push(num);
        }
      }
    }

    return issues;
  }

  private summarizeChanges(changes: FileChange[]): string {
    const summary: string[] = [];

    const addedFiles = changes.filter((c) => c.changeType === 'added');
    const modifiedFiles = changes.filter((c) => c.changeType === 'modified');
    const deletedFiles = changes.filter((c) => c.changeType === 'deleted');

    if (addedFiles.length > 0) {
      summary.push(`Added ${addedFiles.length} files: ${addedFiles.map((f) => f.path).join(', ')}`);
    }
    if (modifiedFiles.length > 0) {
      summary.push(
        `Modified ${modifiedFiles.length} files: ${modifiedFiles.map((f) => f.path).join(', ')}`
      );
    }
    if (deletedFiles.length > 0) {
      summary.push(
        `Deleted ${deletedFiles.length} files: ${deletedFiles.map((f) => f.path).join(', ')}`
      );
    }

    // Semantic changes
    const allSemanticChanges = changes.flatMap((c) => c.semanticChanges);
    if (allSemanticChanges.length > 0) {
      summary.push('\nSemantic changes:');
      for (const sc of allSemanticChanges.slice(0, 10)) {
        summary.push(`- ${sc.description}`);
      }
      if (allSemanticChanges.length > 10) {
        summary.push(`... and ${allSemanticChanges.length - 10} more`);
      }
    }

    return summary.join('\n');
  }

  private buildInferencePrompt(
    prTitle: string,
    prBody: string | null,
    changesSummary: string,
    sources: ContextSource[]
  ): string {
    return `Analyze this pull request and infer the developer's intent:

## Pull Request
**Title:** ${prTitle}

**Description:**
${prBody ?? 'No description provided'}

## Code Changes
${changesSummary}

## Additional Context
${sources.map((s) => `- ${s.type}: ${s.title}`).join('\n')}

Based on the above information, provide:

1. **Business Purpose**: What user or business problem does this change solve? (1-2 sentences)

2. **Technical Approach**: How does this change implement the solution? (1-2 sentences)

3. **Alternatives Considered**: What other approaches might have been considered? (list 2-3 if apparent, or say "Not specified")

4. **Target Audience**: Who will use or be affected by this change? (developers, end users, etc.)

5. **Key Concepts**: What are the main technical concepts someone should understand to work with this code? (list 3-5)

Respond in JSON format:
{
  "businessPurpose": "...",
  "technicalApproach": "...",
  "alternativesConsidered": ["...", "..."],
  "targetAudience": "...",
  "keyConcepts": ["...", "...", "..."]
}`;
  }

  private async runInference(prompt: string): Promise<Omit<InferenceResult, 'sources'>> {
    const result = await this.llmClient.generate(prompt, { maxTokens: 1024 });
    
    if (result.provider === 'fallback' || !result.content) {
      return this.basicExtraction(prompt);
    }

    return this.parseInferenceResponse(result.content);
  }

  private parseInferenceResponse(text: string): Omit<InferenceResult, 'sources'> {
    const parsed = parseLLMJsonResponse<Partial<Omit<InferenceResult, 'sources'>>>(text);
    
    if (parsed) {
      return {
        businessPurpose: parsed.businessPurpose ?? 'Not specified',
        technicalApproach: parsed.technicalApproach ?? 'Not specified',
        alternativesConsidered: parsed.alternativesConsidered ?? [],
        targetAudience: parsed.targetAudience ?? 'Developers',
        keyConcepts: parsed.keyConcepts ?? [],
      };
    }

    return this.basicExtraction(text);
  }

  private basicExtraction(_prompt: string): Omit<InferenceResult, 'sources'> {
    // Very basic fallback when no LLM is available
    return {
      businessPurpose: 'Inferred from code changes',
      technicalApproach: 'See pull request description and code changes',
      alternativesConsidered: [],
      targetAudience: 'Developers',
      keyConcepts: [],
    };
  }
}

export const intentInferenceService = new IntentInferenceService();
