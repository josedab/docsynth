import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

export async function statusCommand() {
  console.log(chalk.blue('📊 DocSynth Status\n'));

  // Check configuration
  const configPath = path.join(process.cwd(), '.docsynth.json');
  const configExists = await fs
    .access(configPath)
    .then(() => true)
    .catch(() => false);

  console.log('Configuration:', configExists ? chalk.green('✓ Found') : chalk.yellow('✗ Not initialized'));

  if (configExists) {
    try {
      const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

      console.log('\nSettings:');
      console.log('  Triggers:');
      console.log('    • On PR merge:', config.triggers?.onPRMerge ? 'Yes' : 'No');
      console.log('    • Branches:', config.triggers?.branches?.join(', ') || 'main');

      console.log('  Doc types:');
      if (config.docTypes) {
        for (const [type, enabled] of Object.entries(config.docTypes)) {
          console.log(`    • ${type}:`, enabled ? chalk.green('enabled') : chalk.dim('disabled'));
        }
      }

      console.log('  Style:');
      console.log('    • Tone:', config.style?.tone || 'technical');
      console.log('    • Include examples:', config.style?.includeExamples ? 'Yes' : 'No');
    } catch {
      console.log(chalk.red('  Error reading configuration'));
    }
  }

  // Check authentication
  const authToken = await getStoredToken();
  console.log('\nAuthentication:', authToken ? chalk.green('✓ Logged in') : chalk.yellow('✗ Not logged in'));

  // Check for existing docs
  const docsDir = path.join(process.cwd(), 'docs');
  const docsExists = await fs
    .access(docsDir)
    .then(() => true)
    .catch(() => false);

  console.log('Docs directory:', docsExists ? chalk.green('✓ Exists') : chalk.dim('Not found'));

  if (docsExists) {
    try {
      const files = await fs.readdir(docsDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));
      console.log(`  Found ${mdFiles.length} markdown files`);
    } catch {
      // Ignore
    }
  }

  console.log('\n' + chalk.dim('Run `docsynth --help` for available commands.'));
}

async function getStoredToken(): Promise<string | null> {
  try {
    const configDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.config',
      'docsynth'
    );
    const tokenPath = path.join(configDir, 'token');
    return await fs.readFile(tokenPath, 'utf-8');
  } catch {
    return null;
  }
}
