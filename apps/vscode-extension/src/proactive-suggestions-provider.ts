import * as vscode from 'vscode';
import { DocSynthClient } from './client';

export interface UndocumentedItem {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method';
  filePath: string;
  line: number;
  isExported: boolean;
}

export class ProactiveSuggestionsProvider implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];
  private analysisCache: Map<string, UndocumentedItem[]> = new Map();

  constructor(private readonly client: DocSynthClient) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: ' 📝 Add documentation',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        fontStyle: 'italic',
        margin: '0 0 0 1em',
      },
      isWholeLine: true,
    });

    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('docsynth-suggestions');
    
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'docsynth.showUndocumented';
    this.statusBarItem.tooltip = 'DocSynth: Undocumented items';

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.analyzeDocument(editor.document);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.analyzeDocument(document);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Debounced analysis on change
        if (this.isAnalyzableDocument(event.document)) {
          this.scheduleAnalysis(event.document);
        }
      })
    );

    // Analyze current document
    if (vscode.window.activeTextEditor) {
      this.analyzeDocument(vscode.window.activeTextEditor.document);
    }
  }

  private analysisTimer: NodeJS.Timeout | undefined;

  private scheduleAnalysis(document: vscode.TextDocument): void {
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
    }
    this.analysisTimer = setTimeout(() => {
      this.analyzeDocument(document);
    }, 1500);
  }

  private isAnalyzableDocument(document: vscode.TextDocument): boolean {
    const supportedLanguages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python'];
    return supportedLanguages.includes(document.languageId);
  }

  async analyzeDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.isAnalyzableDocument(document)) {
      return;
    }

    const config = vscode.workspace.getConfiguration('docsynth');
    if (!config.get('proactiveSuggestions')) {
      this.clearDecorations();
      return;
    }

    const undocumented = await this.findUndocumentedItems(document);
    this.analysisCache.set(document.uri.toString(), undocumented);

    this.updateDecorations(document, undocumented);
    this.updateDiagnostics(document, undocumented);
    this.updateStatusBar(undocumented);
  }

  private async findUndocumentedItems(document: vscode.TextDocument): Promise<UndocumentedItem[]> {
    const items: UndocumentedItem[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Language-specific patterns
    const patterns = this.getPatternsForLanguage(document.languageId);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          const name = match[pattern.nameGroup];
          if (!name) continue;

          // Check if previous lines have documentation
          const hasDoc = this.hasDocumentation(lines, i, document.languageId);

          if (!hasDoc) {
            items.push({
              name,
              type: pattern.type,
              filePath: document.uri.fsPath,
              line: i + 1,
              isExported: pattern.isExported ? pattern.isExported(line) : false,
            });
          }
        }
      }
    }

    // Prioritize exported items
    items.sort((a, b) => {
      if (a.isExported && !b.isExported) return -1;
      if (!a.isExported && b.isExported) return 1;
      return a.line - b.line;
    });

    return items;
  }

  private getPatternsForLanguage(languageId: string): Array<{
    regex: RegExp;
    nameGroup: number;
    type: UndocumentedItem['type'];
    isExported?: (line: string) => boolean;
  }> {
    if (languageId === 'typescript' || languageId === 'typescriptreact' ||
        languageId === 'javascript' || languageId === 'javascriptreact') {
      return [
        {
          regex: /^(export\s+)?(async\s+)?function\s+(\w+)/,
          nameGroup: 3,
          type: 'function',
          isExported: (line) => line.startsWith('export'),
        },
        {
          regex: /^(export\s+)?class\s+(\w+)/,
          nameGroup: 2,
          type: 'class',
          isExported: (line) => line.startsWith('export'),
        },
        {
          regex: /^(export\s+)?interface\s+(\w+)/,
          nameGroup: 2,
          type: 'interface',
          isExported: (line) => line.startsWith('export'),
        },
        {
          regex: /^(export\s+)?type\s+(\w+)/,
          nameGroup: 2,
          type: 'type',
          isExported: (line) => line.startsWith('export'),
        },
        {
          regex: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/,
          nameGroup: 2,
          type: 'function',
          isExported: (line) => line.startsWith('export'),
        },
        {
          regex: /^\s*(public|private|protected)?\s*(static\s+)?(async\s+)?(\w+)\s*\(/,
          nameGroup: 4,
          type: 'method',
        },
      ];
    }

    if (languageId === 'python') {
      return [
        {
          regex: /^(async\s+)?def\s+(\w+)/,
          nameGroup: 2,
          type: 'function',
          isExported: (line) => !line.match(/^\s+/), // Top-level functions
        },
        {
          regex: /^class\s+(\w+)/,
          nameGroup: 1,
          type: 'class',
          isExported: () => true,
        },
      ];
    }

    return [];
  }

  private hasDocumentation(lines: string[], lineIndex: number, languageId: string): boolean {
    if (lineIndex === 0) return false;

    // Look at previous lines for doc comments
    const prevLine = lines[lineIndex - 1]?.trim() ?? '';

    if (languageId === 'typescript' || languageId === 'javascript' ||
        languageId === 'typescriptreact' || languageId === 'javascriptreact') {
      // Check for JSDoc ending
      if (prevLine.endsWith('*/')) return true;
      // Check for single-line JSDoc
      if (prevLine.match(/^\/\*\*.*\*\/$/)) return true;
      // Check for // comment
      if (prevLine.startsWith('//')) return true;
    }

    if (languageId === 'python') {
      // Check for docstring on next line
      const nextLine = lines[lineIndex + 1]?.trim() ?? '';
      if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) return true;
      // Check for # comment
      if (prevLine.startsWith('#')) return true;
    }

    return false;
  }

  private updateDecorations(document: vscode.TextDocument, items: UndocumentedItem[]): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
      return;
    }

    const config = vscode.workspace.getConfiguration('docsynth');
    const showInline = config.get<boolean>('showInlineDocHints', true);

    if (!showInline) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    // Only show decorations for exported items (to avoid noise)
    const decorations: vscode.DecorationOptions[] = items
      .filter((item) => item.isExported)
      .slice(0, 10) // Limit to 10 items
      .map((item) => ({
        range: new vscode.Range(item.line - 1, 0, item.line - 1, 0),
        hoverMessage: new vscode.MarkdownString(
          `**${item.type}** \`${item.name}\` is missing documentation.\n\n` +
          `[Generate Documentation](command:docsynth.generateDocForItem?${encodeURIComponent(JSON.stringify(item))})`
        ),
      }));

    editor.setDecorations(this.decorationType, decorations);
  }

  private updateDiagnostics(document: vscode.TextDocument, items: UndocumentedItem[]): void {
    const config = vscode.workspace.getConfiguration('docsynth');
    const severity = config.get<string>('undocumentedSeverity', 'hint');

    if (severity === 'off') {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = items
      .filter((item) => item.isExported)
      .map((item) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(item.line - 1, 0, item.line - 1, 100),
          `${item.type} '${item.name}' is exported but not documented`,
          severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : severity === 'info'
            ? vscode.DiagnosticSeverity.Information
            : vscode.DiagnosticSeverity.Hint
        );
        diagnostic.code = 'docsynth-undocumented';
        diagnostic.source = 'DocSynth';
        return diagnostic;
      });

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private updateStatusBar(items: UndocumentedItem[]): void {
    const exportedCount = items.filter((i) => i.isExported).length;
    
    if (exportedCount === 0) {
      this.statusBarItem.hide();
    } else {
      this.statusBarItem.text = `$(book) ${exportedCount} undocumented`;
      this.statusBarItem.backgroundColor = exportedCount > 5
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
      this.statusBarItem.show();
    }
  }

  private clearDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(this.decorationType, []);
    }
    this.diagnosticCollection.clear();
    this.statusBarItem.hide();
  }

  getUndocumentedItems(uri: vscode.Uri): UndocumentedItem[] {
    return this.analysisCache.get(uri.toString()) ?? [];
  }

  async generateDocForItem(item: UndocumentedItem): Promise<string | undefined> {
    const repositoryId = await this.client.getCurrentRepositoryId();
    if (!repositoryId) {
      vscode.window.showWarningMessage('Please select a repository first');
      return undefined;
    }

    try {
      const document = await vscode.workspace.openTextDocument(item.filePath);
      
      // Find the end of the item
      let endLine = item.line;
      let braceCount = 0;
      let started = false;

      for (let i = item.line - 1; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        for (const char of line) {
          if (char === '{' || char === '(') {
            braceCount++;
            started = true;
          } else if (char === '}' || char === ')') {
            braceCount--;
            if (started && braceCount === 0) {
              endLine = i + 1;
              break;
            }
          }
        }
        if (started && braceCount === 0) break;
      }

      const range = new vscode.Range(item.line - 1, 0, endLine - 1, document.lineAt(endLine - 1).text.length);
      const code = document.getText(range);

      // Map item type to documentation style
      const styleMap: Record<string, 'jsdoc' | 'tsdoc' | 'docstring'> = {
        function: 'jsdoc',
        method: 'jsdoc',
        class: 'jsdoc',
        interface: 'tsdoc',
        type: 'tsdoc',
        variable: 'jsdoc',
      };
      const style = styleMap[item.type] ?? 'jsdoc';

      const response = await this.client.generateInlineDoc(repositoryId, item.filePath, code, style);
      return response.documentation;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to generate documentation: ${error}`);
      return undefined;
    }
  }

  dispose(): void {
    this.decorationType.dispose();
    this.diagnosticCollection.dispose();
    this.statusBarItem.dispose();
    this.disposables.forEach((d) => d.dispose());
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
    }
  }
}
