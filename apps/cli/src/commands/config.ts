import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

interface ConfigOptions {
  show?: boolean;
  set?: string;
}

export async function configCommand(options: ConfigOptions) {
  const configPath = path.join(process.cwd(), '.docsynth.json');

  // Check if config exists
  const configExists = await fs
    .access(configPath)
    .then(() => true)
    .catch(() => false);

  if (!configExists) {
    console.log(chalk.yellow('No configuration found. Run'), chalk.cyan('docsynth init'), chalk.yellow('first.'));
    return;
  }

  const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));

  if (options.show || (!options.show && !options.set)) {
    console.log(chalk.blue('📝 DocSynth Configuration\n'));
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (options.set) {
    const [key, value] = options.set.split('=');
    if (!key || value === undefined) {
      console.log(chalk.red('Invalid format. Use: --set key=value'));
      return;
    }

    // Parse the key path (e.g., "style.tone" -> ["style", "tone"])
    const keyPath = key.split('.');
    let current: Record<string, unknown> = config;

    for (let i = 0; i < keyPath.length - 1; i++) {
      const k = keyPath[i];
      if (k === undefined) continue;
      if (typeof current[k] !== 'object' || current[k] === null) {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }

    // Set the value
    const finalKey = keyPath[keyPath.length - 1];
    if (finalKey) {
      // Try to parse as JSON, otherwise use as string
      try {
        current[finalKey] = JSON.parse(value);
      } catch {
        current[finalKey] = value;
      }
    }

    // Write config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');

    console.log(chalk.green('✅ Configuration updated'));
    console.log(`  ${key} = ${value}`);
  }
}
