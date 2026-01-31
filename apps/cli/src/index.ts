#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { statusCommand } from './commands/status.js';
import { loginCommand } from './commands/login.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
  .name('docsynth')
  .description('AI-powered documentation generator')
  .version('0.1.0');

// Init command
program
  .command('init')
  .description('Initialize DocSynth in a repository')
  .option('-y, --yes', 'Skip prompts and use defaults')
  .action(initCommand);

// Generate command
program
  .command('generate')
  .description('Generate documentation for the current repository')
  .option('-p, --path <path>', 'Path to repository', '.')
  .option('-o, --output <dir>', 'Output directory', 'docs')
  .option('--dry-run', 'Show what would be generated without writing files')
  .option('--pr <number>', 'Generate docs for a specific PR')
  .action(generateCommand);

// Status command
program
  .command('status')
  .description('Check status of DocSynth for this repository')
  .action(statusCommand);

// Login command
program
  .command('login')
  .description('Authenticate with DocSynth')
  .action(loginCommand);

// Config command
program
  .command('config')
  .description('Manage DocSynth configuration')
  .option('--show', 'Show current configuration')
  .option('--set <key=value>', 'Set a configuration value')
  .action(configCommand);

// Error handling
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof Error && error.message !== 'commander.helpDisplayed') {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}
