import * as vscode from 'vscode';
import { DocSynthClient } from './client';

interface HealthData {
  repositoryId: string;
  summary: {
    fresh: number;
    aging: number;
    stale: number;
  };
  documents: Array<{
    path: string;
    type: string;
    status: 'fresh' | 'aging' | 'stale';
    daysSinceUpdate: number;
  }>;
}

export class HealthTreeProvider implements vscode.TreeDataProvider<HealthItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<HealthItem | undefined | null | void> =
    new vscode.EventEmitter<HealthItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<HealthItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private client: DocSynthClient;
  private healthData: HealthData | null = null;

  constructor(client: DocSynthClient) {
    this.client = client;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  updateHealth(health: HealthData): void {
    this.healthData = health;
    this.refresh();
  }

  getTreeItem(element: HealthItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: HealthItem): Promise<HealthItem[]> {
    if (!this.healthData) {
      return [
        new HealthItem(
          'No health data',
          'Run "Check Documentation Health" to load',
          vscode.TreeItemCollapsibleState.None,
          'info'
        ),
      ];
    }

    if (!element) {
      // Root level - show summary
      const items: HealthItem[] = [
        new HealthItem(
          `Fresh: ${this.healthData.summary.fresh}`,
          'Documents updated within 7 days',
          vscode.TreeItemCollapsibleState.Collapsed,
          'fresh'
        ),
        new HealthItem(
          `Aging: ${this.healthData.summary.aging}`,
          'Documents updated 8-30 days ago',
          vscode.TreeItemCollapsibleState.Collapsed,
          'aging'
        ),
        new HealthItem(
          `Stale: ${this.healthData.summary.stale}`,
          'Documents not updated in 30+ days',
          vscode.TreeItemCollapsibleState.Collapsed,
          'stale'
        ),
      ];
      return items;
    }

    // Show documents for each category
    const status = element.status;
    if (status) {
      return this.healthData.documents
        .filter((d) => d.status === status)
        .map(
          (d) =>
            new HealthItem(
              d.path,
              `${d.type} - ${d.daysSinceUpdate} days since update`,
              vscode.TreeItemCollapsibleState.None,
              d.status
            )
        );
    }

    return [];
  }
}

class HealthItem extends vscode.TreeItem {
  public status?: 'fresh' | 'aging' | 'stale' | 'info';

  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    status: 'fresh' | 'aging' | 'stale' | 'info'
  ) {
    super(label, collapsibleState);
    this.status = status;
    this.tooltip = description;

    // Set icon based on status
    switch (status) {
      case 'fresh':
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        break;
      case 'aging':
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        break;
      case 'stale':
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('editorError.foreground'));
        break;
      case 'info':
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }
}
