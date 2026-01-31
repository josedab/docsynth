import * as vscode from 'vscode';
import { DocSynthClient } from './client';

export class SuggestionsProvider implements vscode.TreeDataProvider<SuggestionItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SuggestionItem | undefined | null | void> =
    new vscode.EventEmitter<SuggestionItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SuggestionItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private client: DocSynthClient;
  private suggestions: Array<{
    type: string;
    message: string;
    location: { line: number; character: number };
    severity: 'info' | 'warning' | 'error';
  }> = [];

  constructor(client: DocSynthClient) {
    this.client = client;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  updateSuggestions(suggestions: typeof this.suggestions): void {
    this.suggestions = suggestions;
    this.refresh();
  }

  getTreeItem(element: SuggestionItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SuggestionItem): Promise<SuggestionItem[]> {
    if (!element) {
      if (this.suggestions.length === 0) {
        return [
          new SuggestionItem(
            'No suggestions',
            'Open a file to see documentation suggestions',
            'info'
          ),
        ];
      }

      return this.suggestions.map(
        (s) => new SuggestionItem(s.message, `Line ${s.location.line}`, s.severity)
      );
    }

    return [];
  }
}

class SuggestionItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    severity: 'info' | 'warning' | 'error'
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${label}\n${description}`;

    switch (severity) {
      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
      case 'warning':
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('editorError.foreground'));
        break;
    }
  }
}
