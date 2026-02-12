/**
 * DocSynth API Usage Example
 *
 * Demonstrates how to interact with the DocSynth REST API programmatically.
 * Requires the API server running at http://localhost:3001 (npm run dev).
 *
 * Run: npx tsx examples/api-usage.ts
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

// ── Helper ────────────────────────────────────────────────────────────────────

async function api(path: string, options?: RequestInit) {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }

  return res.json();
}

async function checkApiAvailable(): Promise<boolean> {
  try {
    await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

// ── 1. Health Check ───────────────────────────────────────────────────────────

async function checkHealth() {
  console.log('1. Checking API health...');
  const health = await api('/health');
  console.log('   Status:', health);
  console.log('');
}

// ── 2. List Repositories ─────────────────────────────────────────────────────

async function listRepositories() {
  console.log('2. Listing repositories...');
  try {
    const repos = await api('/api/v1/repositories');
    console.log('   Repositories:', JSON.stringify(repos, null, 2));
  } catch {
    console.log('   (requires authentication - see API docs at /docs)');
  }
  console.log('');
}

// ── 3. Search Documents ──────────────────────────────────────────────────────

async function searchDocuments() {
  console.log('3. Searching documents...');
  try {
    const results = await api('/api/v1/documents/search?q=getting+started');
    console.log('   Results:', JSON.stringify(results, null, 2));
  } catch {
    console.log('   (requires authentication and seed data)');
  }
  console.log('');
}

// ── 4. Get Documentation Health ──────────────────────────────────────────────

async function getDocHealth() {
  console.log('4. Getting documentation health...');
  try {
    const health = await api('/api/v1/health/dashboard');
    console.log('   Dashboard:', JSON.stringify(health, null, 2));
  } catch {
    console.log('   (requires authentication)');
  }
  console.log('');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('DocSynth API Usage Example');
  console.log(`Using API at: ${API_URL}`);
  console.log('='.repeat(50));
  console.log('');

  const available = await checkApiAvailable();
  if (!available) {
    console.error(`❌ Cannot reach API server at ${API_URL}`);
    console.error('   Start it first with: npm run dev');
    console.error('   Or set API_URL to point to a running instance.');
    process.exit(1);
  }

  await checkHealth();
  await listRepositories();
  await searchDocuments();
  await getDocHealth();

  console.log('Done! See full API docs at: http://localhost:3001/docs');
}

main().catch(console.error);
