import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { matchGlob } from '@docsynth/utils';

interface GenerateOptions {
  path?: string;
  output?: string;
  dryRun?: boolean;
  pr?: string;
}

export async function generateCommand(options: GenerateOptions) {
  const repoPath = options.path ?? '.';
  const outputDir = options.output ?? 'docs';

  console.log(chalk.blue('📚 Generating documentation...\n'));

  // Check for configuration
  const configPath = path.join(repoPath, '.docsynth.json');
  const configExists = await fs
    .access(configPath)
    .then(() => true)
    .catch(() => false);

  if (!configExists) {
    console.log(chalk.yellow('No .docsynth.json found. Run'), chalk.cyan('docsynth init'), chalk.yellow('first.'));
    return;
  }

  const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

  // Step 1: Analyze repository
  const analyzeSpinner = ora('Analyzing repository...').start();

  try {
    // Find source files
    const sourceFiles = await findSourceFiles(repoPath, config.filters);
    analyzeSpinner.succeed(`Found ${sourceFiles.length} source files`);

    // Step 2: Extract documentation-worthy items
    const extractSpinner = ora('Extracting exports and APIs...').start();
    const exports = await extractExports(sourceFiles);
    extractSpinner.succeed(`Found ${exports.length} exports`);

    if (options.dryRun) {
      console.log(chalk.yellow('\n📋 Dry run - would generate:\n'));

      if (config.docTypes.readme) {
        console.log('  • README.md');
      }
      if (config.docTypes.apiDocs) {
        console.log('  • docs/api-reference.md');
      }
      if (config.docTypes.changelog) {
        console.log('  • CHANGELOG.md (entry)');
      }

      console.log('\nExports found:');
      for (const exp of exports.slice(0, 10)) {
        console.log(`  - ${exp.name} (${exp.type}) from ${exp.file}`);
      }
      if (exports.length > 10) {
        console.log(`  ... and ${exports.length - 10} more`);
      }

      return;
    }

    // Step 3: Generate documentation
    const generateSpinner = ora('Generating documentation...').start();

    // Create output directory
    await fs.mkdir(path.join(repoPath, outputDir), { recursive: true });

    const generated: string[] = [];

    if (config.docTypes.apiDocs) {
      const apiDocsContent = generateApiDocs(exports, config);
      const apiDocsPath = path.join(repoPath, outputDir, 'api-reference.md');
      await fs.writeFile(apiDocsPath, apiDocsContent);
      generated.push(apiDocsPath);
    }

    generateSpinner.succeed('Documentation generated');

    console.log(chalk.green('\n✅ Documentation generated successfully!\n'));
    console.log('Files created:');
    for (const file of generated) {
      console.log('  •', chalk.cyan(file));
    }

    console.log('\nNote: For full AI-powered generation, run via DocSynth cloud or set up API keys.');
  } catch (error) {
    analyzeSpinner.fail('Analysis failed');
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
  }
}

async function findSourceFiles(
  repoPath: string,
  filters: { includePaths: string[]; excludePaths: string[] }
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(repoPath, fullPath);

      // Skip excluded paths
      if (filters.excludePaths.some((p) => matchGlob(relativePath, p))) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (
          filters.includePaths.some((p) => matchGlob(relativePath, p)) ||
          /\.(ts|tsx|js|jsx)$/.test(entry.name)
        ) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(repoPath);
  return files;
}

interface Export {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'const';
  file: string;
  signature?: string;
}

async function extractExports(files: string[]): Promise<Export[]> {
  const exports: Export[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        // Export function
        const funcMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/);
        if (funcMatch?.[1]) {
          exports.push({ name: funcMatch[1], type: 'function', file });
        }

        // Export class
        const classMatch = line.match(/^export\s+class\s+(\w+)/);
        if (classMatch?.[1]) {
          exports.push({ name: classMatch[1], type: 'class', file });
        }

        // Export interface
        const interfaceMatch = line.match(/^export\s+interface\s+(\w+)/);
        if (interfaceMatch?.[1]) {
          exports.push({ name: interfaceMatch[1], type: 'interface', file });
        }

        // Export type
        const typeMatch = line.match(/^export\s+type\s+(\w+)/);
        if (typeMatch?.[1]) {
          exports.push({ name: typeMatch[1], type: 'type', file });
        }

        // Export const
        const constMatch = line.match(/^export\s+const\s+(\w+)/);
        if (constMatch?.[1]) {
          exports.push({ name: constMatch[1], type: 'const', file });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return exports;
}

function generateApiDocs(exports: Export[], _config: unknown): string {
  const lines: string[] = [
    '# API Reference',
    '',
    'This document provides an overview of the public API.',
    '',
    '> **Note:** This is a basic extraction. For full AI-generated documentation, use DocSynth cloud.',
    '',
  ];

  // Group by type
  const byType: Record<string, Export[]> = {};
  for (const exp of exports) {
    if (!byType[exp.type]) {
      byType[exp.type] = [];
    }
    byType[exp.type]?.push(exp);
  }

  const typeOrder = ['class', 'function', 'interface', 'type', 'const'];

  for (const type of typeOrder) {
    const items = byType[type];
    if (!items || items.length === 0) continue;

    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s`, '');

    for (const item of items) {
      const relativePath = path.relative(process.cwd(), item.file);
      lines.push(`### \`${item.name}\``, '');
      lines.push(`**File:** \`${relativePath}\``, '');
      lines.push('');
    }
  }

  lines.push('---', '', '*Generated by DocSynth CLI*');

  return lines.join('\n');
}
