import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';

const API_URL = process.env.DOCSYNTH_API_URL ?? 'http://localhost:3001';

export async function loginCommand() {
  console.log(chalk.blue('🔐 DocSynth Login\n'));

  // Check if already logged in
  const existingToken = await getStoredToken();
  if (existingToken) {
    const { reauth } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reauth',
        message: 'You are already logged in. Do you want to re-authenticate?',
        default: false,
      },
    ]);

    if (!reauth) {
      console.log(chalk.green('Already logged in.'));
      return;
    }
  }

  console.log('To authenticate, visit the following URL in your browser:\n');

  try {
    const response = await fetch(`${API_URL}/auth/github/url`);
    const data = await response.json() as { url: string };

    console.log(chalk.cyan(data.url));
    console.log('\nAfter authorizing, you will receive a token.');

    const { token } = await inquirer.prompt([
      {
        type: 'input',
        name: 'token',
        message: 'Paste your token here:',
      },
    ]);

    if (!token) {
      console.log(chalk.yellow('No token provided.'));
      return;
    }

    // Verify token
    const verifyResponse = await fetch(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const userData = await verifyResponse.json() as { user?: { githubUsername: string } };

    if (!userData.user) {
      console.log(chalk.red('Invalid token.'));
      return;
    }

    // Store token
    await storeToken(token);

    console.log(chalk.green(`\n✅ Logged in as ${userData.user.githubUsername}`));
  } catch (error) {
    console.log(chalk.red('\nFailed to connect to DocSynth API.'));
    console.log('Make sure the API server is running or set DOCSYNTH_API_URL environment variable.');
  }
}

async function getStoredToken(): Promise<string | null> {
  try {
    const tokenPath = getTokenPath();
    return await fs.readFile(tokenPath, 'utf-8');
  } catch {
    return null;
  }
}

async function storeToken(token: string): Promise<void> {
  const tokenPath = getTokenPath();
  const dir = path.dirname(tokenPath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tokenPath, token, { mode: 0o600 });
}

function getTokenPath(): string {
  const configDir = path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.config',
    'docsynth'
  );
  return path.join(configDir, 'token');
}
