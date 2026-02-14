/**
 * DocSynth API Usage Example
 *
 * Demonstrates how to interact with the DocSynth REST API programmatically.
 *
 * Prerequisites:
 *   - API server running: npm run dev (starts API on port 3001)
 *   - Or run with DEMO=true for offline mock output: DEMO=true npx tsx examples/api-usage.ts
 *
 * Run: npx tsx examples/api-usage.ts
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const DEMO = process.env.DEMO === 'true';

// ── Demo Mode Mocks ──────────────────────────────────────────────────────────

const DEMO_RESPONSES: Record<string, unknown> = {
  '/health': { status: 'ok', version: '0.1.0', uptime: 12.345 },
  '/api/v1/repositories': [
    { id: 1, name: 'acme-app', fullName: 'acme-corp/acme-app', provider: 'github', private: false },
  ],
  '/api/v1/documents/search?q=getting+started': [
    {
      id: 1,
      title: 'Getting Started',
      type: 'readme',
      repository: 'acme-corp/acme-app',
      updatedAt: '2025-01-15T10:30:00Z',
    },
  ],
  '/api/v1/health/dashboard': {
    totalDocs: 5,
    freshDocs: 4,
    staleDocs: 1,
    coveragePercent: 80,
  },
};

// ── Helper ────────────────────────────────────────────────────────────────────

async function api(path: string, options?: RequestInit) {
  if (DEMO) {
    const key = Object.keys(DEMO_RESPONSES).find((k) => path.startsWith(k));
    return key ? DEMO_RESPONSES[key] : { message: 'demo response' };
  }

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
  if (DEMO) return true;
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
  console.log(`Using API at: ${DEMO ? '(demo mode — mock responses)' : API_URL}`);
  console.log('='.repeat(50));
  console.log('');

  const available = await checkApiAvailable();
  if (!available) {
    console.error(`❌ Cannot reach API server at ${API_URL}`);
    console.error('   Start it first with: npm run dev');
    console.error('   Or run in demo mode:  DEMO=true npx tsx examples/api-usage.ts');
    process.exit(1);
  }

  await checkHealth();
  await listRepositories();
  await searchDocuments();
  await getDocHealth();

  console.log('Done! See full API docs at: http://localhost:3001/docs');
}

main().catch(console.error);
