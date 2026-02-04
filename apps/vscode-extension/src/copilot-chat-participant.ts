/**
 * GitHub Copilot Chat Participant
 *
 * Integrates DocSynth with GitHub Copilot Chat, allowing users to:
 * - Ask questions about their documentation
 * - Get documentation suggestions for code
 * - Explain code using project documentation context
 * - Search documentation from within Copilot Chat
 */

import * as vscode from 'vscode';
import type { DocSynthClient } from './client';

const PARTICIPANT_ID = 'docsynth.chatParticipant';
const PARTICIPANT_NAME = 'docs';

interface ChatContext {
  repositoryId?: string;
  currentFile?: string;
  selectedCode?: string;
}

type ChatCommand = 'explain' | 'search' | 'document' | 'health' | 'examples';

interface ChatResult {
  content: string;
  sources?: Array<{
    title: string;
    path: string;
    excerpt: string;
  }>;
  followUpQuestions?: string[];
}

export class CopilotChatParticipant {
  private client: DocSynthClient;
  private chatContext: ChatContext = {};

  constructor(client: DocSynthClient) {
    this.client = client;
  }

  register(context: vscode.ExtensionContext): void {
    // Check if the Chat API is available (VS Code 1.90+)
    if (!vscode.chat) {
      console.log('GitHub Copilot Chat API not available in this VS Code version');
      return;
    }

    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, this.handleChatRequest.bind(this));

    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');

    // Register follow-up provider
    participant.followupProvider = {
      provideFollowups: this.provideFollowups.bind(this),
    };

    context.subscriptions.push(participant);
    console.log('DocSynth Copilot Chat participant registered');
  }

  private async handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    // Update context with current editor state
    await this.updateContext();

    // Parse command from request
    const command = this.parseCommand(request.command);

    try {
      switch (command) {
        case 'explain':
          return await this.handleExplain(request, stream, token);
        case 'search':
          return await this.handleSearch(request, stream, token);
        case 'document':
          return await this.handleDocument(request, stream, token);
        case 'health':
          return await this.handleHealth(stream, token);
        case 'examples':
          return await this.handleExamples(request, stream, token);
        default:
          return await this.handleGeneral(request, stream, token);
      }
    } catch (error) {
      stream.markdown(`⚠️ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { metadata: { command: command || 'general' } };
    }
  }

  private parseCommand(command: string | undefined): ChatCommand | undefined {
    if (!command) return undefined;
    const validCommands: ChatCommand[] = ['explain', 'search', 'document', 'health', 'examples'];
    return validCommands.includes(command as ChatCommand) ? (command as ChatCommand) : undefined;
  }

  private async updateContext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.chatContext.currentFile = editor.document.uri.fsPath;
      if (!editor.selection.isEmpty) {
        this.chatContext.selectedCode = editor.document.getText(editor.selection);
      }
    }
    this.chatContext.repositoryId = await this.client.getCurrentRepositoryId();
  }

  private async handleExplain(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    if (!this.chatContext.repositoryId) {
      stream.markdown('Please select a DocSynth repository first using the command palette.');
      return { metadata: { command: 'explain' } };
    }

    stream.progress('Searching documentation for context...');

    // Get code context - either selected or from prompt
    const codeToExplain = this.chatContext.selectedCode || request.prompt;

    if (!codeToExplain) {
      stream.markdown('Please select some code or provide code in your message to explain.');
      return { metadata: { command: 'explain' } };
    }

    try {
      const result = await this.client.explainWithDocs(
        this.chatContext.repositoryId,
        codeToExplain,
        this.chatContext.currentFile
      );

      stream.markdown(`## Explanation\n\n${result.explanation}\n\n`);

      if (result.relatedDocs?.length > 0) {
        stream.markdown('### Related Documentation\n\n');
        for (const doc of result.relatedDocs) {
          stream.markdown(`- **[${doc.title}](${doc.path})**: ${doc.excerpt}\n`);
        }
      }

      if (result.codeExamples?.length > 0) {
        stream.markdown('\n### Code Examples\n\n');
        for (const example of result.codeExamples) {
          stream.markdown(`\`\`\`${example.language}\n${example.code}\n\`\`\`\n`);
        }
      }

      return { metadata: { command: 'explain' } };
    } catch (error) {
      stream.markdown(`Unable to explain code: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { metadata: { command: 'explain' } };
    }
  }

  private async handleSearch(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    if (!this.chatContext.repositoryId) {
      stream.markdown('Please select a DocSynth repository first.');
      return { metadata: { command: 'search' } };
    }

    if (!request.prompt) {
      stream.markdown('Please provide a search query.');
      return { metadata: { command: 'search' } };
    }

    stream.progress('Searching documentation...');

    try {
      const results = await this.client.searchDocs(this.chatContext.repositoryId, request.prompt);

      if (results.chunks.length === 0) {
        stream.markdown(`No documentation found for "${request.prompt}".`);
        return { metadata: { command: 'search' } };
      }

      stream.markdown(`## Search Results for "${request.prompt}"\n\n`);

      for (const chunk of results.chunks.slice(0, 5)) {
        stream.markdown(`### ${chunk.documentTitle}\n`);
        stream.markdown(`*${chunk.documentPath}*\n\n`);
        stream.markdown(`${chunk.content.slice(0, 300)}...\n\n`);
        stream.markdown(`---\n\n`);
      }

      if (results.suggestedQueries?.length > 0) {
        stream.markdown('### You might also search for:\n');
        for (const query of results.suggestedQueries) {
          stream.markdown(`- ${query}\n`);
        }
      }

      return { metadata: { command: 'search' } };
    } catch (error) {
      stream.markdown(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { metadata: { command: 'search' } };
    }
  }

  private async handleDocument(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    if (!this.chatContext.selectedCode) {
      stream.markdown('Please select the code you want to document.');
      return { metadata: { command: 'document' } };
    }

    stream.progress('Generating documentation...');

    try {
      const result = await this.client.generateInlineDoc(
        this.chatContext.repositoryId || '',
        this.chatContext.currentFile || '',
        this.chatContext.selectedCode
      );

      stream.markdown(`## Generated Documentation\n\n`);
      stream.markdown(`\`\`\`\n${result.documentation}\n\`\`\`\n\n`);
      stream.markdown('*Copy the above documentation and paste it above your code.*\n\n');

      // Offer a button to insert
      stream.button({
        command: 'docsynth.insertDocumentation',
        title: 'Insert Documentation',
        arguments: [result.documentation],
      });

      return { metadata: { command: 'document' } };
    } catch (error) {
      stream.markdown(`Documentation generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { metadata: { command: 'document' } };
    }
  }

  private async handleHealth(
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    if (!this.chatContext.repositoryId) {
      stream.markdown('Please select a DocSynth repository first.');
      return { metadata: { command: 'health' } };
    }

    stream.progress('Checking documentation health...');

    try {
      const health = await this.client.getHealth(this.chatContext.repositoryId);

      stream.markdown(`## Documentation Health\n\n`);
      stream.markdown(`| Status | Count |\n|--------|-------|\n`);
      stream.markdown(`| 🟢 Fresh | ${health.summary.fresh} |\n`);
      stream.markdown(`| 🟡 Aging | ${health.summary.aging} |\n`);
      stream.markdown(`| 🔴 Stale | ${health.summary.stale} |\n\n`);

      const overallScore = Math.round(
        (health.summary.fresh / (health.summary.fresh + health.summary.aging + health.summary.stale)) * 100
      );
      stream.markdown(`**Overall Health Score: ${overallScore}%**\n\n`);

      if (health.issues?.length > 0) {
        stream.markdown('### Issues to Address\n\n');
        for (const issue of health.issues.slice(0, 5)) {
          stream.markdown(`- ${issue.message} (${issue.documentPath})\n`);
        }
      }

      return { metadata: { command: 'health' } };
    } catch (error) {
      stream.markdown(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { metadata: { command: 'health' } };
    }
  }

  private async handleExamples(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    if (!this.chatContext.repositoryId) {
      stream.markdown('Please select a DocSynth repository first.');
      return { metadata: { command: 'examples' } };
    }

    stream.progress('Finding code examples...');

    try {
      const query = request.prompt || this.chatContext.selectedCode || '';
      const examples = await this.client.findExamples(this.chatContext.repositoryId, query);

      if (examples.length === 0) {
        stream.markdown('No code examples found for this query.');
        return { metadata: { command: 'examples' } };
      }

      stream.markdown(`## Code Examples\n\n`);

      for (const example of examples.slice(0, 3)) {
        stream.markdown(`### ${example.title}\n`);
        if (example.description) {
          stream.markdown(`${example.description}\n\n`);
        }
        stream.markdown(`\`\`\`${example.language}\n${example.code}\n\`\`\`\n\n`);
      }

      return { metadata: { command: 'examples' } };
    } catch (error) {
      stream.markdown(`Failed to find examples: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { metadata: { command: 'examples' } };
    }
  }

  private async handleGeneral(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    if (!this.chatContext.repositoryId) {
      stream.markdown(
        `Welcome to **DocSynth**! 📚\n\n` +
          `I can help you with your documentation. To get started:\n\n` +
          `1. Select a repository using \`DocSynth: Select Repository\` from the command palette\n` +
          `2. Ask me questions about your documentation!\n\n` +
          `**Available Commands:**\n` +
          `- \`@${PARTICIPANT_NAME} /search <query>\` - Search documentation\n` +
          `- \`@${PARTICIPANT_NAME} /explain\` - Explain selected code using docs\n` +
          `- \`@${PARTICIPANT_NAME} /document\` - Generate documentation for selection\n` +
          `- \`@${PARTICIPANT_NAME} /health\` - Check documentation health\n` +
          `- \`@${PARTICIPANT_NAME} /examples <topic>\` - Find code examples\n`
      );
      return { metadata: { command: 'general' } };
    }

    // General question - use RAG to answer
    stream.progress('Searching documentation for answer...');

    try {
      const result = await this.client.askQuestion(this.chatContext.repositoryId, request.prompt);

      stream.markdown(result.answer + '\n\n');

      if (result.sources?.length > 0) {
        stream.markdown('### Sources\n\n');
        for (const source of result.sources) {
          stream.markdown(`- [${source.title}](${source.path})\n`);
        }
      }

      if (result.confidence < 0.5) {
        stream.markdown(
          '\n*Note: This answer has low confidence. The information might not be in your documentation.*\n'
        );
      }

      return { metadata: { command: 'general' } };
    } catch (error) {
      stream.markdown(`Unable to answer: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { metadata: { command: 'general' } };
    }
  }

  private async provideFollowups(
    result: vscode.ChatResult,
    _context: vscode.ChatContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.ChatFollowup[]> {
    const followups: vscode.ChatFollowup[] = [];
    const command = (result.metadata as { command?: string })?.command;

    switch (command) {
      case 'search':
        followups.push({
          prompt: 'Show me related documentation',
          label: 'Related Docs',
        });
        break;
      case 'explain':
        followups.push({
          prompt: 'Generate documentation for this code',
          label: 'Generate Docs',
          command: 'document',
        });
        followups.push({
          prompt: 'Show me similar examples',
          label: 'Examples',
          command: 'examples',
        });
        break;
      case 'document':
        followups.push({
          prompt: 'Check documentation health',
          label: 'Health Check',
          command: 'health',
        });
        break;
      case 'health':
        followups.push({
          prompt: 'What documentation needs updating?',
          label: 'What to Update',
        });
        break;
      default:
        followups.push({
          prompt: 'Search the documentation',
          label: 'Search',
          command: 'search',
        });
        followups.push({
          prompt: 'Check documentation health',
          label: 'Health',
          command: 'health',
        });
    }

    return followups;
  }
}

export function registerCopilotChatParticipant(client: DocSynthClient, context: vscode.ExtensionContext): void {
  const participant = new CopilotChatParticipant(client);
  participant.register(context);
}
