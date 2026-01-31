import * as vscode from 'vscode';
import { DocSynthClient } from './client';

export class InlineDocProvider implements vscode.CodeLensProvider {
  private client: DocSynthClient;
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor(client: DocSynthClient) {
    this.client = client;
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();

    // Find functions without documentation
    const functionPatterns = [
      // TypeScript/JavaScript functions
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g,
      // Arrow functions assigned to variables
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
      // Class methods
      /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*{/gm,
    ];

    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const position = document.positionAt(match.index);
        const line = position.line;

        // Check if there's a JSDoc comment before this function
        if (line > 0) {
          const previousLine = document.lineAt(line - 1).text.trim();
          const twoLinesUp = line > 1 ? document.lineAt(line - 2).text.trim() : '';

          // Skip if there's already documentation
          if (previousLine.endsWith('*/') || twoLinesUp.endsWith('*/')) {
            continue;
          }
        }

        const range = new vscode.Range(position, position);
        const funcName = match[1];

        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `📝 Add documentation for ${funcName}`,
            command: 'docsynth.addInlineDoc',
            arguments: [document, position],
          })
        );
      }
    }

    // Find classes without documentation
    const classPattern = /(?:export\s+)?class\s+(\w+)/g;
    let classMatch;
    while ((classMatch = classPattern.exec(text)) !== null) {
      const position = document.positionAt(classMatch.index);
      const line = position.line;

      if (line > 0) {
        const previousLine = document.lineAt(line - 1).text.trim();
        if (previousLine.endsWith('*/')) {
          continue;
        }
      }

      const range = new vscode.Range(position, position);
      const className = classMatch[1];

      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `📝 Add documentation for class ${className}`,
          command: 'docsynth.addInlineDoc',
          arguments: [document, position],
        })
      );
    }

    return codeLenses;
  }

  async generateDocumentation(
    repositoryId: string,
    filePath: string,
    codeBlock: string,
    style: 'jsdoc' | 'tsdoc' | 'docstring' = 'jsdoc'
  ): Promise<{ documentation: string; confidence: number }> {
    if (!repositoryId) {
      // Fallback to local generation if not connected
      return {
        documentation: this.generateLocalDoc(codeBlock, style),
        confidence: 0.5,
      };
    }

    try {
      return await this.client.generateInlineDoc(repositoryId, filePath, codeBlock, style);
    } catch {
      // Fallback to local generation
      return {
        documentation: this.generateLocalDoc(codeBlock, style),
        confidence: 0.3,
      };
    }
  }

  private generateLocalDoc(codeBlock: string, style: 'jsdoc' | 'tsdoc' | 'docstring'): string {
    // Extract function signature
    const funcMatch = codeBlock.match(
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w+))?/
    );

    if (!funcMatch) {
      return `/** TODO: Add documentation */`;
    }

    const funcName = funcMatch[1];
    const params = funcMatch[2]
      ?.split(',')
      .map((p) => p.trim())
      .filter(Boolean) ?? [];
    const returnType = funcMatch[3] ?? 'void';

    if (style === 'jsdoc' || style === 'tsdoc') {
      let doc = `/**\n * ${funcName} - TODO: Add description\n *\n`;
      for (const param of params) {
        const paramName = param.split(':')[0]?.trim() ?? param;
        doc += ` * @param ${paramName} - TODO: describe parameter\n`;
      }
      if (returnType !== 'void') {
        doc += ` * @returns ${returnType} - TODO: describe return value\n`;
      }
      doc += ' */';
      return doc;
    }

    // Python docstring style
    let doc = `"""\n${funcName} - TODO: Add description\n\nArgs:\n`;
    for (const param of params) {
      const paramName = param.split(':')[0]?.trim() ?? param;
      doc += `    ${paramName}: TODO: describe parameter\n`;
    }
    doc += `\nReturns:\n    TODO: describe return value\n"""`;
    return doc;
  }
}
