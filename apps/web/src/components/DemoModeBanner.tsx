'use client';

import { useState } from 'react';

export function DemoModeBanner() {
  const [dismissed, setDismissed] = useState(false);
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  if (!isDemoMode || dismissed) {
    return null;
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-amber-600 dark:text-amber-400 text-lg flex-shrink-0">⚡</span>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Demo Mode</strong> — You&apos;re exploring DocSynth with sample data.{' '}
            <a
              href="https://docsynth.dev/docs/getting-started/github-app-setup"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline font-medium"
            >
              Connect a real repository →
            </a>
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          aria-label="Dismiss banner"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
