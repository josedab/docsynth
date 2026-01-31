import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';

interface InitOptions {
  yes?: boolean;
}

const DEFAULT_CONFIG = {
  version: 1,
  triggers: {
    onPRMerge: true,
    branches: ['main', 'master'],
  },
  filters: {
    includePaths: ['src/**/*', 'lib/**/*'],
    excludePaths: ['**/*.test.*', '**/*.spec.*', '**/node_modules/**'],
  },
  docTypes: {
    readme: true,
    apiDocs: true,
    changelog: true,
  },
  style: {
    tone: 'technical',
    includeExamples: true,
  },
};

export async function initCommand(options: InitOptions) {
  console.log(chalk.blue('🔧 Initializing DocSynth...\n'));

  // Check if already initialized
  const configPath = path.join(process.cwd(), '.docsynth.json');
  const configExists = await fs
    .access(configPath)
    .then(() => true)
    .catch(() => false);

  if (configExists) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'DocSynth is already initialized. Overwrite configuration?',
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.yellow('Initialization cancelled.'));
      return;
    }
  }

  let config = DEFAULT_CONFIG;

  if (!options.yes) {
    // Interactive configuration
    const answers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'docTypes',
        message: 'Which documentation types do you want to generate?',
        choices: [
          { name: 'README', value: 'readme', checked: true },
          { name: 'API Reference', value: 'apiDocs', checked: true },
          { name: 'Changelog', value: 'changelog', checked: true },
          { name: 'Guides/Tutorials', value: 'guides', checked: false },
        ],
      },
      {
        type: 'list',
        name: 'tone',
        message: 'What tone should the documentation use?',
        choices: [
          { name: 'Technical (formal, precise)', value: 'technical' },
          { name: 'Casual (friendly, approachable)', value: 'casual' },
          { name: 'Formal (professional, enterprise)', value: 'formal' },
        ],
      },
      {
        type: 'input',
        name: 'branches',
        message: 'Which branches should trigger documentation? (comma-separated)',
        default: 'main, master',
      },
    ]);

    config = {
      ...DEFAULT_CONFIG,
      triggers: {
        ...DEFAULT_CONFIG.triggers,
        branches: answers.branches.split(',').map((b: string) => b.trim()),
      },
      docTypes: {
        readme: answers.docTypes.includes('readme'),
        apiDocs: answers.docTypes.includes('apiDocs'),
        changelog: answers.docTypes.includes('changelog'),
      },
      style: {
        ...DEFAULT_CONFIG.style,
        tone: answers.tone,
      },
    };
  }

  // Write configuration
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log(chalk.green('\n✅ DocSynth initialized successfully!\n'));
  console.log('Configuration saved to:', chalk.cyan('.docsynth.json'));
  console.log('\nNext steps:');
  console.log('  1. Install the DocSynth GitHub App on your repository');
  console.log('  2. Merge a PR to see DocSynth in action');
  console.log('  3. Or run', chalk.cyan('docsynth generate'), 'to test locally\n');
}
