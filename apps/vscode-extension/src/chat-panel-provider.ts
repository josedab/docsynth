import * as vscode from 'vscode';
import { DocSynthClient } from './client';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sources?: Array<{ path: string; line?: number }>;
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'docsynth.chatPanel';
  private _view?: vscode.WebviewView;
  private _messages: ChatMessage[] = [];
  private _isProcessing = false;

  constructor(
    private readonly client: DocSynthClient,
    private readonly extensionUri: vscode.Uri
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this.handleUserMessage(data.message);
          break;
        case 'clearChat':
          this._messages = [];
          this.updateChatView();
          break;
        case 'explainSelection':
          await this.explainSelectedCode();
          break;
        case 'documentFunction':
          await this.documentCurrentFunction();
          break;
      }
    });
  }

  async handleUserMessage(message: string): Promise<void> {
    if (this._isProcessing || !message.trim()) {
      return;
    }

    this._isProcessing = true;
    this._messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
    this.updateChatView();

    try {
      const repositoryId = await this.client.getCurrentRepositoryId();
      if (!repositoryId) {
        this._messages.push({
          role: 'assistant',
          content: 'Please select a repository first using the "DocSynth: Select Repository" command.',
          timestamp: new Date(),
        });
        this.updateChatView();
        return;
      }

      // Get current file context
      const editor = vscode.window.activeTextEditor;
      const fileContext = editor
        ? {
            filePath: editor.document.uri.fsPath,
            language: editor.document.languageId,
            content: editor.document.getText(),
            selection: editor.selection.isEmpty ? undefined : editor.document.getText(editor.selection),
          }
        : undefined;

      const response = await this.client.chatWithDocs(repositoryId, message, fileContext);

      this._messages.push({
        role: 'assistant',
        content: response.answer,
        timestamp: new Date(),
        sources: response.sources,
      });
    } catch (error) {
      this._messages.push({
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
        timestamp: new Date(),
      });
    } finally {
      this._isProcessing = false;
      this.updateChatView();
    }
  }

  async explainSelectedCode(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor');
      return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('Please select some code to explain');
      return;
    }

    const selectedText = editor.document.getText(selection);
    const question = `Explain this code:\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;

    await this.handleUserMessage(question);
  }

  async documentCurrentFunction(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor');
      return;
    }

    const position = editor.selection.active;
    const document = editor.document;

    // Find the function at current position (simple heuristic)
    let functionStart = position.line;
    while (functionStart > 0) {
      const line = document.lineAt(functionStart).text;
      if (
        line.match(/^(export\s+)?(async\s+)?function\s+\w+/) ||
        line.match(/^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/) ||
        line.match(/^(export\s+)?class\s+\w+/) ||
        line.match(/^\s*(public|private|protected)?\s*(async\s+)?\w+\s*\(/)
      ) {
        break;
      }
      functionStart--;
    }

    let functionEnd = position.line;
    let braceCount = 0;
    let started = false;

    while (functionEnd < document.lineCount) {
      const line = document.lineAt(functionEnd).text;
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            break;
          }
        }
      }
      if (started && braceCount === 0) break;
      functionEnd++;
    }

    const range = new vscode.Range(functionStart, 0, functionEnd, document.lineAt(functionEnd).text.length);
    const functionCode = document.getText(range);

    const question = `Generate documentation for this function:\n\`\`\`${document.languageId}\n${functionCode}\n\`\`\``;
    await this.handleUserMessage(question);
  }

  insertDocumentation(documentation: string): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const position = editor.selection.start;
    editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(position.line, 0), documentation + '\n');
    });
  }

  private updateChatView(): void {
    if (!this._view) return;

    this._view.webview.postMessage({
      type: 'updateChat',
      messages: this._messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
        sources: m.sources,
      })),
      isProcessing: this._isProcessing,
    });
  }

  private _getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DocSynth Chat</title>
  <style>
    body {
      padding: 10px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .chat-container {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 100px);
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 10px;
    }
    .message {
      padding: 8px 12px;
      margin: 4px 0;
      border-radius: 8px;
      max-width: 90%;
    }
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-left: auto;
    }
    .message.assistant {
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .sources {
      font-size: 0.8em;
      margin-top: 6px;
      opacity: 0.7;
    }
    .input-container {
      display: flex;
      gap: 8px;
    }
    input {
      flex: 1;
      padding: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
    }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .quick-actions {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }
    .quick-action {
      padding: 4px 8px;
      font-size: 0.85em;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .typing-indicator {
      display: none;
      padding: 8px;
      opacity: 0.6;
    }
    .typing-indicator.visible {
      display: block;
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
    }
    code {
      font-family: var(--vscode-editor-font-family);
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="quick-actions">
      <button class="quick-action" onclick="explainSelection()">Explain Selection</button>
      <button class="quick-action" onclick="documentFunction()">Document Function</button>
      <button class="quick-action" onclick="clearChat()">Clear</button>
    </div>
    <div class="messages" id="messages"></div>
    <div class="typing-indicator" id="typing">DocSynth is thinking...</div>
    <div class="input-container">
      <input type="text" id="input" placeholder="Ask about your documentation..." />
      <button onclick="sendMessage()">Send</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const typingEl = document.getElementById('typing');

    function sendMessage() {
      const message = inputEl.value.trim();
      if (!message) return;
      inputEl.value = '';
      vscode.postMessage({ type: 'sendMessage', message });
    }

    function clearChat() {
      vscode.postMessage({ type: 'clearChat' });
    }

    function explainSelection() {
      vscode.postMessage({ type: 'explainSelection' });
    }

    function documentFunction() {
      vscode.postMessage({ type: 'documentFunction' });
    }

    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data.type === 'updateChat') {
        renderMessages(data.messages);
        typingEl.classList.toggle('visible', data.isProcessing);
      }
    });

    function renderMessages(messages) {
      messagesEl.innerHTML = messages.map(m => {
        let content = m.content;
        // Simple markdown rendering
        content = content.replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
        content = content.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
        
        let sources = '';
        if (m.sources && m.sources.length > 0) {
          sources = '<div class="sources">Sources: ' + 
            m.sources.map(s => s.path + (s.line ? ':' + s.line : '')).join(', ') + 
            '</div>';
        }
        
        return '<div class="message ' + m.role + '">' + content + sources + '</div>';
      }).join('');
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  </script>
</body>
</html>`;
  }
}
