'use client';

import Link from 'next/link';

interface Step {
  label: string;
  done: boolean;
  href?: string;
}

interface GettingStartedCardProps {
  hasRepositories: boolean;
  hasJobs: boolean;
  hasDocuments: boolean;
}

export function GettingStartedCard({
  hasRepositories,
  hasJobs,
  hasDocuments,
}: GettingStartedCardProps) {
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  if (!isDemoMode) {
    return null;
  }

  const steps: Step[] = [
    { label: 'API server running', done: true },
    { label: 'Sample data loaded', done: true },
    {
      label: 'Connect a GitHub repository',
      done: hasRepositories,
      href: '/dashboard/repositories',
    },
    { label: 'Trigger your first doc generation', done: hasJobs, href: '/dashboard/jobs' },
    { label: 'Review generated documentation', done: hasDocuments, href: '/dashboard/documents' },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  if (completedCount === steps.length) {
    return null;
  }

  return (
    <div className="mb-6 md:mb-8 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
      <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-1">
        Getting Started
      </h2>
      <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
        Follow these steps to set up DocSynth for your project.
      </p>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            {step.done ? (
              <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 text-sm">
                ✓
              </span>
            ) : (
              <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm font-medium">
                {i + 1}
              </span>
            )}
            {step.href && !step.done ? (
              <Link
                href={step.href}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                {step.label} →
              </Link>
            ) : (
              <span
                className={`text-sm ${step.done ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-700 dark:text-gray-300'}`}
              >
                {step.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
