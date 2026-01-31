import * as vscode from 'vscode';
import { DocSynthClient } from './client';

// ============================================================================
// Types
// ============================================================================

interface PreviewItem {
  type: string;
  title: string;
  contentPreview: string;
  affectedSections: string[];
  estimatedLength: number;
}

interface Suggestion {
  type: string;
  message: string;
  location: { line: number; character: number };
  severity: 'info' | 'warning' | 'error';
  quickFix?: { title: string; replacement: string };
}

interface StyleWarning {
  rule: string;
  message: string;
  location: { line: number; character: number };
  expected: string;
  actual: string;
}

interface DocPreview {
  wouldGenerateDocs: boolean;
  documentTypes: string[];
  preview: PreviewItem[];
  suggestions: Suggestion[];
  styleWarnings: StyleWarning[];
  confidence: number;
}

// ============================================================================
// Provider
// ============================================================================

export class DocPreviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private client: DocSynthClient;
  private context: vscode.ExtensionContext;

  constructor(client: DocSynthClient, context: vscode.ExtensionContext) {
    this.client = client;
    this.context = context;
  }

  showPreview(preview: DocPreview): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'docsynthPreview',
        'DocSynth Preview',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }

    this.panel.webview.html = this.getWebviewContent(preview);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  updatePreview(preview: DocPreview): void {
    if (this.panel) {
      this.panel.webview.html = this.getWebviewContent(preview);
    }
  }

  private getWebviewContent(preview: DocPreview): string {
    const suggestions = preview.suggestions || [];
    const styleWarnings = preview.styleWarnings || [];
    const previews = preview.preview || [];

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DocSynth Preview</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 16px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    h2 {
      color: var(--vscode-titleBar-activeForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 8px;
    }
    .section {
      margin-bottom: 24px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      margin-right: 4px;
    }
    .badge-success { background: var(--vscode-testing-iconPassed); color: white; }
    .badge-warning { background: var(--vscode-editorWarning-foreground); color: white; }
    .badge-error { background: var(--vscode-editorError-foreground); color: white; }
    .badge-info { background: var(--vscode-editorInfo-foreground); color: white; }
    .suggestion {
      padding: 8px;
      margin: 8px 0;
      border-left: 3px solid var(--vscode-editorWarning-foreground);
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .warning {
      padding: 8px;
      margin: 8px 0;
      border-left: 3px solid var(--vscode-editorError-foreground);
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .preview-item {
      padding: 12px;
      margin: 8px 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    .confidence {
      font-size: 14px;
      color: var(--vscode-descriptionForeground);
    }
    .doc-type {
      font-weight: bold;
      color: var(--vscode-textLink-foreground);
    }
    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <h2>📄 DocSynth Preview</h2>
  
  <div class="section">
    <h3>Documentation Status</h3>
    ${preview.wouldGenerateDocs 
      ? `<span class="badge badge-success">Would Generate Docs</span>
         <span class="confidence">Confidence: ${preview.confidence}%</span>`
      : `<span class="badge badge-info">No Docs Needed</span>`
    }
    ${preview.documentTypes?.map((t: string) => `<span class="badge badge-info">${t}</span>`).join('') || ''}
  </div>

  ${previews.length > 0 ? `
  <div class="section">
    <h3>Document Previews</h3>
    ${previews.map((p: PreviewItem) => `
      <div class="preview-item">
        <span class="doc-type">${p.type}</span> - ${p.title}
        <p>${p.contentPreview}</p>
        <small>Estimated length: ${p.estimatedLength} characters</small>
      </div>
    `).join('')}
  </div>
  ` : ''}

  ${suggestions.length > 0 ? `
  <div class="section">
    <h3>Suggestions (${suggestions.length})</h3>
    ${suggestions.map((s: Suggestion) => `
      <div class="suggestion">
        <span class="badge badge-${s.severity}">${s.severity}</span>
        <strong>${s.type}</strong>
        <p>${s.message}</p>
        <small>Line ${s.location.line}</small>
        ${s.quickFix ? `<br><button onclick="applyFix('${encodeURIComponent(s.quickFix.replacement)}')">Apply: ${s.quickFix.title}</button>` : ''}
      </div>
    `).join('')}
  </div>
  ` : ''}

  ${styleWarnings.length > 0 ? `
  <div class="section">
    <h3>Style Warnings (${styleWarnings.length})</h3>
    ${styleWarnings.map((w: StyleWarning) => `
      <div class="warning">
        <strong>${w.rule}</strong>
        <p>${w.message}</p>
        <small>Line ${w.location.line} | Expected: ${w.expected} | Actual: ${w.actual}</small>
      </div>
    `).join('')}
  </div>
  ` : ''}

  ${previews.length === 0 && suggestions.length === 0 && styleWarnings.length === 0 ? `
  <div class="empty-state">
    <p>No documentation suggestions for this file.</p>
    <p>This file may not contain documentation-worthy changes.</p>
  </div>
  ` : ''}
</body>
</html>`;
  }
}
