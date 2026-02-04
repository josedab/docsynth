'use client';

import { useState } from 'react';

interface CodeBlock {
  label: string;
  code: string;
}

function CopyableCode({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className={`bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-sm font-mono language-${language}`}>
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
        )}
      </button>
    </div>
  );
}

function TabSelector({ tabs, selected, onChange }: { tabs: CodeBlock[]; selected: number; onChange: (i: number) => void }) {
  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
      {tabs.map((tab, i) => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            selected === i
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function CLIPage() {
  const [installTab, setInstallTab] = useState(0);

  const installCommands: CodeBlock[] = [
    { label: 'npm', code: 'npm install -g @docsynth/cli' },
    { label: 'pnpm', code: 'pnpm add -g @docsynth/cli' },
    { label: 'yarn', code: 'yarn global add @docsynth/cli' },
    { label: 'Homebrew', code: 'brew install docsynth/tap/docsynth' },
    { label: 'curl', code: 'curl -fsSL https://docsynth.dev/install.sh | sh' },
  ];

  const workflows = [
    {
      title: 'Generate docs for a repository',
      description: 'Trigger documentation generation for a specific repo',
      command: 'docsynth generate --repo owner/repo-name',
    },
    {
      title: 'Check documentation health',
      description: 'Get health score and drift analysis',
      command: 'docsynth health --repo owner/repo-name',
    },
    {
      title: 'List recent jobs',
      description: 'View status of doc generation jobs',
      command: 'docsynth jobs list --limit 10',
    },
    {
      title: 'Export documentation',
      description: 'Download generated docs locally',
      command: 'docsynth export --repo owner/repo-name --output ./docs',
    },
    {
      title: 'Watch for changes',
      description: 'Auto-generate docs when code changes',
      command: 'docsynth watch --repo owner/repo-name',
    },
  ];

  const ciExamples = [
    {
      label: 'GitHub Actions',
      code: `name: DocSynth
on:
  push:
    branches: [main]

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Generate Documentation
        uses: docsynth/action@v1
        with:
          api-key: \${{ secrets.DOCSYNTH_API_KEY }}
          doc-types: readme,api,changelog`,
    },
    {
      label: 'GitLab CI',
      code: `docsynth:
  stage: docs
  image: docsynth/cli:latest
  script:
    - docsynth generate --repo \$CI_PROJECT_PATH
  only:
    - main
  variables:
    DOCSYNTH_API_KEY: \$DOCSYNTH_API_KEY`,
    },
    {
      label: 'CircleCI',
      code: `version: 2.1
jobs:
  generate-docs:
    docker:
      - image: docsynth/cli:latest
    steps:
      - checkout
      - run:
          name: Generate Documentation
          command: docsynth generate --repo \$CIRCLE_PROJECT_REPONAME`,
    },
  ];

  const [ciTab, setCiTab] = useState(0);

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CLI & Automation</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Use the DocSynth CLI to automate documentation generation from your terminal or CI/CD pipelines.
        </p>
      </div>

      {/* Install Section */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-2xl">📦</span>
          Installation
        </h2>

        <TabSelector tabs={installCommands} selected={installTab} onChange={setInstallTab} />
        <CopyableCode code={installCommands[installTab].code} />

        <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
          After installation, verify with: <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">docsynth --version</code>
        </p>
      </section>

      {/* Authentication */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-2xl">🔐</span>
          Authentication
        </h2>

        <div className="space-y-4">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Option 1: Interactive Login</h3>
            <CopyableCode code="docsynth login" />
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Opens your browser to authenticate with your DocSynth account.
            </p>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Option 2: API Key (recommended for CI/CD)</h3>
            <CopyableCode code={`export DOCSYNTH_API_KEY="your-api-key-here"`} />
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Create an API key in{' '}
              <a href="/dashboard/settings/api-keys" className="text-blue-600 dark:text-blue-400 hover:underline">
                Settings → API Keys
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* Common Workflows */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          Common Workflows
        </h2>

        <div className="space-y-4">
          {workflows.map((workflow, i) => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h3 className="font-medium text-gray-900 dark:text-white">{workflow.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{workflow.description}</p>
              <CopyableCode code={workflow.command} />
            </div>
          ))}
        </div>
      </section>

      {/* CI/CD Integration */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-2xl">🔄</span>
          CI/CD Integration
        </h2>

        <TabSelector
          tabs={ciExamples.map(e => ({ label: e.label, code: '' }))}
          selected={ciTab}
          onChange={setCiTab}
        />
        <CopyableCode code={ciExamples[ciTab].code} language="yaml" />
      </section>

      {/* SDK Links */}
      <section className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="text-2xl">🧩</span>
          SDKs & Libraries
        </h2>

        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { name: 'TypeScript', icon: '🟦', install: 'npm install @docsynth/sdk' },
            { name: 'Python', icon: '🐍', install: 'pip install docsynth' },
            { name: 'Go', icon: '🐹', install: 'go get github.com/docsynth/go-sdk' },
          ].map(sdk => (
            <div key={sdk.name} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{sdk.icon}</span>
                <span className="font-medium text-gray-900 dark:text-white">{sdk.name}</span>
              </div>
              <code className="text-xs text-gray-600 dark:text-gray-400 break-all">{sdk.install}</code>
            </div>
          ))}
        </div>
      </section>

      {/* Help */}
      <section className="text-center py-8">
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Need help? Run <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">docsynth help</code> or check the{' '}
          <a href="https://docs.docsynth.dev/cli" className="text-blue-600 dark:text-blue-400 hover:underline">
            full documentation
          </a>
        </p>
      </section>
    </div>
  );
}
