import * as vscode from 'vscode';
import { DocSynthClient } from './client';
import { DocPreviewProvider } from './preview-provider';
import { HealthTreeProvider } from './health-tree-provider';
import { SuggestionsProvider } from './suggestions-provider';
import { InlineDocProvider } from './inline-doc-provider';
import { ChatPanelProvider } from './chat-panel-provider';
import { ProactiveSuggestionsProvider, type UndocumentedItem } from './proactive-suggestions-provider';

let client: DocSynthClient;
let previewProvider: DocPreviewProvider;
let healthProvider: HealthTreeProvider;
let chatPanelProvider: ChatPanelProvider;
let proactiveSuggestionsProvider: ProactiveSuggestionsProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('DocSynth extension is now active');

  // Initialize client
  const config = vscode.workspace.getConfiguration('docsynth');
  client = new DocSynthClient(
    config.get('apiUrl') || 'https://api.docsynth.io',
    context.globalState
  );

  // Initialize providers
  previewProvider = new DocPreviewProvider(client, context);
  healthProvider = new HealthTreeProvider(client);
  const suggestionsProvider = new SuggestionsProvider(client);
  const inlineDocProvider = new InlineDocProvider(client);
  chatPanelProvider = new ChatPanelProvider(client, context.extensionUri);
  proactiveSuggestionsProvider = new ProactiveSuggestionsProvider(client);

  // Register tree views
  vscode.window.registerTreeDataProvider('docsynth.health', healthProvider);
  vscode.window.registerTreeDataProvider('docsynth.suggestions', suggestionsProvider);

  // Register chat panel
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelProvider.viewType, chatPanelProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('docsynth.generateDocs', () => generateDocs()),
    vscode.commands.registerCommand('docsynth.previewDocs', () => previewDocs()),
    vscode.commands.registerCommand('docsynth.checkHealth', () => checkHealth()),
    vscode.commands.registerCommand('docsynth.addInlineDoc', () => addInlineDoc(inlineDocProvider)),
    vscode.commands.registerCommand('docsynth.login', () => login()),
    vscode.commands.registerCommand('docsynth.selectRepository', () => selectRepository()),
    // New commands for real-time copilot chat
    vscode.commands.registerCommand('docsynth.explainSelection', () => chatPanelProvider.explainSelectedCode()),
    vscode.commands.registerCommand('docsynth.documentFunction', () => chatPanelProvider.documentCurrentFunction()),
    vscode.commands.registerCommand('docsynth.showUndocumented', () => showUndocumented()),
    vscode.commands.registerCommand('docsynth.generateDocForItem', (item) => generateDocForItem(item)),
    vscode.commands.registerCommand('docsynth.openChatPanel', () => openChatPanel())
  );

  // Register document change listener for auto-preview
  if (config.get('autoPreview')) {
    const debounceMs = config.get<number>('previewDebounceMs') || 500;
    let debounceTimer: NodeJS.Timeout | undefined;

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          handleDocumentChange(event.document);
        }, debounceMs);
      })
    );
  }

  // Register save listener for style checking
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      checkStyleOnSave(document);
    })
  );

  // Register code lens provider for inline hints
  if (config.get('showInlineHints')) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        [
          { language: 'typescript' },
          { language: 'javascript' },
          { language: 'python' },
        ],
        inlineDocProvider
      )
    );
  }

  // Check authentication status
  if (!client.isAuthenticated()) {
    vscode.window.showInformationMessage(
      'DocSynth: Please login to enable all features',
      'Login'
    ).then((selection) => {
      if (selection === 'Login') {
        vscode.commands.executeCommand('docsynth.login');
      }
    });
  }

  // Register proactive suggestions provider for cleanup
  context.subscriptions.push(proactiveSuggestionsProvider);
}

export function deactivate() {
  console.log('DocSynth extension is now deactivated');
  if (proactiveSuggestionsProvider) {
    proactiveSuggestionsProvider.dispose();
  }
}

async function generateDocs() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  if (!client.isAuthenticated()) {
    vscode.window.showWarningMessage('Please login to DocSynth first');
    return;
  }

  const repositoryId = await client.getCurrentRepositoryId();
  if (!repositoryId) {
    vscode.window.showWarningMessage('Please select a repository first');
    return;
  }

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating documentation...',
      cancellable: false,
    },
    async () => {
      try {
        const result = await client.generateDocs(repositoryId, editor.document.uri.fsPath);
        vscode.window.showInformationMessage(
          `Documentation generated: ${result.documentsGenerated} documents`
        );
        healthProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to generate documentation: ${error}`);
      }
    }
  );
}

async function previewDocs() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const repositoryId = await client.getCurrentRepositoryId();
  if (!repositoryId) {
    vscode.window.showWarningMessage('Please select a repository first');
    return;
  }

  try {
    const preview = await client.getPreview(
      repositoryId,
      editor.document.uri.fsPath,
      editor.document.getText()
    );
    previewProvider.showPreview(preview);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get preview: ${error}`);
  }
}

async function checkHealth() {
  const repositoryId = await client.getCurrentRepositoryId();
  if (!repositoryId) {
    vscode.window.showWarningMessage('Please select a repository first');
    return;
  }

  try {
    const health = await client.getHealth(repositoryId);
    healthProvider.updateHealth(health);
    vscode.window.showInformationMessage(
      `Documentation Health: ${health.summary.fresh} fresh, ${health.summary.aging} aging, ${health.summary.stale} stale`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to check health: ${error}`);
  }
}

async function addInlineDoc(provider: InlineDocProvider) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('Please select a code block');
    return;
  }

  const selectedText = editor.document.getText(selection);
  const repositoryId = await client.getCurrentRepositoryId();

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating documentation...',
      cancellable: false,
    },
    async () => {
      try {
        const doc = await provider.generateDocumentation(
          repositoryId || '',
          editor.document.uri.fsPath,
          selectedText
        );

        // Insert documentation above the selection
        await editor.edit((editBuilder) => {
          editBuilder.insert(selection.start, doc.documentation + '\n');
        });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to generate documentation: ${error}`);
      }
    }
  );
}

async function login() {
  const token = await vscode.window.showInputBox({
    prompt: 'Enter your DocSynth API token',
    password: true,
    placeHolder: 'ds_...',
  });

  if (token) {
    try {
      await client.authenticate(token);
      vscode.window.showInformationMessage('Successfully logged in to DocSynth');
      healthProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Login failed: ${error}`);
    }
  }
}

async function selectRepository() {
  if (!client.isAuthenticated()) {
    vscode.window.showWarningMessage('Please login first');
    return;
  }

  try {
    const repos = await client.listRepositories();
    const selected = await vscode.window.showQuickPick(
      repos.map((r) => ({
        label: r.name,
        description: r.githubFullName,
        id: r.id,
      })),
      { placeHolder: 'Select a repository' }
    );

    if (selected) {
      await client.setCurrentRepository(selected.id);
      vscode.window.showInformationMessage(`Selected repository: ${selected.label}`);
      healthProvider.refresh();
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to list repositories: ${error}`);
  }
}

async function handleDocumentChange(document: vscode.TextDocument) {
  // Skip if not in a supported language
  const supportedLanguages = ['typescript', 'javascript', 'python', 'go', 'rust'];
  if (!supportedLanguages.includes(document.languageId)) {
    return;
  }

  // Skip if file matches exclude patterns
  const config = vscode.workspace.getConfiguration('docsynth');
  const excludePatterns = config.get<string[]>('excludePatterns') || [];
  const filePath = document.uri.fsPath;

  for (const pattern of excludePatterns) {
    if (matchGlob(filePath, pattern)) {
      return;
    }
  }

  // Get preview for the document
  const repositoryId = await client.getCurrentRepositoryId();
  if (!repositoryId) {
    return;
  }

  try {
    const preview = await client.getPreview(repositoryId, filePath, document.getText());
    previewProvider.updatePreview(preview);
  } catch (error) {
    // Silently fail for auto-preview
    console.error('Auto-preview failed:', error);
  }
}

async function checkStyleOnSave(document: vscode.TextDocument) {
  const config = vscode.workspace.getConfiguration('docsynth');
  const enforcement = config.get<string>('styleEnforcement');

  if (enforcement === 'off') {
    return;
  }

  const repositoryId = await client.getCurrentRepositoryId();
  if (!repositoryId) {
    return;
  }

  try {
    const styleResult = await client.checkStyle(
      repositoryId,
      document.uri.fsPath,
      document.getText()
    );

    if (styleResult.warnings.length > 0) {
      const diagnostics: vscode.Diagnostic[] = styleResult.warnings.map((w) => {
        const range = new vscode.Range(
          w.location.line - 1,
          w.location.character,
          w.location.line - 1,
          w.location.character + 1
        );
        return new vscode.Diagnostic(
          range,
          w.message,
          enforcement === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning
        );
      });

      const diagnosticCollection = vscode.languages.createDiagnosticCollection('docsynth');
      diagnosticCollection.set(document.uri, diagnostics);
    }
  } catch (error) {
    console.error('Style check failed:', error);
  }
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching (could use a proper glob library)
  const regexPattern = pattern
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(regexPattern).test(filePath);
}

// New functions for real-time copilot features

async function showUndocumented() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const items = proactiveSuggestionsProvider.getUndocumentedItems(editor.document.uri);
  
  if (items.length === 0) {
    vscode.window.showInformationMessage('All exported items are documented! 🎉');
    return;
  }

  const selected = await vscode.window.showQuickPick(
    items.map((item) => ({
      label: `$(symbol-${item.type}) ${item.name}`,
      description: `Line ${item.line}`,
      detail: item.isExported ? '$(export) Exported' : 'Internal',
      item,
    })),
    {
      placeHolder: `${items.length} undocumented items found`,
      title: 'Undocumented Items',
    }
  );

  if (selected) {
    // Jump to the line
    const position = new vscode.Position(selected.item.line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

    // Offer to generate documentation
    const action = await vscode.window.showInformationMessage(
      `Generate documentation for ${selected.item.name}?`,
      'Generate',
      'Skip'
    );

    if (action === 'Generate') {
      await generateDocForItem(selected.item);
    }
  }
}

async function generateDocForItem(item: UndocumentedItem) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating documentation for ${item.name}...`,
      cancellable: false,
    },
    async () => {
      try {
        const documentation = await proactiveSuggestionsProvider.generateDocForItem(item);
        
        if (documentation) {
          await editor.edit((editBuilder) => {
            const position = new vscode.Position(item.line - 1, 0);
            editBuilder.insert(position, documentation + '\n');
          });

          vscode.window.showInformationMessage(`Documentation added for ${item.name}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to generate documentation: ${error}`);
      }
    }
  );
}

async function openChatPanel() {
  // Focus the chat panel view
  await vscode.commands.executeCommand('docsynth.chatPanel.focus');
}
